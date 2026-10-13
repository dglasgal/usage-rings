// Money, token counts, times and the ring pictures, shared by the band and the pane.

export function money(usd: number): string {
  if (usd > 0 && usd < 0.01) return '<$0.01'
  if (usd >= 1000) return `$${Math.round(usd).toLocaleString('en-US')}`
  return `$${usd.toFixed(2)}`
}

export function tokens(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`
  return String(n)
}

export function clock(at: number): string {
  return new Date(at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

export function dateTime(at: number): string {
  return new Date(at).toLocaleString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function span(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60_000))
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ${minutes % 60}m`
  return `${Math.floor(hours / 24)}d ${hours % 24}h`
}

// "resets 3:40 PM" today, "resets Thu 9:00 AM" later in the week.
export function resetShort(resetsAt: string | undefined, now: number): string | undefined {
  if (resetsAt === undefined) return undefined
  const at = Date.parse(resetsAt)
  if (Number.isNaN(at)) return undefined
  if (at <= now) return 'resetting now'
  const isToday = new Date(at).toDateString() === new Date(now).toDateString()
  const day = isToday ? '' : `${new Date(at).toLocaleDateString('en-US', { weekday: 'short' })} `
  return `resets ${day}${clock(at)}`
}

export const LIMIT_LABELS: Record<string, string> = {
  five_hour: '5-hour',
  seven_day: 'Weekly',
  seven_day_opus: 'Weekly · Opus',
  seven_day_sonnet: 'Weekly · Sonnet',
  spend_limit: 'Spend limit',
}

export function limitLabel(kind: string): string {
  return LIMIT_LABELS[kind] ?? kind.replace(/_/g, ' ')
}

export type Level = 'ok' | 'warn' | 'high'

export function level(percent: number): Level {
  return percent >= 85 ? 'high' : percent >= 60 ? 'warn' : 'ok'
}

const RING_COLORS: Record<Level, string> = { ok: '#2f9e62', warn: '#d9922b', high: '#d64545' }
export const TEXT_COLORS: Record<Level, 'success' | 'warning' | 'error'> = {
  ok: 'success',
  warn: 'warning',
  high: 'error',
}

// A ring for the surfaces that draw SVG: the arc is the share used, the number
// in the middle the percent.
export function ringSvg(percent: number, size: number): string {
  const shown = Math.max(0, Math.min(100, percent))
  const radius = 15
  const circumference = 2 * Math.PI * radius
  const arc = (circumference * shown) / 100
  const color = RING_COLORS[level(percent)]
  const label = percent >= 100 ? '100' : String(Math.round(percent))
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 36 36">`,
    `<circle cx="18" cy="18" r="${radius}" fill="none" stroke="#8a8a8a" stroke-opacity="0.28" stroke-width="4"/>`,
    `<circle cx="18" cy="18" r="${radius}" fill="none" stroke="${color}" stroke-width="4" stroke-linecap="round"`,
    ` stroke-dasharray="${arc.toFixed(2)} ${circumference.toFixed(2)}" transform="rotate(-90 18 18)"/>`,
    `<text x="18" y="21.6" text-anchor="middle" font-family="-apple-system, system-ui, sans-serif"`,
    ` font-size="10.5" font-weight="600" fill="#8a8a8a">${label}</text>`,
    '</svg>',
  ].join('')
}

// The terminal's ring: a ten-cell meter.
export function meter(percent: number, cells = 10): string {
  const filled = Math.round((Math.max(0, Math.min(100, percent)) / 100) * cells)
  return '▰'.repeat(filled) + '▱'.repeat(cells - filled)
}
