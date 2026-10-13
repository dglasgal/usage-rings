import { expect, test } from 'claude-code/testing'

import { costOf, modelName } from '../hooks/pricing'
import { buildReport, periodStarts, reasonOf } from '../hooks/report'
import type { Row } from '../hooks/report'
import { parseJqLines, projectOf, rowsFromJqLines, rowsFromText, sessionOf, toRow } from '../hooks/scan'
import { heat, limitAlerts, sessionAlerts, DEFAULT_THRESHOLDS } from '../hooks/alerts'

const plain = { input: 0, output: 0, write5m: 0, write1h: 0, read: 0, isFast: false, isUsOnly: false }
const close = (a: number | undefined, b: number) => expect(Math.abs((a ?? NaN) - b) < 1e-9).toBe(true)

test('prices a million tokens of each kind at list price', () => {
  close(costOf('claude-opus-5-5', { ...plain, input: 1_000_000 }), 4)
  close(costOf('claude-opus-5-5', { ...plain, output: 1_000_000 }), 20)
  close(costOf('claude-opus-5-5', { ...plain, write5m: 1_000_000 }), 5)
  close(costOf('claude-opus-5-5', { ...plain, write1h: 1_000_000 }), 8)
  close(costOf('claude-opus-5-5', { ...plain, read: 1_000_000 }), 0.2)
  close(costOf('claude-fable-5-1', { ...plain, read: 1_000_000 }), 0.25)
  close(costOf('claude-sonnet-5-5', { ...plain, read: 1_000_000 }), 0.1)
})

test('matches dated model ids and the longest prefix', () => {
  close(costOf('claude-haiku-4-5-20251001', { ...plain, input: 1_000_000 }), 1)
  close(costOf('claude-opus-4-1', { ...plain, input: 1_000_000 }), 15)
  close(costOf('claude-opus-4-7', { ...plain, input: 1_000_000 }), 5)
  expect(modelName('claude-fable-5')).toBe('Fable 5')
  expect(costOf('claude-unknown-9', { ...plain, input: 1 })).toBe(undefined)
})

test('Haiku 5.5 bills a prompt over 100,000 tokens at the higher rate', () => {
  close(costOf('claude-haiku-5-5', { ...plain, input: 100_000, output: 1_000_000 }), 0.01 + 0.5)
  close(costOf('claude-haiku-5-5', { ...plain, input: 50_000, read: 50_001, output: 1_000_000 }), (50_000 * 0.5 + 50_001 * 0.05) / 1e6 + 2.5)
})

test('fast mode doubles where it exists, US-only routing adds 10%', () => {
  close(costOf('claude-opus-5-5', { ...plain, output: 1_000_000, isFast: true }), 40)
  close(costOf('claude-sonnet-5-5', { ...plain, output: 1_000_000, isFast: true }), 10)
  close(costOf('claude-opus-5-5', { ...plain, output: 1_000_000, isUsOnly: true }), 22)
})

test('reads a jq line, splitting cache writes by duration', () => {
  const row = toRow(['msg_1', '2026-10-12T10:00:00.000Z', 'claude-opus-5-5', 10, 20, 300, 100, 400, 50, 'fast', 'us'])
  expect(row).toEqual(['msg_1', Date.parse('2026-10-12T10:00:00.000Z'), 'claude-opus-5-5', 10, 20, 300, 100, 50, 3])
  const unsplit = toRow(['msg_2', '2026-10-12T10:00:00.000Z', 'claude-opus-5-5', 1, 2, null, null, 400, 0, '', ''])
  expect(unsplit?.[5]).toBe(400)
  expect(unsplit?.[6]).toBe(0)
  expect(toRow(['msg_3', '2026-10-12T10:00:00.000Z', '<synthetic>', 0, 0, null, null, 0, 0, '', ''])).toBe(undefined)
  expect(rowsFromJqLines(['not json', ''])).toEqual([])
})

