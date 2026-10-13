import type { RenderElement } from 'claude-code'

import { heat } from './alerts'
import type { Thresholds } from './alerts'
import * as f from './format'
import { barsSvg, fireEmoji, flamesSvg, moneyRainSvg, sparkline } from './graphics'
import * as help from './help'
import { BOARD_LABELS, PERIOD_LABELS } from './report'
import type {
  BoardPeriod,
  Celebration,
  Context,
  Limit,
  PeriodKey,
  PeriodReport,
  Report,
  SessionLine,
  TurnLine,
  View,
} from '../types'

// The band and the panel, drawn from plain data. What a press does comes in as
// `Actions`, made in register.tsx where the engine is reachable.

export type Kit = {
  Box: any
  Text: any
  Button: any
  Markdown: any
  Svg?: any
}

export type Actions = {
  openPane: (topic?: string) => void
  toggleHelp: (topic: string) => void
  choosePeriod: (key: PeriodKey) => void
  chooseView: (view: View) => void
  chooseBoard: (period: BoardPeriod) => void
  select: (key: string | null) => void
  rescan: () => void
  compact: () => void
}

export type Settings = { seat: number; thresholds: Thresholds; isFun: boolean }

const VIEW_LABELS: Record<View, string> = {
  overview: 'Overview',
  sessions: 'Top sessions',
  turns: 'Costly replies',
  timeline: 'Over time',
}

const plural = (n: number, one: string) => `${n.toLocaleString('en-US')} ${one}${n === 1 ? '' : 's'}`

function ring(kit: Kit, percent: number, size: number, alt: string, cells: number): RenderElement {
  return kit.Svg !== undefined ? (
    <kit.Svg source={f.ringSvg(percent, size)} alt={alt} width={size} height={size} />
  ) : (
    <kit.Text color={f.TEXT_COLORS[f.level(percent)]}>{f.meter(percent, cells)}</kit.Text>
  )
}

function flames(kit: Kit, level: number, height: number): RenderElement | null {
  if (level <= 0) return null
  return kit.Svg !== undefined ? (
    <kit.Svg source={flamesSvg(level, height)} alt={`${level} of 3 flames`} height={height} isInteractive />
  ) : (
    <kit.Text>{fireEmoji(level)}</kit.Text>
  )
}

const heatColor = (level: number) => (level >= 2 ? 'error' : level === 1 ? 'warning' : undefined)

// ——— The band ———

export type BandData = {
  limits: readonly Limit[]
  context: Context | null
  report: Report | null
  isCompacting: boolean
  isWorking: boolean
  celebration: Celebration | null
  shownCost: number | null
  now: number
  bodyColumns: number
}

