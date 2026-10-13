export type Source = 'code' | 'cowork'

export type PeriodKey = 'session' | 'window' | 'week' | 'today' | 'month'

// The periods the leaderboard, the costly replies and the charts cover.
export type BoardPeriod = 'today' | 'week' | 'month'

// Which page of the panel is showing.
export type View = 'overview' | 'sessions' | 'turns' | 'timeline'

// One plan limit as Anthropic last reported it.
export type Limit = {
  kind: string
  percentUsed: number
  resetsAt?: string
  // When this reading arrived (ms).
  seenAt: number
}

// How full this conversation's context window is.
export type Context = { tokens?: number; window: number; percent?: number }

export type ModelLine = {
  model: string
  name: string
  requests: number
  tokens: number
  // null for a model the price table does not know.
  cost: number | null
}

export type PeriodReport = {
  key: PeriodKey
  label: string
  startsAt: number
  requests: number
  total: number
  unpricedTokens: number
  byModel: ModelLine[]
  bySource: Record<Source, { requests: number; cost: number }>
  whatIf: { model: string; name: string; cost: number }[]
}

// One reply, among the most expensive.
export type TurnLine = {
  at: number
  session: string
  title: string
  model: string
  tokens: number
  cost: number
  // What made it expensive, in a few words.
  reason: string
}

// One session on the leaderboard: what it spent within the period.
export type SessionLine = {
  key: string
  source: Source
  title: string
  project?: string
  startedAt: number
  lastAt: number
  replies: number
  tokens: number
  cost: number
  // Dollars per hour of active time: gaps over 30 minutes between replies are
  // breaks and do not count (at least 15 minutes).
  burnPerHour: number
  // Share of its tokens that were the conversation being re-read from the cache.
  rereadShare: number
  byModel: ModelLine[]
  topTurns: TurnLine[]
}

// This conversation, for the band and the alerts.
export type Current = {
  key: string
  cost: number
  // What it spent in the last hour.
  lastHour: number
  replies: number
  // The newest reply and what it cost.
  lastTurn?: TurnLine
}

export type Report = {
  builtAt: number
  periods: Record<PeriodKey, PeriodReport>
  sessions: Record<BoardPeriod, SessionLine[]>
  turns: Record<BoardPeriod, TurnLine[]>
  // Spend per hour today (24) and per day this month (days so far).
  hourly: number[]
  daily: number[]
  current: Current | null
  // Things the person should know about this count (a log left out, no jq).
  notes: string[]
}

// A moment the band celebrates (or mourns): coins when a milestone passes.
export type Celebration = { kind: 'coins' | 'fire'; text: string; until: number }

declare module 'claude-code' {
  interface PluginState {
    'usage-rings': {
      limits: Limit[]
      context: Context | null
      isCompacting: boolean
      report: Report | null
      isScanning: boolean
      period: PeriodKey
      // Which "?" explanations are open, by topic.
      openHelp: string[]
      // Bumped each minute so the countdowns redraw.
      tick: number
      view: View
      boardPeriod: BoardPeriod
      // The session the leaderboard has open, by key.
      selected: string | null
      celebration: Celebration | null
      // The session cost as the band shows it while it counts up to the real one.
      shownCost: number | null
    }
  }
}