test('reads a log line without jq and never needs the text', () => {
  const line = JSON.stringify({
    timestamp: '2026-10-12T10:00:00.000Z',
    message: {
      id: 'msg_9',
      model: 'claude-sonnet-5-5',
      content: [{ type: 'text', text: 'secret words' }],
      usage: { input_tokens: 5, output_tokens: 6, cache_creation_input_tokens: 7, cache_read_input_tokens: 8, cache_creation: { ephemeral_5m_input_tokens: 7, ephemeral_1h_input_tokens: 0 } },
    },
  })
  const title = JSON.stringify({ type: 'custom-title', customTitle: 'Poster review' })
  const parsed = rowsFromText(`${line}\n{"type":"user"}\n${title}\n`)
  expect(parsed.rows).toEqual([['msg_9', Date.parse('2026-10-12T10:00:00.000Z'), 'claude-sonnet-5-5', 5, 6, 7, 0, 8, 0]])
  expect(parsed.title).toBe('Poster review')
  expect(JSON.stringify(parsed)).not.toContain('secret words')
})

test('counts each message once and splits Claude Code from Cowork', () => {
  const now = Date.parse('2026-10-12T20:00:00.000Z')
  const at = now - 60_000
  const first: Row = ['msg_a', at, 'claude-opus-5-5', 0, 100, 0, 0, 0, 0]
  const final: Row = ['msg_a', at, 'claude-opus-5-5', 0, 1_000_000, 0, 0, 0, 0]
  const cowork: Row = ['msg_b', at, 'claude-sonnet-5-5', 1_000_000, 0, 0, 0, 0, 0]
  const report = buildReport(
    [
      { source: 'code', session: 's1', title: 'Mod build', rows: [first, final] },
      { source: 'cowork', session: 'local_1', rows: [cowork, cowork] },
    ],
    's1',
    [],
    now,
    [],
  )
  const today = report.periods.today
  expect(today.requests).toBe(2)
  close(today.total, 20 + 2)
  close(today.bySource.code.cost, 20)
  close(today.bySource.cowork.cost, 2)
  expect(today.whatIf.map(one => one.name)).toEqual(['Fable 5.1', 'Opus 5.5', 'Sonnet 5.5', 'Haiku 5.5'])
  close(today.whatIf[1]?.cost, 20 + 4)
  // This session: its own transcript's rows only, each message once.
  expect(report.periods.session.requests).toBe(1)
  close(report.periods.session.total, 20)
  expect(report.periods.session.startsAt).toBe(at)
})

test('the 5-hour and weekly periods follow the reported reset times', () => {
  const now = Date.parse('2026-10-12T20:00:00.000Z')
  const starts = periodStarts(
    [
      { kind: 'five_hour', percentUsed: 40, resetsAt: '2026-10-12T22:00:00.000Z', seenAt: now },
      { kind: 'seven_day', percentUsed: 10, resetsAt: '2026-10-15T09:00:00.000Z', seenAt: now },
    ],
    now,
  )
  expect(starts.window).toBe(Date.parse('2026-10-12T17:00:00.000Z'))
  expect(starts.week).toBe(Date.parse('2026-10-08T09:00:00.000Z'))
  expect(periodStarts([], now).window).toBe(now - 5 * 3_600_000)
})

