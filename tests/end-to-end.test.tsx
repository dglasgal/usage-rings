import { expect, test } from 'claude-code/testing'

const SURFACES = ['terminal', 'desktop'] as const
const NOW = Date.parse('2026-10-12T20:00:00.000Z')
const HOME = '/Users/test'
const CODE_DIR = `${HOME}/.claude/projects`
const PROJECT = `${CODE_DIR}/-Users-test-project`

const line = (id: string, model: string, minutesAgo: number, output: number) =>
  JSON.stringify({
    timestamp: new Date(NOW - minutesAgo * 60_000).toISOString(),
    message: {
      id,
      model,
      content: [{ type: 'text', text: 'never read' }],
      usage: { input_tokens: 1_000_000, output_tokens: output, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    },
  })

const LOG = [line('msg_1', 'claude-opus-5-5', 10, 100), line('msg_1', 'claude-opus-5-5', 10, 1_000_000), line('msg_2', 'claude-sonnet-5-5', 30, 0)].join('\n')

const BAND_PROPS = { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120 } as never
const PANE_PROPS = { bodyColumns: 78 } as never

let toasts: string[] = []

// A computer with one Claude Code log, no Cowork and no jq.
function fakeComputer(on: any) {
  toasts = []
  on('clock.now', () => ({ value: NOW }))
  on('env.get', ($: unknown, e: { name: string }) => ({ value: e.name === 'HOME' ? HOME : undefined }))
  on('fs.exists', ($: unknown, e: { path: string }) => ({ value: e.path === CODE_DIR }))
  on('fs.list', ($: unknown, e: { path: string }) => ({
    value:
      e.path === CODE_DIR
        ? [{ name: '-Users-test-project', kind: 'dir', size: 0, mtimeMs: 0, isLink: false }]
        : e.path === PROJECT
          ? [{ name: 'session.jsonl', kind: 'file', size: LOG.length, mtimeMs: NOW - 60_000, isLink: false }]
          : [],
  }))
  on('fs.read', () => ({ value: LOG }))
  // The log is named after the session, so it is this conversation's.
  on('session.id', () => ({ value: 'session' }))
  const store = new Map<string, unknown>()
  on('store.get', ($: unknown, e: { key: string }) => ({ value: store.get(e.key) }))
  on('store.set', ($: unknown, e: { key: string; value: unknown }) => {
    store.set(e.key, JSON.parse(JSON.stringify(e.value)))
    return { value: undefined }
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.log', () => ({ value: undefined }))
  on('session.measure', ($: unknown, e: { changed: string[] }) => ({ changed: e.changed }))
  on('ui.toast', ($: unknown, e: { text: string }) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.notify', () => ({ value: { isSent: false, reason: 'no-surface' } }))
}

async function feed($: any) {
  await $.session.measure({
    context: { window: 1_000_000, tokens: 720_000, percent: 72 },
    rateLimits: [
      { kind: 'seven_day', percentUsed: 18, resetsAt: '2026-10-15T16:00:00.000Z' },
      { kind: 'five_hour', percentUsed: 42.5, resetsAt: '2026-10-12T22:30:00.000Z' },
    ],
    changed: ['context', 'rateLimits'],
  })
  await $.command.run({ command: 'rings', args: 'rescan', origin: { kind: 'composer' }, presentation: { isFullscreen: false } })
}

const texts = async (ui: any) => JSON.stringify(await ui.findAll({}))

for (const surface of SURFACES) {
  test(`the band shows context, both limits, resets and today's cost (${surface})`, { options: { seatPrice: 150 } }, async ($, on) => {
    fakeComputer(on)
    on('ui.render', { component: 'AbovePrompt' }, ($: any, e: any) => {
      const { Text } = $.ui.resolve(e)
      return <Text key="beneath">beneath</Text>
    })
    await feed($)
    const ui = await $.ui.mount({ plugin: 'usage-rings', surface, component: 'AbovePrompt', props: BAND_PROPS })
    const drawn = await texts(ui)
    expect(drawn).toContain('Context')
    expect(drawn).toContain('5-hour')
    expect(drawn).toContain('Weekly')
    expect(drawn).toContain('resets')
    // Opus 5.5: 1M in ($4) + 1M out ($20); Sonnet 5.5: 1M in ($2). msg_1 counts once.
    expect(drawn).toContain('$26.00')
    expect(drawn).toContain('Session')
    expect((await ui.findAll({ type: 'Button', key: 'compact' })).length).toBe(1)
    expect((await ui.findAll({ type: 'Button', key: 'help-five_hour' })).length).toBe(1)
    expect(drawn).toContain('beneath')
  })

  test(`the panel explains a ring and switches periods (${surface})`, { options: { seatPrice: 150 } }, async ($, on) => {
    fakeComputer(on)
    await feed($)
    const ui = await $.ui.mount({ plugin: 'usage-rings', surface, component: 'Pane', requestId: 'usage-rings', props: PANE_PROPS })
    let drawn = await texts(ui)
    expect(drawn).toContain('Opus 5.5')
    expect(drawn).toContain('Sonnet 5.5')
    expect(drawn).toContain('What if')
    expect(drawn).not.toContain('Your plan measures usage')
    expect(drawn).toContain('Since this conversation started')

    await ui.press({ key: 'help-limit:five_hour' })
    drawn = await texts(ui)
    expect(drawn).toContain('Your plan measures usage')

    await ui.press({ key: 'period-month' })
    drawn = await texts(ui)
    expect(drawn).toContain('vs your **$150.00** seat')
    expect(drawn).not.toContain('never read')
  })
}

for (const surface of SURFACES) {
  test(`passing $25 alerts once and the money falls (${surface})`, async ($, on) => {
    fakeComputer(on)
    on('ui.render', { component: 'AbovePrompt' }, ($: any, e: any) => {
      const { Text } = $.ui.resolve(e)
      return <Text key="beneath">beneath</Text>
    })
    await feed($)
    expect(toasts.filter(text => text.includes('passed $25.00')).length).toBe(1)
    await $.command.run({ command: 'rings', args: 'rescan', origin: { kind: 'composer' }, presentation: { isFullscreen: false } } as never)
    expect(toasts.filter(text => text.includes('passed $25.00')).length).toBe(1)
    const ui = await $.ui.mount({ plugin: 'usage-rings', surface, component: 'AbovePrompt', props: BAND_PROPS })
    const drawn = await texts(ui)
    expect(drawn).toContain('passed $25.00')
    if (surface === 'desktop') expect(drawn).toContain('Falling money')
    else expect(drawn).toContain('💰')
  })

  test(`the leaderboard lists the session and opens its breakdown (${surface})`, async ($, on) => {
    fakeComputer(on)
    await feed($)
    await $.command.run({ command: 'rings', args: 'sessions', origin: { kind: 'composer' }, presentation: { isFullscreen: false } } as never)
    const ui = await $.ui.mount({ plugin: 'usage-rings', surface, component: 'Pane', requestId: 'usage-rings', props: PANE_PROPS })
    let drawn = await texts(ui)
    expect(drawn).toContain('Your most expensive sessions')
    expect(drawn).toContain('(this session)')
    await ui.press({ key: 'open-session' })
    drawn = await texts(ui)
    expect(drawn).toContain('Its most expensive replies')
    expect(drawn).toContain('Re-reading')
    await ui.press({ key: 'view-timeline' })
    drawn = await texts(ui)
    expect(drawn).toContain('Today, by hour')
    await ui.press({ key: 'view-turns' })
    expect(await texts(ui)).toContain('Your most expensive replies')
  })
}
