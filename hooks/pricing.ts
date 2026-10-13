// Anthropic API list prices, US dollars per million tokens.
// Source: https://platform.claude.com/docs/en/about-claude/pricing (read 2026-10-12).
// When Anthropic changes prices, edit this table and bump PRICES_AS_OF.

export const PRICES_AS_OF = 'Oct 12, 2026'

export type Rates = {
  input: number
  write5m: number
  write1h: number
  read: number
  output: number
}

type PriceEntry = {
  prefix: string
  name: string
  rates: Rates
  // Haiku 5.5 bills a request whose whole prompt is over 100,000 tokens at these rates.
  overThreshold?: { tokens: number; rates: Rates }
  // Fast mode doubles input and output; the page lists no cache multiplier, so the
  // same 2x is applied to every category.
  hasFastMode?: boolean
}

const r = (input: number, write5m: number, write1h: number, read: number, output: number): Rates => ({
  input,
  write5m,
  write1h,
  read,
  output,
})

// Longest prefix first, so `claude-opus-4-1` wins over `claude-opus-4`.
const TABLE: PriceEntry[] = [
  { prefix: 'claude-fable-5-1', name: 'Fable 5.1', rates: r(10, 12.5, 20, 0.25, 50) },
  { prefix: 'claude-mythos-5-1', name: 'Mythos 5.1', rates: r(10, 12.5, 20, 0.25, 50) },
  { prefix: 'claude-fable-5', name: 'Fable 5', rates: r(10, 12.5, 20, 1, 50) },
  { prefix: 'claude-mythos-5', name: 'Mythos 5', rates: r(10, 12.5, 20, 1, 50) },
  { prefix: 'claude-opus-5-5', name: 'Opus 5.5', rates: r(4, 5, 8, 0.2, 20), hasFastMode: true },
  { prefix: 'claude-opus-5', name: 'Opus 5', rates: r(5, 6.25, 10, 0.5, 25), hasFastMode: true },
  { prefix: 'claude-opus-4-8', name: 'Opus 4.8', rates: r(5, 6.25, 10, 0.5, 25), hasFastMode: true },
  { prefix: 'claude-opus-4-7', name: 'Opus 4.7', rates: r(5, 6.25, 10, 0.5, 25) },
  { prefix: 'claude-opus-4-6', name: 'Opus 4.6', rates: r(5, 6.25, 10, 0.5, 25) },
  { prefix: 'claude-opus-4-5', name: 'Opus 4.5', rates: r(5, 6.25, 10, 0.5, 25) },
  { prefix: 'claude-opus-4-1', name: 'Opus 4.1', rates: r(15, 18.75, 30, 1.5, 75) },
  { prefix: 'claude-opus-4', name: 'Opus 4', rates: r(15, 18.75, 30, 1.5, 75) },
  { prefix: 'claude-sonnet-5-5', name: 'Sonnet 5.5', rates: r(2, 2.5, 4, 0.1, 10) },
  { prefix: 'claude-sonnet-5', name: 'Sonnet 5', rates: r(2, 2.5, 4, 0.2, 10) },
  { prefix: 'claude-sonnet-4-6', name: 'Sonnet 4.6', rates: r(3, 3.75, 6, 0.3, 15) },
  { prefix: 'claude-sonnet-4-5', name: 'Sonnet 4.5', rates: r(3, 3.75, 6, 0.3, 15) },
  { prefix: 'claude-sonnet-4', name: 'Sonnet 4', rates: r(3, 3.75, 6, 0.3, 15) },
  {
    prefix: 'claude-haiku-5-5',
    name: 'Haiku 5.5',
    rates: r(0.1, 0.125, 0.2, 0.01, 0.5),
    overThreshold: { tokens: 100_000, rates: r(0.5, 0.625, 1, 0.05, 2.5) },
  },
  { prefix: 'claude-haiku-4-5', name: 'Haiku 4.5', rates: r(1, 1.25, 2, 0.1, 5) },
  { prefix: 'claude-3-5-haiku', name: 'Haiku 3.5', rates: r(0.8, 1, 1.6, 0.08, 4) },
]

// The models the "what if" table prices everything on.
export const WHAT_IF_MODELS = ['claude-fable-5-1', 'claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'] as const

export type Tokens = {
  input: number
  output: number
  write5m: number
  write1h: number
  read: number
}

export type Usage = Tokens & { isFast: boolean; isUsOnly: boolean }

function entryFor(model: string): PriceEntry | undefined {
  return TABLE.find(one => model === one.prefix || model.startsWith(one.prefix + '-'))
}

export function modelName(model: string): string {
  return entryFor(model)?.name ?? model
}

export function isPriced(model: string): boolean {
  return entryFor(model) !== undefined
}

// What one request cost at API list prices, or undefined for a model not in the table.
export function costOf(model: string, usage: Usage): number | undefined {
  const entry = entryFor(model)
  if (entry === undefined) return undefined

  const prompt = usage.input + usage.write5m + usage.write1h + usage.read
  const rates =
    entry.overThreshold !== undefined && prompt > entry.overThreshold.tokens
      ? entry.overThreshold.rates
      : entry.rates
  const base =
    (usage.input * rates.input +
      usage.write5m * rates.write5m +
      usage.write1h * rates.write1h +
      usage.read * rates.read +
      usage.output * rates.output) /
    1_000_000
  const fast = usage.isFast && entry.hasFastMode ? 2 : 1
  const usOnly = usage.isUsOnly ? 1.1 : 1

  return base * fast * usOnly
}
