import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionContextUsage, SessionRateLimit } from 'claude-code'

import { DEFAULT_THRESHOLDS, limitAlerts, sessionAlerts } from './alerts'
import type { Alert, Thresholds } from './alerts'
import { buildReport } from './report'
import type { FileRows } from './report'
import {
  CACHE_KEY,
  DAY,
  isLog,
  JQ_CANDIDATES,
  JQ_PROGRAM,
  KEEP_DAYS,
  keepLast,
  MAX_DEPTH,
  parseJqLines,
  projectOf,
  READ_LIMIT,
  rowsFromText,
  sessionOf,
  SKIP_DIRS,
} from './scan'
import type { Cache, FileCache, Found, Parsed } from './scan'
import { band, pane } from './views'
import type { Actions, Kit, Settings } from './views'
import type { BoardPeriod, Celebration, Context, Limit, PeriodKey, Report, Source, View } from '../types'

const PANE = 'usage-rings'
const PANE_TITLE = 'Usage'
const COMMAND = 'rings'
const STORE_LIMITS = 'last-limits'
const STORE_FIRED = 'fired-alerts'
const RESCAN_EVERY = 5 * 60_000
const PARTY_MS = 8_000
const COUNT_STEPS = 24
const COUNT_STEP_MS = 50
const SOUND = 'sounds/cha-ching.wav'

const limitsAtom = atom({ plugin: 'usage-rings', key: 'limits' } as const, [] as Limit[])
const contextAtom = atom({ plugin: 'usage-rings', key: 'context' } as const, null as Context | null)
const compactingAtom = atom({ plugin: 'usage-rings', key: 'isCompacting' } as const, false)
const reportAtom = atom({ plugin: 'usage-rings', key: 'report' } as const, null as Report | null)
const scanningAtom = atom({ plugin: 'usage-rings', key: 'isScanning' } as const, false)
const periodAtom = atom({ plugin: 'usage-rings', key: 'period' } as const, 'session' as PeriodKey)
const helpAtom = atom({ plugin: 'usage-rings', key: 'openHelp' } as const, [] as string[])
const tickAtom = atom({ plugin: 'usage-rings', key: 'tick' } as const, 0)
const viewAtom = atom({ plugin: 'usage-rings', key: 'view' } as const, 'overview' as View)
const boardAtom = atom({ plugin: 'usage-rings', key: 'boardPeriod' } as const, 'today' as BoardPeriod)
const selectedAtom = atom({ plugin: 'usage-rings', key: 'selected' } as const, null as string | null)
const celebrationAtom = atom({ plugin: 'usage-rings', key: 'celebration' } as const, null as Celebration | null)
const shownCostAtom = atom({ plugin: 'usage-rings', key: 'shownCost' } as const, null as number | null)

// The plan limits first, then any others Anthropic reports.
const LIMIT_ORDER = ['five_hour', 'seven_day']
const byOrder = (a: Limit, b: Limit) => {
  const rank = (kind: string) => (LIMIT_ORDER.includes(kind) ? LIMIT_ORDER.indexOf(kind) : LIMIT_ORDER.length)
  return rank(a.kind) - rank(b.kind)
}

// The module's own memory; a reload starts it over and the logs are read again.
let settings: Settings & { hasSound: boolean } = { seat: 0, thresholds: DEFAULT_THRESHOLDS, isFun: true, hasSound: false }
let lastScan: { files: FileRows[]; session: string | undefined; notes: string[] } | undefined
let isRunning = false
let isPending = false
let rescanTimer: { cancel: () => void } | undefined
let countTimer: { cancel: () => void } | undefined
let partyTimer: { cancel: () => void } | undefined

// ——— Reading the logs ———

