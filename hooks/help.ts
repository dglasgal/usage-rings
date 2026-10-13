import { clock, dateTime, money, span, tokens } from './format'
import { PRICES_AS_OF } from './pricing'
import type { Context, Limit } from '../types'

// The text behind each "?" button, in plain language.

function resetLine(limit: Limit, now: number): string {
  if (limit.resetsAt === undefined) return '- **Resets:** Anthropic did not say when.'
  const at = Date.parse(limit.resetsAt)
  return `- **Resets:** ${dateTime(at)} (in ${span(at - now)}).`
}

function asOf(limit: Limit, now: number): string {
  const age = now - limit.seenAt
  return age < 90_000 ? 'just now' : `at ${clock(limit.seenAt)}, ${span(age)} ago`
}

export function limitHelp(limit: Limit, now: number): string {
  const reading = `This ring shows **${limit.percentUsed}%** used, as Anthropic reported it with your most recent reply (${asOf(limit, now)}). It updates after each reply.`
  const counts =
    '- **What counts:** everything on your Claude account: Claude Code, Cowork and regular Claude chat. Bigger models (Fable, Opus) and longer conversations use more of it per message.'
  const full = '- **At 100%:** you are limited until the reset time, unless your organization has set up extra usage.'

  switch (limit.kind) {
    case 'five_hour':
      return [
        '**5-hour limit.** Your plan measures usage in rolling five-hour windows. ' + reading,
        '',
        counts,
        resetLine(limit, now),
        full,
      ].join('\n')
    case 'seven_day':
      return [
        '**Weekly limit.** A second cap that covers the whole week, on top of the 5-hour windows. It is the one to watch on busy weeks: a fresh 5-hour window does not help once this is full. ' +
          reading,
        '',
        counts,
        resetLine(limit, now),
        full,
      ].join('\n')
    case 'spend_limit':
      return [
        '**Spend limit.** A spending cap set for your account or organization. ' + reading,
        '',
        resetLine(limit, now),
      ].join('\n')
    default:
      return [
        `**${limit.kind.replace(/_/g, ' ')}.** A separate limit Anthropic reports for your plan, for example a weekly cap on one model family. ` +
          reading,
        '',
        resetLine(limit, now),
      ].join('\n')
  }
}

export function contextHelp(context: Context): string {
  const fill =
    context.tokens === undefined
      ? `The window holds ${tokens(context.window)} tokens.`
      : `It holds **${tokens(context.tokens)}** of ${tokens(context.window)} tokens right now.`
  return [
    `**Context.** How full this conversation's working memory is. ${fill}`,
    '',
    '- **Why it matters:** every reply re-reads the whole conversation, so a fuller window makes each message cost more of your limits, and very full conversations get slower and less sharp.',
    '- **Compact:** shrinks the conversation into a summary so you can keep going with a lighter window. The button appears from 70%.',
    '- **Only this conversation:** each Claude Code conversation has its own window. It is not part of your plan limits.',
  ].join('\n')
}

export function usedHelp(): string {
  return [
    `**What you used.** Every reply Claude Code and Cowork received in this period (for **This session**, this conversation and its helper agents), priced at Anthropic's public API rates (as of ${PRICES_AS_OF}). It is what the same work would have cost if you paid per token instead of having a seat.`,
    '',
    '- **Counted:** input, output, and the cache: re-reading (cheap) and saving (a bit more than input) the conversation so far.',
    '- **Not counted:** regular Claude chat, which is not saved on this computer, and other computers you use.',
    '- **Not a bill:** your seat price stays the same whatever this says.',
  ].join('\n')
}

export function whatIfHelp(): string {
  return [
    '**What if.** The same token counts priced as if every reply had come from one model. Use it to compare models, not as an exact figure:',
    '',
    '- A different model would have written longer or shorter replies.',
    '- Models before Opus 4.7 count text with an older tokenizer, about 30% fewer tokens for the same text, so older replies are priced a little high here.',
    '- Haiku 5.5 charges more for any request whose prompt is over 100,000 tokens; that is included.',
  ].join('\n')
}