export function band(kit: Kit, data: BandData, settings: Settings, act: Actions): RenderElement | null {
  const { Box, Text, Button } = kit
  const { limits, context, report, now } = data
  if (limits.length === 0 && context === null && report === null) return null

  const level = heat(report?.current ?? null, settings.thresholds)
  const items: RenderElement[] = []

  if (report?.current != null) {
    const cost = data.shownCost ?? report.current.cost
    items.push(
      <Box key="session" flexDirection="row" alignItems="center" gap={1}>
        {settings.isFun && flames(kit, level, 20)}
        <Text bold color={heatColor(level)}>
          Session {f.money(cost)}
        </Text>
        <Button key="help-session-band" plain onPress={() => act.openPane('session')}>
          <Text dimColor>?</Text>
        </Button>
      </Box>,
    )
  }
  if (context?.percent !== undefined) {
    items.push(
      <Box key="ctx" flexDirection="row" alignItems="center" gap={1}>
        {ring(kit, context.percent, 22, `Context ${Math.round(context.percent)}% full`, 6)}
        <Text>Context {Math.round(context.percent)}%</Text>
        <Button key="help-ctx" plain onPress={() => act.openPane('context')}>
          <Text dimColor>?</Text>
        </Button>
      </Box>,
    )
  }
  for (const limit of limits) {
    const reset = f.resetShort(limit.resetsAt, now)
    items.push(
      <Box key={`limit-${limit.kind}`} flexDirection="row" alignItems="center" gap={1}>
        {ring(kit, limit.percentUsed, 22, `${f.limitLabel(limit.kind)} limit ${limit.percentUsed}% used`, 6)}
        <Text>
          {f.limitLabel(limit.kind)} {Math.round(limit.percentUsed)}%
        </Text>
        {reset !== undefined && <Text dimColor>{reset}</Text>}
        <Button key={`help-${limit.kind}`} plain onPress={() => act.openPane(`limit:${limit.kind}`)}>
          <Text dimColor>?</Text>
        </Button>
      </Box>,
    )
  }
  if (report !== null) {
    const month = report.periods.month.total
    const ratio = settings.seat > 0 ? ` (${(month / settings.seat).toFixed(1)}× seat)` : ''
    items.push(
      <Text key="cost" dimColor>
        Today {f.money(report.periods.today.total)} · Month {f.money(month)}
        {ratio}
      </Text>,
    )
  }

  const row = (
    <Box key="row" flexDirection="row" flexWrap="wrap" alignItems="center" columnGap={3}>
      {items}
      <Button key="details" plain onPress={() => act.openPane()}>
        <Text color="suggestion">Details</Text>
      </Button>
      {context?.percent !== undefined && context.percent >= 70 && !data.isWorking && (
        <Button key="compact" plain onPress={() => act.compact()}>
          <Text color="warning">{data.isCompacting ? 'Compacting…' : 'Compact'}</Text>
        </Button>
      )}
    </Box>
  )

  const party = data.celebration !== null && data.celebration.until > now ? data.celebration : null
  if (party === null || !settings.isFun) return row
  const width = Math.max(240, Math.min(900, data.bodyColumns * 8))
  return (
    <Box flexDirection="column">
      {kit.Svg !== undefined ? (
        <Box key="party" flexDirection="row" alignItems="center" gap={2}>
          <kit.Svg
            source={party.kind === 'fire' ? flamesSvg(3, 40) : moneyRainSvg(Math.round(width * 0.45), 40)}
            alt={party.kind === 'fire' ? 'Flames' : 'Falling money'}
            height={40}
            isInteractive
          />
          <Text bold color={party.kind === 'fire' ? 'error' : 'warning'}>
            {party.text}
          </Text>
          {party.kind === 'coins' && (
            <kit.Svg source={moneyRainSvg(Math.round(width * 0.3), 40, 11)} alt="Falling money" height={40} isInteractive />
          )}
        </Box>
      ) : (
        <Text key="party" bold color={party.kind === 'fire' ? 'error' : 'warning'}>
          {party.kind === 'fire' ? '🔥🔥🔥 ' : '💰💸💰 '}
          {party.text}
          {party.kind === 'fire' ? ' 🔥🔥🔥' : ' 💸💰💸'}
        </Text>
      )}
      {row}
    </Box>
  )
}

// ——— The panel ———

export type PaneData = {
  limits: readonly Limit[]
  context: Context | null
  report: Report | null
  isScanning: boolean
  period: PeriodKey
  view: View
  boardPeriod: BoardPeriod
  selected: string | null
  open: readonly string[]
  now: number
  bodyColumns: number
}

export function pane(kit: Kit, data: PaneData, settings: Settings, act: Actions): RenderElement {
  const { Box, Text, Button } = kit
  const helpButton = (topic: string) => (
    <Button key={`help-${topic}`} plain onPress={() => act.toggleHelp(topic)}>
      <Text color="suggestion">{data.open.includes(topic) ? '[hide]' : '[?]'}</Text>
    </Button>
  )
  const helpText = (topic: string, text: string) =>
    data.open.includes(topic) ? (
      <Box key={`help-text-${topic}`} marginLeft={2} marginTop={1}>
        <kit.Markdown text={text} />
      </Box>
    ) : null
  const parts = { kit, data, settings, act, helpButton, helpText }

  const tabs = (Object.keys(VIEW_LABELS) as View[]).map(view => (
    <Button
      key={`view-${view}`}
      variant={view === data.view ? 'primary' : 'secondary'}
      onPress={() => act.chooseView(view)}
    >
      {VIEW_LABELS[view]}
    </Button>
  ))

  const body =
    data.report === null
      ? [
          <Text key="loading" dimColor>
            {data.isScanning ? 'Reading your Claude Code and Cowork logs…' : 'Costs appear once the logs are read.'}
          </Text>,
        ]
      : data.view === 'sessions'
        ? data.selected !== null
          ? sessionDetail(parts, data.report)
          : leaderboard(parts, data.report)
        : data.view === 'turns'
          ? costlyTurns(parts, data.report)
          : data.view === 'timeline'
            ? timeline(parts, data.report)
            : overview(parts, data.report)

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box flexDirection="row" flexWrap="wrap" gap={1} marginBottom={1}>
        {tabs}
      </Box>
      {data.view === 'overview' && limitsSection(parts)}
      {body}
      <Box flexDirection="row" alignItems="center" gap={2} marginTop={1}>
        <Text dimColor>
          {data.isScanning ? 'Reading logs…' : data.report === null ? '' : `Logs read at ${f.clock(data.report.builtAt)}`}
        </Text>
        {helpButton('sources')}
        <Button key="rescan" plain onPress={() => act.rescan()}>
          <Text color="suggestion">Read again</Text>
        </Button>
      </Box>
      {helpText('sources', help.sourcesHelp(data.report?.builtAt, data.report?.notes ?? []))}
    </Box>
  )
}

