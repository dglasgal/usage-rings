import { limitLabel, money, resetShort, tokens } from './format'
import type { Current, Limit } from '../types'

// When to speak up. Every figure is at API prices; each person can change them.
export type Thresholds = {
  warn: number
  hot: number
  fire: number
  turn: number
  burn: number
  ring: number
}

export const DEFAULT_THRESHOLDS: Thresholds = { warn: 25, hot: 50, fire: 100, turn: 5, burn: 50, ring: 80 }

export type Alert = {
  // Each alert fires once: its id is remembered.
  id: string
  text: string
  // A Mac notification as well as the note in Claude Code.
  shouldNotify: boolean
  celebration?: 'coins' | 'fire'
}

// 0 calm, 1 warm, 2 hot, 3 on fire.
export function heat(current: Current | null, t: Thresholds): 0 | 1 | 2 | 3 {
  if (current === null) return 0
  if (current.cost >= t.fire) return 3
  if (current.cost >= t.hot || current.lastHour >= t.burn) return 2
  if (current.cost >= t.warn || current.lastHour >= t.burn / 2) return 1
  return 0
}

export function sessionAlerts(current: Current | null, t: Thresholds, now: number): Alert[] {
  if (current === null || current.replies === 0) return []
  const alerts: Alert[] = []
  const milestones: [number, 'coins' | 'fire'][] = [
    [t.warn, 'coins'],
    [t.hot, 'coins'],
    [t.fire, 'fire'],
  ]
  for (const [mark, celebration] of milestones) {
    if (mark > 0 && current.cost >= mark) {
      alerts.push({
        id: `session:${current.key}:${mark}`,
        text: `This session just passed ${money(mark)} at API prices (${money(current.cost)} so far).`,
        shouldNotify: mark >= t.hot,
        celebration,
      })
    }
  }
  const turn = current.lastTurn
  if (turn !== undefined && t.turn > 0 && turn.cost >= t.turn) {
    alerts.push({
      id: `turn:${current.key}:${turn.at}`,
      text: `That reply cost ${money(turn.cost)} at API prices (${turn.model}, ${tokens(turn.tokens)} tokens).`,
      shouldNotify: false,
      celebration: 'coins',
    })
  }
  if (t.burn > 0 && current.lastHour >= t.burn) {
    alerts.push({
      id: `burn:${current.key}:${Math.floor(now / 3_600_000)}`,
      text: `This session has spent ${money(current.lastHour)} in the last hour. Compacting, or a smaller model for simple steps, slows it down.`,
      shouldNotify: true,
      celebration: 'fire',
    })
  }
  return alerts
}

export function limitAlerts(limits: readonly Limit[], t: Thresholds, now: number): Alert[] {
  const alerts: Alert[] = []
  for (const limit of limits) {
    for (const mark of [t.ring, 95]) {
      if (mark <= 0 || limit.percentUsed < mark || (mark === 95 && t.ring >= 95)) continue
      const reset = resetShort(limit.resetsAt, now)
      alerts.push({
        id: `limit:${limit.kind}:${limit.resetsAt ?? 'none'}:${mark}`,
        text: `${limitLabel(limit.kind)} limit at ${Math.round(limit.percentUsed)}%${reset === undefined ? '' : `, ${reset}`}.`,
        shouldNotify: mark >= 95,
      })
    }
  }
  return alerts
}