// Where Claude Code and Cowork keep their logs on macOS, Windows and Linux.
async function logRoots($: EngineInterface): Promise<{ source: Source; dir: string }[]> {
  const home = (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE'))
  const appData = await $.env.get('APPDATA')
  const configDir = await $.env.get('CLAUDE_CONFIG_DIR')
  const list: { source: Source; dir: string }[] = []
  if (configDir !== undefined) list.push({ source: 'code', dir: `${configDir}/projects` })
  if (home !== undefined) {
    list.push({ source: 'code', dir: `${home}/.claude/projects` })
    list.push({ source: 'cowork', dir: `${home}/Library/Application Support/Claude/local-agent-mode-sessions` })
    list.push({ source: 'cowork', dir: `${home}/.config/Claude/local-agent-mode-sessions` })
  }
  if (appData !== undefined) list.push({ source: 'cowork', dir: `${appData}/Claude/local-agent-mode-sessions` })
  const unique = list.filter((one, i) => list.findIndex(other => other.dir === one.dir) === i)
  const present = await Promise.all(unique.map(one => $.fs.exists(one.dir).catch(() => false)))
  return unique.filter((_, i) => present[i])
}

async function walkLogs($: EngineInterface, source: Source, dir: string, cutoff: number, depth: number, out: Found[]) {
  if (depth > MAX_DEPTH) return
  const entries = await $.fs.list(dir).catch(() => [])
  for (const entry of entries) {
    const path = `${dir}/${entry.name}`
    if (entry.kind === 'dir' && !SKIP_DIRS.has(entry.name)) {
      await walkLogs($, source, path, cutoff, depth + 1, out)
    } else if (entry.kind === 'file' && entry.mtimeMs >= cutoff && isLog(source, path, entry.name)) {
      out.push({ path, source, size: entry.size, mtimeMs: entry.mtimeMs })
    }
  }
}

async function findJq($: EngineInterface): Promise<string | undefined> {
  for (const path of JQ_CANDIDATES) {
    if (await $.fs.exists(path).catch(() => false)) return path
  }
  return undefined
}

// jq's output streams in, so a large log never has to fit in one read.
async function runJq($: EngineInterface, argv: string[]): Promise<Parsed> {
  let buffer = ''
  const parsed: Parsed = { rows: [] }
  for await (const chunk of $.process.spawn({ argv })) {
    if (chunk.stream !== 'stdout') continue
    buffer += chunk.text
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    parseJqLines(lines, parsed)
  }
  return parseJqLines([buffer], parsed)
}

// One file: only the part added since the last read when it grew, the whole file
// when it is new or was rewritten.
async function readLog($: EngineInterface, jq: string | undefined, file: Found, held: FileCache | undefined) {
  const isGrowth = held !== undefined && file.size > held.size
  let fresh: Parsed
  if (jq !== undefined) {
    const argv = isGrowth
      ? ['/bin/sh', '-c', 'tail -c +"$1" "$2" | "$3" -cR "$4"', 'sh', String(held.size + 1), file.path, jq, JQ_PROGRAM]
      : [jq, '-cR', JQ_PROGRAM, file.path]
    fresh = await runJq($, argv)
  } else {
    if (file.size > READ_LIMIT) return undefined
    fresh = rowsFromText(await $.fs.read(file.path))
    return fresh
  }
  if (!isGrowth) return fresh
  return { rows: [...held.rows, ...fresh.rows], title: fresh.title ?? held.title, cwd: held.cwd ?? fresh.cwd }
}

async function scanLogs($: EngineInterface) {
  const now = await $.clock.now()
  const cutoff = now - KEEP_DAYS * DAY
  const notes: string[] = []
  const found: Found[] = []
  const places = await logRoots($)
  for (const { source, dir } of places) await walkLogs($, source, dir, cutoff, 0, found)
  if (!places.some(one => one.source === 'cowork')) notes.push('No Cowork logs were found on this computer.')

  const jq = await findJq($)
  if (jq === undefined) notes.push('jq was not found, so log files over 4 MB are left out of the costs.')

  const cache = ((await $.store.get(CACHE_KEY)) as Cache | undefined) ?? { files: {} }
  const kept: Cache = { files: {} }
  let skipped = 0
  for (const file of found) {
    const sig = `${file.size}:${file.mtimeMs}`
    const held = cache.files[file.path]
    const parsed = held?.sig === sig ? held : await readLog($, jq, file, held).catch(() => undefined)
    if (parsed === undefined) {
      skipped += 1
      continue
    }
    kept.files[file.path] = {
      sig,
      size: file.size,
      rows: keepLast(parsed.rows.filter(row => row[1] >= cutoff)),
      title: parsed.title,
      cwd: parsed.cwd,
    }
  }
  if (skipped > 0) notes.push(`${skipped} log file${skipped === 1 ? '' : 's'} could not be read.`)
  await $.store.set(CACHE_KEY, kept)

  const files: FileRows[] = []
  for (const file of found) {
    const held = kept.files[file.path]
    if (held === undefined) continue
    files.push({
      source: file.source,
      session: sessionOf(file.source, file.path),
      title: held.title,
      project: projectOf(held.cwd, file.path),
      rows: held.rows,
    })
  }
  // This conversation's transcript is named after its id.
  const session = await $.session.id().catch(() => undefined)
  return { files, session, notes }
}

// ——— The report, the counter and the alerts ———

async function rebuild($: EngineInterface) {
  if (lastScan === undefined) return
  const limits = await read($, limitsAtom)
  const now = await $.clock.now()
  const before = (await read($, reportAtom))?.current?.cost
  const report = buildReport(lastScan.files, lastScan.session, limits, now, lastScan.notes)
  await update($, reportAtom, () => report)
  countUp($, before, report.current?.cost)
  await deliver($, sessionAlerts(report.current, settings.thresholds, now))
}

// The band's session cost climbs to its new figure instead of jumping.
function countUp($: EngineInterface, from: number | undefined, to: number | undefined) {
  countTimer?.cancel()
  if (to === undefined) return
  if (!settings.isFun || from === undefined || to <= from) {
    void update($, shownCostAtom, () => to)
    return
  }
  let step = 0
  countTimer = $.clock.every(COUNT_STEP_MS, () => {
    step += 1
    const eased = 1 - Math.pow(1 - step / COUNT_STEPS, 3)
    void update($, shownCostAtom, () => from + (to - from) * eased)
    if (step >= COUNT_STEPS) countTimer?.cancel()
  })
}

// Each alert speaks once. Of the session milestones passed since the last look,
// only the highest is announced.
async function deliver($: EngineInterface, alerts: readonly Alert[]) {
  if (alerts.length === 0) return
  const fired = new Set(((await $.store.get(STORE_FIRED)) as string[] | undefined) ?? [])
  const fresh = alerts.filter(one => !fired.has(one.id))
  if (fresh.length === 0) return
  const milestones = fresh.filter(one => one.id.startsWith('session:'))
  const others = fresh.filter(one => !one.id.startsWith('session:'))
  const announce = [...milestones.slice(-1), ...others]
  for (const one of fresh) fired.add(one.id)
  await $.store.set(STORE_FIRED, [...fired].slice(-400))

  for (const alert of announce) {
    $.ui.toast(alert.text, { timeoutMs: 10_000 })
    if (alert.shouldNotify) void $.ui.notify(alert.text, { title: 'Claude usage' }).catch(() => undefined)
  }
  const party = announce.find(one => one.celebration !== undefined)
  if (party?.celebration !== undefined && settings.isFun) await celebrate($, party.celebration, party.text)
}

async function celebrate($: EngineInterface, kind: 'coins' | 'fire', text: string) {
  const until = (await $.clock.now()) + PARTY_MS
  await update($, celebrationAtom, () => ({ kind, text, until }))
  partyTimer?.cancel()
  partyTimer = $.clock.after(PARTY_MS + 200, () => void endParty($))
  if (settings.hasSound) void $.audio.play({ asset: SOUND }).catch(() => undefined)
}

async function endParty($: EngineInterface) {
  await update($, celebrationAtom, () => null)
}

async function rescan($: EngineInterface) {
  if (isRunning) {
    isPending = true
    return
  }
  isRunning = true
  await update($, scanningAtom, () => true)
  try {
    lastScan = await scanLogs($)
    await rebuild($)
  } catch (error) {
    $.ui.log(`usage-rings: reading the logs failed: ${String(error)}`, { to: 'debug' })
  } finally {
    isRunning = false
    await update($, scanningAtom, () => false)
    if (isPending) {
      isPending = false
      void rescan($)
    }
  }
}

function rescanSoon($: EngineInterface, ms: number) {
  rescanTimer?.cancel()
  rescanTimer = $.clock.after(ms, () => void rescan($))
}

async function takeLimits($: EngineInterface, rateLimits: readonly SessionRateLimit[]) {
  if (rateLimits.length === 0) return
  const now = await $.clock.now()
  const limits = rateLimits.map(one => ({ ...one, seenAt: now })).sort(byOrder)
  await update($, limitsAtom, () => limits)
  await $.store.set(STORE_LIMITS, limits)
  await deliver($, limitAlerts(limits, settings.thresholds, now))
  await rebuild($)
}

async function takeContext($: EngineInterface, context: SessionContextUsage) {
  const next: Context = { window: context.window, tokens: context.tokens, percent: context.percent }
  await update($, contextAtom, () => next)
}

// ——— What the band's and panel's presses do ———

async function openPane($: EngineInterface, topic?: string) {
  if (topic !== undefined) await update($, helpAtom, list => (list.includes(topic) ? list : [...list, topic]))
  if (topic !== undefined) await update($, viewAtom, () => 'overview')
  await $.ui.open({ id: PANE, title: PANE_TITLE, columns: 84 })
}

async function toggleHelp($: EngineInterface, topic: string) {
  await update($, helpAtom, list => (list.includes(topic) ? list.filter(one => one !== topic) : [...list, topic]))
}

async function choosePeriod($: EngineInterface, key: PeriodKey) {
  await update($, periodAtom, () => key)
}

async function chooseView($: EngineInterface, view: View) {
  await update($, viewAtom, () => view)
  await update($, selectedAtom, () => null)
}

async function chooseBoard($: EngineInterface, period: BoardPeriod) {
  await update($, boardAtom, () => period)
  await update($, selectedAtom, () => null)
}

async function selectSession($: EngineInterface, key: string | null) {
  await update($, selectedAtom, () => key)
}

async function compact($: EngineInterface) {
  if (await read($, compactingAtom)) return
  await update($, compactingAtom, () => true)
  try {
    await $.session.compact()
  } finally {
    await update($, compactingAtom, () => false)
  }
}

async function tick($: EngineInterface) {
  await update($, tickAtom, n => n + 1)
}

// The terminal draws no SVG (its table still names one), so it gets glyphs instead.
function kitFor(ui: any, surface: string): Kit {
  return { Box: ui.Box, Text: ui.Text, Button: ui.Button, Markdown: ui.Markdown, Svg: surface === 'terminal' ? undefined : ui.Svg }
}

function actionsFor($: EngineInterface): Actions {
  return {
    openPane: topic => void openPane($, topic),
    toggleHelp: topic => void toggleHelp($, topic),
    choosePeriod: key => void choosePeriod($, key),
    chooseView: view => void chooseView($, view),
    chooseBoard: period => void chooseBoard($, period),
    select: key => void selectSession($, key),
    rescan: () => void rescan($),
    compact: () => void compact($),
  }
}

const num = (value: unknown, fallback: number) => {
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 ? n : fallback
}

export const register: Register = (on, options) => {
  settings = {
    seat: num(options.seatPrice, 0),
    thresholds: {
      warn: num(options.sessionWarn, DEFAULT_THRESHOLDS.warn),
      hot: num(options.sessionHot, DEFAULT_THRESHOLDS.hot),
      fire: num(options.sessionFire, DEFAULT_THRESHOLDS.fire),
      turn: num(options.turnAlert, DEFAULT_THRESHOLDS.turn),
      burn: num(options.burnAlert, DEFAULT_THRESHOLDS.burn),
      ring: num(options.ringAlert, DEFAULT_THRESHOLDS.ring),
    } satisfies Thresholds,
    isFun: options.funMode !== false,
    hasSound: options.sound === true,
  }

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: COMMAND,
      description: 'Show your Claude usage rings, session costs, top sessions and spend over time',
      argumentHint: '[sessions | turns | timeline | demo | rescan]',
    })

    // The last reading, shown until this session's first reply brings a fresh one.
    const stored = (await $.store.get(STORE_LIMITS)) as Limit[] | undefined
    if (Array.isArray(stored) && (await read($, limitsAtom)).length === 0) {
      await update($, limitsAtom, () => stored)
    }
    const usage = await $.session.usage().catch(() => undefined)
    if (usage !== undefined) {
      await takeLimits($, usage.rateLimits)
      await takeContext($, usage.context)
    }

    $.clock.every(60_000, () => void tick($))
    $.clock.every(RESCAN_EVERY, () => void rescan($))
    rescanSoon($, 500)

    return next(e)
  })

  on('command.run', { command: COMMAND }, async ($, e) => {
    const arg = e.args.trim()
    if (arg === 'rescan') {
      await rescan($)
      return { text: 'Usage rings: logs read again.' }
    }
    if (arg === 'demo') {
      await celebrate($, 'coins', 'Demo: this is what passing a milestone looks like.')
      $.clock.after(PARTY_MS + 600, () => void celebrate($, 'fire', 'Demo: and this is a session on fire.'))
      return { text: 'Playing the usage-rings animations above the prompt.' }
    }
    if (arg === 'sessions' || arg === 'turns' || arg === 'timeline') await chooseView($, arg)
    await openPane($)
    return { text: 'Opened the usage panel.' }
  })

  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('rateLimits')) await takeLimits($, e.rateLimits)
    if (e.changed.includes('context')) await takeContext($, e.context)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    rescanSoon($, 2_000)
    return result
  })

  // The band above the prompt. Another mod's band stays, below this one.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e)
    if (e.props.hasSurvey) return below
    const data = {
      limits: await read($, limitsAtom),
      context: await read($, contextAtom),
      report: await read($, reportAtom),
      isCompacting: await read($, compactingAtom),
      isWorking: e.props.isWorking,
      celebration: await read($, celebrationAtom),
      shownCost: await read($, shownCostAtom),
      now: await $.clock.now(),
      bodyColumns: e.props.bodyColumns,
    }
    await read($, tickAtom)
    const ui = $.ui.resolve(e)
    const kit = kitFor(ui, e.surface)
    const mine = band(kit, data, settings, actionsFor($))
    if (mine === null) return below
    if (below === undefined || below === null) return mine
    const { Box } = ui
    return (
      <Box flexDirection="column">
        {mine}
        {below}
      </Box>
    )
  })

  // The panel: overview, top sessions, costly replies and spend over time.
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const data = {
      limits: await read($, limitsAtom),
      context: await read($, contextAtom),
      report: await read($, reportAtom),
      isScanning: await read($, scanningAtom),
      period: await read($, periodAtom),
      view: await read($, viewAtom),
      boardPeriod: await read($, boardAtom),
      selected: await read($, selectedAtom),
      open: await read($, helpAtom),
      now: await $.clock.now(),
      bodyColumns: e.props.bodyColumns,
    }
    await read($, tickAtom)
    const ui = $.ui.resolve(e)
    const kit = kitFor(ui, e.surface)
    return pane(kit, data, settings, actionsFor($))
  })
}