type Parts = {
  kit: Kit
  data: PaneData
  settings: Settings
  act: Actions
  helpButton: (topic: string) => RenderElement
  helpText: (topic: string, text: string) => RenderElement | null
}

function heading(parts: Parts, key: string, title: string, note?: string, topic?: string): RenderElement {
  const { Box, Text } = parts.kit
  return (
    <Box key={key} flexDirection="row" alignItems="center" gap={2} marginTop={1}>
      <Text bold>{title}</Text>
      {note !== undefined && <Text dimColor>{note}</Text>}
      {topic !== undefined && parts.helpButton(topic)}
    </Box>
  )
}

function limitsSection(parts: Parts): RenderElement {
  const { kit, data } = parts
  const { Box, Text } = kit
  const block = (topic: string, percent: number, title: string, detail: string | undefined, text: string) => (
    <Box key={`ring-${topic}`} flexDirection="column" marginBottom={1}>
      <Box flexDirection="row" alignItems="center" gap={2}>
        {ring(kit, percent, 44, `${title} ${Math.round(percent)}%`, 10)}
        <Box flexDirection="column">
          <Text bold>
            {title} · {Math.round(percent)}% used
          </Text>
          {detail !== undefined && <Text dimColor>{detail}</Text>}
        </Box>
        {parts.helpButton(topic)}
      </Box>
      {parts.helpText(topic, text)}
    </Box>
  )
  const rings: RenderElement[] = []
  if (data.context?.percent !== undefined) {
    const c = data.context
    const detail = c.tokens === undefined ? undefined : `${f.tokens(c.tokens)} of ${f.tokens(c.window)} tokens`
    rings.push(block('context', c.percent ?? 0, 'Context', detail, help.contextHelp(c)))
  }
  for (const limit of data.limits) {
    const at = limit.resetsAt === undefined ? undefined : Date.parse(limit.resetsAt)
    const detail = at === undefined ? undefined : `${f.resetShort(limit.resetsAt, data.now)} · in ${f.span(at - data.now)}`
    rings.push(block(`limit:${limit.kind}`, limit.percentUsed, `${f.limitLabel(limit.kind)} limit`, detail, help.limitHelp(limit, data.now)))
  }
  if (data.limits.length === 0) {
    rings.push(
      <Text key="no-limits" dimColor>
        Plan limits show after your next reply from Claude.
      </Text>,
    )
  }
  return (
    <Box key="limits" flexDirection="column">
      <Text bold>Limits</Text>
      <Box flexDirection="column" marginTop={1}>
        {rings}
      </Box>
    </Box>
  )
}

function overview(parts: Parts, report: Report): RenderElement[] {
  const { kit, data, settings, act } = parts
  const { Box, Text, Button } = kit
  const out: RenderElement[] = []

  // This conversation, up front: what it has cost and how hot it is running.
  const current = report.current
  if (current !== null) {
    const level = heat(current, settings.thresholds)
    const next = [settings.thresholds.warn, settings.thresholds.hot, settings.thresholds.fire].find(mark => mark > current.cost)
    out.push(
      <Box key="current" flexDirection="column" marginBottom={1}>
        <Box flexDirection="row" alignItems="center" gap={2}>
          {settings.isFun && flames(kit, level, 34)}
          <Box flexDirection="column">
            <Text bold color={heatColor(level)}>
              This session · {f.money(current.cost)} at API prices
            </Text>
            <Text dimColor>
              {plural(current.replies, 'reply')} · {f.money(current.lastHour)} in the last hour
              {next !== undefined ? ` · next alert at ${f.money(next)}` : ''}
            </Text>
          </Box>
          {parts.helpButton('session')}
        </Box>
        {parts.helpText('session', help.sessionHelp(settings.thresholds))}
      </Box>,
    )
  }

  const tabs = (Object.keys(PERIOD_LABELS) as PeriodKey[]).map(key => (
    <Button key={`period-${key}`} variant={key === data.period ? 'primary' : 'secondary'} onPress={() => act.choosePeriod(key)}>
      {PERIOD_LABELS[key]}
    </Button>
  ))
  out.push(
    <Text key="cost-title" bold>
      Cost at API prices
    </Text>,
    <Box key="period-tabs" flexDirection="row" flexWrap="wrap" gap={1} marginTop={1} marginBottom={1}>
      {tabs}
    </Box>,
  )
  out.push(...costSections(parts, report.periods[data.period], report))
  return out
}

