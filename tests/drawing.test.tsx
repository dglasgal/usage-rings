import { expect, test } from 'claude-code/testing'

const SURFACES = ['terminal', 'desktop'] as const

const PANE_PROPS = { bodyColumns: 78 } as never
const BAND_PROPS = { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 100 } as never

for (const surface of SURFACES) {
  test(`the panel draws before the logs are read (${surface})`, async ($, on) => {
    on('clock.now', () => ({ value: Date.parse('2026-10-12T20:00:00.000Z') }))
    const ui = await $.ui.mount({ plugin: 'usage-rings', surface, component: 'Pane', requestId: 'usage-rings', props: PANE_PROPS })
    expect((await ui.findAll({ type: 'Button', key: 'view-sessions' })).length).toBe(1)
    await ui.press({ key: 'help-sources' })
    expect((await ui.findAll({ type: 'Button', key: 'help-sources' })).length).toBe(1)
  })

  test(`the band leaves another mod's band in place while it has nothing (${surface})`, async ($, on) => {
    on('clock.now', () => ({ value: Date.parse('2026-10-12T20:00:00.000Z') }))
    on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
      const { Text } = $.ui.resolve(e)
      return <Text key="other">another band</Text>
    })
    const ui = await $.ui.mount({ plugin: 'usage-rings', surface, component: 'AbovePrompt', props: BAND_PROPS })
    expect(JSON.stringify(await ui.findAll({ type: 'Text' }))).toContain('another band')
  })
}
