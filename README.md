# Usage Rings

A Claude Code mod from 7ATE9. It shows how much of your Claude plan you have used, when each limit resets, and what your Claude Code and Cowork work would have cost at Anthropic's API prices.

## What you see

**Above the prompt**, one line:

- **Session cost:** what this conversation has cost at API prices, counting up after each reply, with flames as it heats up (one at $25, two at $50 or fast spending, three at $100).
- **Context ring:** how full this conversation is. A **Compact** button appears from 70%.
- **5-hour and Weekly rings:** your plan limits, with the time each one resets.
- **Today / Month:** what your usage would have cost at API prices, and how that compares with your seat.
- **?** beside anything explains it in plain language. **Details** opens the full panel.

**The panel** (click Details, or type `/rings`) has four pages:

- **Overview:** the rings with their explanations, this session's cost, and the cost by model for this session, the 5-hour window, this week, today or this month, with a "what if" on other models and your seat comparison.
- **Top sessions:** your most expensive conversations today, this week or this month, with their cost per active hour and how much was re-reading. Click one for its breakdown and its costliest replies.
- **Costly replies:** the single most expensive replies, and what made each one expensive.
- **Over time:** spend by hour today and by day this month.

**Alerts** (changeable in settings): when a session passes $25, $50 and $100, when one reply costs more than $5, when a session spends more than $50 in an hour, and when a plan limit passes 80% and 95%. They show as a note in Claude Code; the bigger ones also as a Mac notification. Passing a milestone rains money across the band; a session on fire gets flames.

## Good to know

- The rings come from Anthropic and update after each reply. They count everything on your account: Claude Code, Cowork and regular chat.
- The costs are worked out from the logs Claude Code and Cowork keep on your computer. Only model names, times, token counts, session names and project folders are read, never what was said, and nothing is sent anywhere.
- Regular Claude chat is not saved on your computer, so it is not in the costs.
- Costs are estimates at list price. They are not a bill.
- Works in the Claude Code terminal and in the Code tab of the Claude desktop app. Built and tested on macOS.

## Install

In a terminal, inside Claude Code:

```
/plugin install usage-rings --marketplace dglasgal/usage-rings
```

Answer `y` to add the marketplace, choose the **user** scope, then enter your **seat price** (US$ per month). Every alert, fun mode and the cha-ching sound start on. Start a new session and the rings appear above your prompt, in the terminal and in the Code tab of the Claude desktop app.

Or, from a normal terminal (outside Claude Code):

```
claude plugin marketplace add dglasgal/usage-rings
claude plugin install usage-rings@7ate9-mods --scope user
```

To change the seat price, the alert thresholds, fun mode or the sound later: `/plugin`, open usage-rings, choose Configure. To turn it off: `/plugin`, then disable it under Installed.

Using Claude Skins too? Type `/skin band off` so its usage band does not sit next to this one. Skins' themes stay on.

## Updating

When a new version is out, in a normal terminal:

```
claude plugin marketplace update 7ate9-mods
claude plugin update usage-rings@7ate9-mods
```

Then start a new Claude Code session.

## Commands

- `/rings` opens the panel.
- `/rings sessions`, `/rings turns`, `/rings timeline` open those pages.
- `/rings demo` plays the animations.
- `/rings rescan` reads the logs again right away.

## Updating prices

Prices live in `hooks/pricing.ts`, taken from https://platform.claude.com/docs/en/about-claude/pricing. When Anthropic changes them, edit that table and bump `version` in `.claude-plugin/plugin.json`.

---

© 2026 7ATE9 Entertainment. All rights reserved.