function sinceText(shown: PeriodReport): string {
  const when = (options: Intl.DateTimeFormatOptions) => new Date(shown.startsAt).toLocaleString('en-US', options)
  if (shown.key === 'session') return `Since this conversation started, ${when({ weekday: 'short', hour: 'numeric', minute: '2-digit' })}`
  if (shown.key === 'today') return 'Since midnight'
  if (shown.key === 'month') return `Since ${when({ month: 'long', day: 'numeric' })}`
  return `Since ${when({ weekday: 'short', hour: 'numeric', minute: '2-digit' })}`
}

function modelTable(lines: PeriodReport['byModel'], requests: number, total: number): string {
  return [
    '| Model | Replies | Tokens | API cost |',
    '|---|---:|---:|---:|',
    ...lines.map(
      line => `| ${line.name} | ${line.requests.toLocaleString('en-US')} | ${f.tokens(line.tokens)} | ${line.cost === null ? 'no price' : f.money(line.cost)} |`,
    ),
    `| **Total** | **${requests.toLocaleString('en-US')}** | **${f.tokens(lines.reduce((sum, line) => sum + line.tokens, 0))}** | **${f.money(total)}** |`,
  ].join('\n')
}

function costSections(parts: Parts, shown: PeriodReport, report: Report): RenderElement[] {
  const { kit, settings } = parts
  const { Box, Text } = kit
  const out: RenderElement[] = [heading(parts, 'used-head', 'What you used', sinceText(shown), 'used')]
  const usedHelp = parts.helpText('used', help.usedHelp())
  if (usedHelp !== null) out.push(usedHelp)
  const used =
    shown.requests === 0
      ? shown.key === 'session'
        ? '_No replies in this conversation yet._'
        : '_No Claude Code or Cowork replies in this period._'
      : modelTable(shown.byModel, shown.requests, shown.total)
  out.push(
    <Box key="used-table" marginTop={1}>
      <kit.Markdown text={used} />
    </Box>,
  )
  if (shown.requests > 0) {
    out.push(
      <Text key="split" dimColor>
        Claude Code {f.money(shown.bySource.code.cost)} ({plural(shown.bySource.code.requests, 'reply')}) · Cowork{' '}
        {f.money(shown.bySource.cowork.cost)} ({plural(shown.bySource.cowork.requests, 'reply')})
      </Text>,
    )
  }
  if (shown.unpricedTokens > 0) {
    out.push(
      <Text key="unpriced" dimColor>
        {f.tokens(shown.unpricedTokens)} tokens from models not in the price table are left out of the total.
      </Text>,
    )
  }
  if (shown.requests > 0) {
    out.push(heading(parts, 'whatif-head', 'What if', undefined, 'whatif'))
    const whatIfHelp = parts.helpText('whatif', help.whatIfHelp())
    if (whatIfHelp !== null) out.push(whatIfHelp)
    const table = [
      '| If every reply came from | API cost | vs actual |',
      '|---|---:|---:|',
      ...shown.whatIf.map(one => `| ${one.name} | ${f.money(one.cost)} | ${shown.total > 0 ? `${(one.cost / shown.total).toFixed(2)}×` : '—'} |`),
    ].join('\n')
    out.push(
      <Box key="whatif-table" marginTop={1}>
        <kit.Markdown text={table} />
      </Box>,
    )
  }
  const month = report.periods.month.total
  out.push(heading(parts, 'seat-head', 'Your seat', undefined, 'seat'))
  const seatHelp = parts.helpText('seat', help.seatHelp(settings.seat, month))
  if (seatHelp !== null) out.push(seatHelp)
  out.push(
    <Box key="seat-line" marginTop={1}>
      <kit.Markdown
        text={
          settings.seat > 0
            ? `This month: **${f.money(month)}** at API prices vs your **${f.money(settings.seat)}** seat: **${(month / settings.seat).toFixed(1)}×**`
            : `This month: **${f.money(month)}** at API prices. Set your seat price to compare.`
        }
      />
    </Box>,
  )
  return out
}