export function seatHelp(seat: number, month: number): string {
  const ratio = seat > 0 ? month / seat : 0
  const verdict =
    seat <= 0
      ? 'Set your seat price to see the comparison.'
      : ratio >= 1
        ? `This month your Claude Code and Cowork work would have cost **${ratio.toFixed(1)}×** your seat at API prices, so the seat is the cheaper way to pay for it.`
        : `So far this month your Claude Code and Cowork work comes to **${Math.round(ratio * 100)}%** of your seat at API prices. Regular chat is not in this figure, so the real share is higher.`
  return [
    `**Your seat.** Compares this month's API-equivalent cost (${money(month)}) with what your seat costs (${seat > 0 ? money(seat) : 'not set'} a month).`,
    '',
    verdict,
    '',
    '- **Change the seat price:** type `/plugin`, open usage-rings and choose Configure.',
  ].join('\n')
}

export function sourcesHelp(builtAt: number | undefined, notes: readonly string[]): string {
  return [
    '**Where these numbers come from.** The rings come from Anthropic, with each reply. The costs come from the log files Claude Code (`~/.claude/projects`) and Cowork (the Claude app\'s folder) keep on this computer.',
    '',
    '- Only each reply\'s model, time and token counts are read, never what was said.',
    '- Nothing is sent anywhere: all of this is worked out on your computer.',
    builtAt === undefined ? '- The logs have not been read yet.' : `- Logs last read at ${clock(builtAt)}. They are read again after each reply and every 5 minutes.`,
    ...notes.map(note => `- ${note}`),
  ].join('\n')
}

export function sessionHelp(t: { warn: number; hot: number; fire: number; turn: number; burn: number }): string {
  return [
    `**This session.** What this conversation has cost at API prices so far, including any helper agents it started. Each conversation starts again from $0.`,
    '',
    `- **Alerts:** at ${money(t.warn)}, ${money(t.hot)} and ${money(t.fire)} for the session, when one reply costs more than ${money(t.turn)}, and when it spends more than ${money(t.burn)} within an hour. The last two and the bigger milestones also send a Mac notification.`,
    '- **The flames:** one when the session is warming up, two when it is hot, three when it is on fire.',
    '- **Change the thresholds or turn the graphics off:** type `/plugin`, open usage-rings and choose Configure.',
  ].join('\n')
}

export function boardHelp(): string {
  return [
    '**Your most expensive sessions.** Every Claude Code and Cowork conversation on this computer, ranked by what it cost at API prices within the period.',
    '',
    '- **The bar** compares each session with the most expensive one.',
    '- **Per active hour** is its cost spread over the time it was being worked in; breaks over 30 minutes are left out. A high number means it spent fast.',
    '- **The name** is the one shown in Claude\'s sidebar, or the project folder and date when there is none.',
    '- Click a session for its models, its most expensive replies and how much of it was re-reading.',
  ].join('\n')
}

export function rereadHelp(percent: number): string {
  return [
    `**Re-reading.** Each reply re-reads the whole conversation so far. That re-reading is billed at a low cache rate, but in a long conversation it adds up: here it was ${percent}% of all tokens.`,
    '',
    '- **High share (over 80%):** the conversation got long. Compacting earlier, or starting a fresh session for a new task, keeps each reply cheaper.',
    '- **Low share:** most of the cost was new work: reading files, writing and thinking.',
  ].join('\n')
}

export function turnsHelp(): string {
  return [
    '**Your most expensive replies.** The single replies that cost the most at API prices, from any session.',
    '',
    '- **Re-saved the conversation after a pause:** Claude keeps the conversation in a short-term cache. After a break the cache runs out, and the next reply saves the whole conversation again, which is the priciest kind of token. Long conversations make this expensive: compacting first, or starting fresh, helps.',
    '- **Re-read a long conversation:** cheap per token, but a very long conversation is re-read on every reply.',
    '- **Wrote a long reply** or **Read a lot of new material:** the work itself.',
  ].join('\n')
}