test('ranks sessions, finds the costliest replies and buckets spend by hour', () => {
  const now = new Date(2026, 9, 12, 15, 30).getTime()
  const at = (h: number) => new Date(2026, 9, 12, h, 0).getTime()
  const report = buildReport(
    [
      { source: 'code', session: 'big', title: 'Big one', project: 'Posters', rows: [['m1', at(9), 'claude-opus-5-5', 0, 2_000_000, 0, 0, 0, 0], ['m2', at(10), 'claude-opus-5-5', 0, 1_000_000, 0, 0, 0, 0]] },
      { source: 'code', session: 'big', rows: [['m3', at(10), 'claude-sonnet-5-5', 1_000_000, 0, 0, 0, 0, 0]] },
      { source: 'code', session: 'small', project: 'Edit', rows: [['m4', at(14), 'claude-opus-5-5', 1_000_000, 0, 0, 0, 1_000_000, 0]] },
    ],
    'small',
    [],
    now,
    [],
  )
  const board = report.sessions.today
  expect(board.map(one => one.key)).toEqual(['big', 'small'])
  close(board[0]?.cost, 40 + 20 + 2)
  expect(board[0]?.replies).toBe(3)
  expect(board[0]?.title).toBe('Big one')
  // 9:00 to 10:00 is a break (over 30 minutes), so it counts the 15-minute floor.
  close(board[0]?.burnPerHour, 62 * 4)
  expect(report.turns.today[0]?.reason).toBe('Wrote a long reply')
  expect(board[1]?.title).toBe('Edit · Oct 12')
  close(board[1]?.rereadShare, 0.5)
  close(report.turns.today[0]?.cost, 40)
  expect(report.turns.today[0]?.title).toBe('Big one')
  close(report.hourly[10], 22)
  close(report.daily[11], 66.2)
  expect(report.current?.key).toBe('small')
  close(report.current?.cost, 4.2)
})

test('finds the session a log belongs to, and its folder', () => {
  expect(sessionOf('code', '/h/.claude/projects/-p/abc.jsonl')).toBe('abc')
  expect(sessionOf('code', '/h/.claude/projects/-p/abc/subagents/agent-1.jsonl')).toBe('abc')
  expect(sessionOf('cowork', '/a/s/local_42/audit.jsonl')).toBe('local_42')
  expect(sessionOf('cowork', '/a/s/local_42/.claude/projects/x/def.jsonl')).toBe('local_42')
  expect(projectOf('/Users/d/Documents/Poster Campaign', '')).toBe('Poster Campaign')
  const parsed = parseJqLines(['["~title","Poster review"]', '["m",  "2026-10-12T10:00:00.000Z", "claude-opus-5-5", 1, 1, null, null, 0, 0, "", "", "/w/Posters"]'], { rows: [] })
  expect(parsed.title).toBe('Poster review')
  expect(parsed.cwd).toBe('/w/Posters')
  expect(parsed.rows.length).toBe(1)
})

test('alerts at each milestone, on a costly reply, on fast spend and near a limit', () => {
  const t = DEFAULT_THRESHOLDS
  const now = Date.parse('2026-10-12T20:00:00.000Z')
  const current = { key: 's', cost: 60, lastHour: 55, replies: 9, lastTurn: { at: now, session: 's', title: '', model: 'Opus 5.5', tokens: 900_000, cost: 6 } }
  const ids = sessionAlerts(current, t, now).map(one => one.id)
  expect(ids).toContain('session:s:25')
  expect(ids).toContain('session:s:50')
  expect(ids).not.toContain('session:s:100')
  expect(ids).toContain(`turn:s:${now}`)
  expect(ids.some(id => id.startsWith('burn:s:'))).toBe(true)
  expect(heat(current, t)).toBe(2)
  expect(heat({ ...current, cost: 120 }, t)).toBe(3)
  expect(heat({ ...current, cost: 3, lastHour: 1 }, t)).toBe(0)
  const near = limitAlerts([{ kind: 'five_hour', percentUsed: 96, resetsAt: '2026-10-12T22:00:00.000Z', seenAt: now }], t, now)
  expect(near.map(one => one.shouldNotify)).toEqual([false, true])
})

test('names what made a reply expensive', () => {
  expect(reasonOf(['m', 0, 'claude-opus-5-5', 1_000, 2_000, 0, 650_000, 10_000, 0])).toBe('Re-saved the conversation after a pause')
  expect(reasonOf(['m', 0, 'claude-opus-5-5', 1_000, 2_000, 0, 0, 900_000, 0])).toBe('Re-read a long conversation')
  expect(reasonOf(['m', 0, 'claude-opus-5-5', 900_000, 0, 0, 0, 0, 0])).toBe('Read a lot of new material')
})