function boardTabs(parts: Parts): RenderElement {
  const { kit, data, act } = parts
  return (
    <kit.Box key="board-tabs" flexDirection="row" flexWrap="wrap" gap={1} marginBottom={1}>
      {(Object.keys(BOARD_LABELS) as BoardPeriod[]).map(key => (
        <kit.Button key={`board-${key}`} variant={key === data.boardPeriod ? 'primary' : 'secondary'} onPress={() => act.chooseBoard(key)}>
          {BOARD_LABELS[key]}
        </kit.Button>
      ))}
    </kit.Box>
  )
}

const levelOf = (cost: number, t: Thresholds) => (cost >= t.fire ? 3 : cost >= t.hot ? 2 : cost >= t.warn ? 1 : 0)

function leaderboard(parts: Parts, report: Report): RenderElement[] {
  const { kit, data, settings, act } = parts
  const { Box, Text, Button } = kit
  const lines = report.sessions[data.boardPeriod]
  const total = report.periods[data.boardPeriod === 'today' ? 'today' : data.boardPeriod === 'week' ? 'week' : 'month'].total
  const out: RenderElement[] = [
    heading(parts, 'board-head', 'Your most expensive sessions', 'click one for its breakdown', 'board'),
  ]
  const boardHelp = parts.helpText('board', help.boardHelp())
  if (boardHelp !== null) out.push(boardHelp)
  out.push(boardTabs(parts))
  if (lines.length === 0) {
    out.push(
      <Text key="board-empty" dimColor>
        No sessions in this period.
      </Text>,
    )
    return out
  }
  const top = lines[0]?.cost ?? 1
  lines.forEach((line, i) => {
    const level = levelOf(line.cost, settings.thresholds)
    const share = total > 0 ? Math.round((line.cost / total) * 100) : 0
    const isThis = line.key === report.current?.key
    out.push(
      <Box key={`board-row-${line.key}`} flexDirection="column" marginBottom={1}>
        <Button key={`open-${line.key}`} plain onPress={() => act.select(line.key)}>
          {`${i + 1}. `}
          <Text bold color={heatColor(level)}>
            {f.money(line.cost)}
          </Text>
          {` ${line.title}`}
          {settings.isFun && level > 0 ? ` ${fireEmoji(level)}` : ''}
          {isThis ? <Text color="suggestion"> (this session)</Text> : ''}
        </Button>
        <Text dimColor>
          {'   '}
          {f.meter((line.cost / top) * 100, 12)} {share}% of {BOARD_LABELS[data.boardPeriod].toLowerCase()}'s spend ·{' '}
          {line.source === 'cowork' ? 'Cowork' : (line.project ?? 'Claude Code')} · {plural(line.replies, 'reply')} · {f.tokens(line.tokens)} tokens ·{' '}
          {f.money(line.burnPerHour)}/active hour
        </Text>
      </Box>,
    )
  })
  return out
}

function sessionDetail(parts: Parts, report: Report): RenderElement[] {
  const { kit, data, settings, act } = parts
  const { Box, Text, Button } = kit
  const line = (Object.values(report.sessions) as SessionLine[][]).flat().find(one => one.key === data.selected)
  const back = (
    <Button key="back" plain onPress={() => act.select(null)}>
      <Text color="suggestion">← All sessions</Text>
    </Button>
  )
  if (line === undefined) {
    return [
      back,
      <Text key="gone" dimColor>
        That session is no longer in the list.
      </Text>,
    ]
  }
  const level = levelOf(line.cost, settings.thresholds)
  const minutes = Math.round((line.lastAt - line.startedAt) / 60_000)
  const reread = Math.round(line.rereadShare * 100)
  const out: RenderElement[] = [
    back,
    <Box key="detail-head" flexDirection="row" alignItems="center" gap={2} marginTop={1}>
      {settings.isFun && flames(kit, level, 30)}
      <Box flexDirection="column">
        <Text bold color={heatColor(level)}>
          {line.title} · {f.money(line.cost)}
        </Text>
        <Text dimColor>
          {line.source === 'cowork' ? 'Cowork' : (line.project ?? 'Claude Code')} · started {f.dateTime(line.startedAt)} · active{' '}
          {f.span(minutes * 60_000)} · {plural(line.replies, 'reply')} · {f.money(line.burnPerHour)}/hour
        </Text>
      </Box>
    </Box>,
    <Box key="detail-models" marginTop={1}>
      <kit.Markdown text={modelTable(line.byModel, line.replies, line.cost)} />
    </Box>,
    heading(parts, 'detail-reread', 'Re-reading', `${reread}% of its tokens were the conversation being re-read`, 'reread'),
  ]
  const rereadHelp = parts.helpText('reread', help.rereadHelp(reread))
  if (rereadHelp !== null) out.push(rereadHelp)
  out.push(heading(parts, 'detail-turns', 'Its most expensive replies'))
  out.push(
    <Box key="detail-turn-table" marginTop={1}>
      <kit.Markdown text={turnTable(line.topTurns, false)} />
    </Box>,
  )
  return out
}

