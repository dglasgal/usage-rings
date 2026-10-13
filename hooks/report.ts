import { costOf, isPriced, modelName, WHAT_IF_MODELS } from './pricing'
import type {
  BoardPeriod,
  Current,
  Limit,
  ModelLine,
  PeriodKey,
  PeriodReport,
  Report,
  SessionLine,
  Source,
  TurnLine,
} from '../types'

// One model response as the logs record it, compact for the store:
// [message id, time (ms), model, input, output, 5m cache writes, 1h cache writes, cache reads, flags]
// flags: 1 = fast mode, 2 = US-only routing.
export type Row = [string, number, string, number, number, number, number, number, number]

// The rows of one log file and the session it belongs to.
export type FileRows = { source: Source; session: string; title?: string; project?: string; rows: readonly Row[] }

type Entry = { source: Source; session: string; row: Row; cost: number; isPriced: boolean }

const HOUR = 3_600_000
// A pause longer than this between replies is a break, not work.
const BREAK = 30 * 60_000
const BOARD_SIZE = 15
const TURNS_SIZE = 10
const SESSION_TURNS = 5

export const PERIOD_LABELS: Record<PeriodKey, string> = {
  session: 'This session',
  window: '5-hour window',
  week: 'This week',
  today: 'Today',
  month: 'This month',
}

export const BOARD_LABELS: Record<BoardPeriod, string> = {
  today: 'Today',
  week: 'This week',
  month: 'This month',
}

// Where each period starts. The 5-hour and weekly periods follow the plan's own
// windows when Anthropic has reported them, and roll back from now when not.
export function periodStarts(limits: readonly Limit[], now: number): Record<Exclude<PeriodKey, 'session'>, number> {
  const resetOf = (kind: string) => {
    const at = limits.find(one => one.kind === kind)?.resetsAt
    return at === undefined ? undefined : Date.parse(at)
  }
  const windowReset = resetOf('five_hour')
  const weekReset = resetOf('seven_day')
  const day = new Date(now)
  day.setHours(0, 0, 0, 0)
  const month = new Date(day.getFullYear(), day.getMonth(), 1)

  return {
    window: windowReset !== undefined && windowReset > now ? windowReset - 5 * HOUR : now - 5 * HOUR,
    week: weekReset !== undefined && weekReset > now ? weekReset - 168 * HOUR : now - 168 * HOUR,
    today: day.getTime(),
    month: month.getTime(),
  }
}

function usageOf(row: Row) {
  return {
    input: row[3],
    output: row[4],
    write5m: row[5],
    write1h: row[6],
    read: row[7],
    isFast: (row[8] & 1) === 1,
    isUsOnly: (row[8] & 2) === 2,
  }
}

const tokensOf = (row: Row) => row[3] + row[4] + row[5] + row[6] + row[7]

// A message is written to several lines, and Cowork writes each message to two
// logs, so each message id counts once: the line with the most output (the last
// streamed) stands for it.
function entriesOf(files: readonly FileRows[]): Entry[] {
  const byId = new Map<string, { source: Source; session: string; row: Row }>()
  for (const { source, session, rows } of files) {
    for (const row of rows) {
      const held = byId.get(row[0])
      if (held === undefined || row[4] > held.row[4]) byId.set(row[0], { source, session, row })
    }
  }
  return [...byId.values()].map(one => {
    const cost = costOf(one.row[2], usageOf(one.row))
    return { ...one, cost: cost ?? 0, isPriced: cost !== undefined }
  })
}

function byModelOf(entries: readonly Entry[]): ModelLine[] {
  const byModel = new Map<string, { requests: number; tokens: number; cost: number | null }>()
  for (const { row, cost, isPriced: priced } of entries) {
    const line = byModel.get(row[2]) ?? { requests: 0, tokens: 0, cost: isPriced(row[2]) ? 0 : null }
    line.requests += 1
    line.tokens += tokensOf(row)
    if (priced) line.cost = (line.cost ?? 0) + cost
    byModel.set(row[2], line)
  }
  return [...byModel.entries()]
    .map(([model, line]) => ({ model, name: modelName(model), ...line }))
    .sort((a, b) => (b.cost ?? -1) - (a.cost ?? -1))
}