function turnTable(turns: readonly TurnLine[], withSession: boolean): string {
  if (turns.length === 0) return '_No replies._'
  const head = withSession
    ? '| When | Session | Why it cost this much | Tokens | Cost |\n|---|---|---|---:|---:|'
    : '| When | Why it cost this much | Model | Tokens | Cost |\n|---|---|---|---:|---:|'
  const rows = turns.map(turn => {
    const when = new Date(turn.at).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' })
    const title = turn.title.replace(/\|/g, '/')
    return withSession
      ? `| ${when} | ${title} | ${turn.reason} (${turn.model}) | ${f.tokens(turn.tokens)} | **${f.money(turn.cost)}** |`
      : `| ${when} | ${turn.reason} | ${turn.model} | ${f.tokens(turn.tokens)} | **${f.money(turn.cost)}** |`
  })
  return [head, ...rows].join('\n')
}

function costlyTurns(parts: Parts, report: Report): RenderElement[] {
  const { kit, data } = parts
  const out: RenderElement[] = [heading(parts, 'turns-head', 'Your most expensive replies', undefined, 'turns')]
  const turnsHelp = parts.helpText('turns', help.turnsHelp())
  if (turnsHelp !== null) out.push(turnsHelp)
  out.push(boardTabs(parts))
  out.push(
    <kit.Box key="turn-table">
      <kit.Markdown text={turnTable(report.turns[data.boardPeriod], true)} />
    </kit.Box>,
  )
  return out
}

function timeline(parts: Parts, report: Report): RenderElement[] {
  const { kit, data } = parts
  const { Box, Text } = kit
  const width = Math.max(300, Math.min(640, data.bodyColumns * 8))
  const hourLabels = report.hourly.map((_, h) => (h % 6 === 0 ? (h === 0 ? '12a' : h === 12 ? '12p' : h < 12 ? `${h}a` : `${h - 12}p`) : ''))
  const dayLabels = report.daily.map((_, d) => (d === 0 || (d + 1) % 5 === 0 ? String(d + 1) : ''))
  const chart = (key: string, values: number[], labels: string[], alt: string) =>
    kit.Svg !== undefined ? (
      <kit.Svg key={key} source={barsSvg(values, width, 90, labels)} alt={alt} width={width} height={90} isInteractive />
    ) : (
      <Text key={key} color="warning">
        {sparkline(values)}
      </Text>
    )
  const peakHour = report.hourly.indexOf(Math.max(...report.hourly))
  const peakDay = report.daily.indexOf(Math.max(...report.daily))
  return [
    heading(parts, 'today-head', 'Today, by hour', `${f.money(report.periods.today.total)} in all`),
    chart('today-chart', report.hourly, hourLabels, 'Spend by hour today'),
    <Text key="today-peak" dimColor>
      {report.periods.today.total > 0 ? `Busiest hour: ${hourLabels[peakHour] || `${peakHour}:00`} (${f.money(report.hourly[peakHour] ?? 0)})` : 'Nothing yet today.'}
    </Text>,
    heading(parts, 'month-head', 'This month, by day', `${f.money(report.periods.month.total)} in all`),
    chart('month-chart', report.daily, dayLabels, 'Spend by day this month'),
    <Box key="month-peak" flexDirection="column">
      <Text dimColor>
        {report.periods.month.total > 0
          ? `Busiest day: the ${peakDay + 1}${['st', 'nd', 'rd'][((peakDay + 1) % 10) - 1] && ![11, 12, 13].includes(peakDay + 1) ? ['st', 'nd', 'rd'][((peakDay + 1) % 10) - 1] : 'th'} (${f.money(report.daily[peakDay] ?? 0)}) · average ${f.money(report.periods.month.total / Math.max(1, report.daily.length))} a day`
          : 'Nothing yet this month.'}
      </Text>
    </Box>,
  ]
}