function periodReport(key: PeriodKey, startsAt: number, inPeriod: readonly Entry[]): PeriodReport {
  const bySource = { code: { requests: 0, cost: 0 }, cowork: { requests: 0, cost: 0 } }
  const whatIf = WHAT_IF_MODELS.map(model => ({ model, name: modelName(model), cost: 0 }))
  let total = 0
  let unpricedTokens = 0

  for (const { source, row, cost, isPriced: priced } of inPeriod) {
    bySource[source].requests += 1
    if (priced) {
      bySource[source].cost += cost
      total += cost
    } else {
      unpricedTokens += tokensOf(row)
    }
    // The what-if keeps the request's own token counts and routing, at standard speed.
    const usage = usageOf(row)
    for (const one of whatIf) one.cost += costOf(one.model, { ...usage, isFast: false }) ?? 0
  }

  return {
    key,
    label: PERIOD_LABELS[key],
    startsAt,
    requests: inPeriod.length,
    total,
    unpricedTokens,
    byModel: byModelOf(inPeriod),
    bySource,
    whatIf,
  }
}

type Meta = { source: Source; title?: string; project?: string }

function shortDate(at: number): string {
  return new Date(at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function titleOf(meta: Meta | undefined, startedAt: number): string {
  if (meta?.title !== undefined) return meta.title
  const where = meta?.project ?? (meta?.source === 'cowork' ? 'Cowork' : 'Claude Code')
  return `${where} · ${shortDate(startedAt)}`
}

// What made one reply expensive: whichever kind of token cost the most.
export function reasonOf(row: Row): string {
  const base = { input: 0, output: 0, write5m: 0, write1h: 0, read: 0, isFast: (row[8] & 1) === 1, isUsOnly: (row[8] & 2) === 2 }
  const part = (tokens: Partial<typeof base>) => costOf(row[2], { ...base, ...tokens }) ?? 0
  const parts: [string, number][] = [
    ['Re-saved the conversation after a pause', part({ write5m: row[5], write1h: row[6] })],
    ['Re-read a long conversation', part({ read: row[7] })],
    ['Wrote a long reply', part({ output: row[4] })],
    ['Read a lot of new material', part({ input: row[3] })],
  ]
  const total = parts.reduce((sum, [, cost]) => sum + cost, 0)
  const [label, top] = parts.reduce((a, b) => (b[1] > a[1] ? b : a))
  return total > 0 && top / total >= 0.5 ? label : 'A mix of reading and writing'
}

// Time spent working: the gaps between replies, breaks left out.
function activeHours(times: number[]): number {
  const sorted = [...times].sort((a, b) => a - b)
  let active = 0
  for (let i = 1; i < sorted.length; i++) {
    const gap = (sorted[i] ?? 0) - (sorted[i - 1] ?? 0)
    if (gap <= BREAK) active += gap
  }
  return Math.max(0.25, active / HOUR)
}

function turnOf(entry: Entry, title: string): TurnLine {
  return {
    at: entry.row[1],
    session: entry.session,
    title,
    model: modelName(entry.row[2]),
    tokens: tokensOf(entry.row),
    cost: entry.cost,
    reason: reasonOf(entry.row),
  }
}

function sessionLines(entries: readonly Entry[], meta: Map<string, Meta>): SessionLine[] {
  const groups = new Map<string, Entry[]>()
  for (const entry of entries) {
    const group = groups.get(entry.session) ?? []
    group.push(entry)
    groups.set(entry.session, group)
  }
  const lines: SessionLine[] = []
  for (const [key, group] of groups) {
    const startedAt = Math.min(...group.map(one => one.row[1]))
    const lastAt = Math.max(...group.map(one => one.row[1]))
    const cost = group.reduce((sum, one) => sum + one.cost, 0)
    const tokens = group.reduce((sum, one) => sum + tokensOf(one.row), 0)
    const reread = group.reduce((sum, one) => sum + one.row[7], 0)
    const hours = activeHours(group.map(one => one.row[1]))
    const title = titleOf(meta.get(key), startedAt)
    lines.push({
      key,
      source: group[0]?.source ?? 'code',
      title,
      project: meta.get(key)?.project,
      startedAt,
      lastAt,
      replies: group.length,
      tokens,
      cost,
      burnPerHour: cost / hours,
      rereadShare: tokens > 0 ? reread / tokens : 0,
      byModel: byModelOf(group),
      topTurns: [...group]
        .sort((a, b) => b.cost - a.cost)
        .slice(0, SESSION_TURNS)
        .map(one => turnOf(one, title)),
    })
  }
  return lines.sort((a, b) => b.cost - a.cost).slice(0, BOARD_SIZE)
}

function topTurns(entries: readonly Entry[], meta: Map<string, Meta>): TurnLine[] {
  const firstAt = new Map<string, number>()
  for (const { session, row } of entries) firstAt.set(session, Math.min(firstAt.get(session) ?? row[1], row[1]))
  return [...entries]
    .sort((a, b) => b.cost - a.cost)
    .slice(0, TURNS_SIZE)
    .map(one => turnOf(one, titleOf(meta.get(one.session), firstAt.get(one.session) ?? one.row[1])))
}

function currentOf(entries: readonly Entry[], key: string | undefined, now: number): Current | null {
  if (key === undefined) return null
  const mine = entries.filter(one => one.session === key)
  if (mine.length === 0) return { key, cost: 0, lastHour: 0, replies: 0 }
  const newest = mine.reduce((a, b) => (b.row[1] > a.row[1] ? b : a))
  return {
    key,
    cost: mine.reduce((sum, one) => sum + one.cost, 0),
    lastHour: mine.filter(one => one.row[1] >= now - HOUR).reduce((sum, one) => sum + one.cost, 0),
    replies: mine.length,
    lastTurn: turnOf(newest, ''),
  }
}

// `currentSession` is this conversation's key: its transcript and its helper
// agents' transcripts carry it.
export function buildReport(
  files: readonly FileRows[],
  currentSession: string | undefined,
  limits: readonly Limit[],
  now: number,
  notes: readonly string[],
): Report {
  const entries = entriesOf(files)
  const meta = new Map<string, Meta>()
  for (const file of files) {
    const held = meta.get(file.session) ?? { source: file.source }
    meta.set(file.session, { source: held.source, title: held.title ?? file.title, project: held.project ?? file.project })
  }

  const starts = periodStarts(limits, now)
  const session = entries.filter(one => one.session === currentSession)
  const sessionStart = session.reduce((first, { row }) => Math.min(first, row[1]), now)
  const periods = { session: periodReport('session', sessionStart, session) } as Record<PeriodKey, PeriodReport>
  for (const key of Object.keys(starts) as Exclude<PeriodKey, 'session'>[]) {
    periods[key] = periodReport(key, starts[key], entries.filter(({ row }) => row[1] >= starts[key]))
  }

  const sessions = {} as Record<BoardPeriod, SessionLine[]>
  const turns = {} as Record<BoardPeriod, TurnLine[]>
  for (const key of Object.keys(BOARD_LABELS) as BoardPeriod[]) {
    const inPeriod = entries.filter(({ row }) => row[1] >= starts[key])
    sessions[key] = sessionLines(inPeriod, meta)
    turns[key] = topTurns(inPeriod, meta)
  }

  const hourly = new Array<number>(24).fill(0)
  const today = new Date(now).getDate()
  const daily = new Array<number>(today).fill(0)
  for (const { row, cost } of entries) {
    const at = new Date(row[1])
    if (row[1] >= starts.today) hourly[at.getHours()] = (hourly[at.getHours()] ?? 0) + cost
    if (row[1] >= starts.month) daily[at.getDate() - 1] = (daily[at.getDate() - 1] ?? 0) + cost
  }

  return {
    builtAt: now,
    periods,
    sessions,
    turns,
    hourly,
    daily,
    current: currentOf(entries, currentSession, now),
    notes: [...notes],
  }
}
