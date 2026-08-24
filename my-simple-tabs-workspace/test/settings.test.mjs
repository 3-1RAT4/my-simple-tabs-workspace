// Settings are validated in the background, so the UI cannot store a value the
// add-on then fails to render. These are mostly about bad input.
import { createFakeBrowser, loadExtension } from '../../lib/fake-browser.mjs'
import { test, run, eq, ok } from '../../lib/test-kit.mjs'

const ROOT = new URL('..', import.meta.url).pathname

function boot() {
  const fake = createFakeBrowser({
    permissions: ['tabs', 'cookies', 'tabGroups', 'sessions', 'storage', 'menus'],
    version: '1.0.9',
  })
  const { globals } = loadExtension(ROOT, fake.browser)
  return { ...fake, ...globals(['Settings', 'Backup', 'Workspaces', 'Store']) }
}

const tests = [
  test('defaults come back when nothing is stored', async () => {
    const env = boot()
    const s = await env.Settings.load()
    eq(s.ui.scale, 2, 'popup size')
    eq(s.ui.text, 1.5, 'text size')
    eq(s.behavior.preferSessionRestore, true, 'session restore preferred')
  }),

  test('an update changes one setting and leaves the rest alone', async () => {
    const env = boot()
    await env.Settings.update({ 'ui.scale': 1.4 })
    const s = await env.Settings.load()
    eq(s.ui.scale, 1.4, 'changed')
    eq(s.ui.text, 1.5, 'untouched')
  }),

  test('out of range numbers are clamped, not rejected', async () => {
    const env = boot()
    eq((await env.Settings.update({ 'ui.scale': 99 })).ui.scale, 3, 'clamped to max')
    eq((await env.Settings.update({ 'ui.scale': -5 })).ui.scale, 1, 'clamped to min')
    eq((await env.Settings.update({ 'ui.listHeight': 10000 })).ui.listHeight, 560, 'height capped')
  }),

  test('values of the wrong type fall back to the default', async () => {
    const env = boot()
    const s = env.Settings.validate({
      ui: { scale: 'enormous', text: null },
      behavior: { confirmDelete: 'yes please' },
    })
    eq(s.ui.scale, 2, 'default scale')
    eq(s.ui.text, 1.5, 'default text')
    eq(s.behavior.confirmDelete, true, 'default toggle')
  }),

  test('unknown settings are ignored rather than stored', async () => {
    const env = boot()
    await env.Settings.update({ 'ui.somethingInvented': 42 })
    const s = await env.Settings.load()
    eq(s.ui.somethingInvented, undefined, 'not kept')
  }),

  test('reset restores every default', async () => {
    const env = boot()
    await env.Settings.update({ 'ui.scale': 1, 'behavior.quickSwitchKeys': false })
    const s = await env.Settings.reset()
    eq(s.ui.scale, 2, 'size back')
    eq(s.behavior.quickSwitchKeys, true, 'toggle back')
  }),

  test('settings back up and restore on their own', async () => {
    const env = boot()
    await env.Settings.update({ 'ui.scale': 2.5, 'behavior.confirmDelete': false })
    const doc = await env.Backup.exportSettings()

    eq(doc.format, 'my-simple-tabs-workspace-settings', 'its own format')
    eq(doc.formatVersion, 1, 'versioned')
    eq(doc.settings.ui.scale, 2.5, 'value carried')

    const fresh = boot()
    await fresh.Backup.importSettings(JSON.stringify(doc))
    const restored = await fresh.Settings.load()
    eq(restored.ui.scale, 2.5, 'size restored')
    eq(restored.behavior.confirmDelete, false, 'toggle restored')
  }),

  test('a settings backup carries no workspaces', async () => {
    const env = boot()
    await env.Workspaces.create()
    const doc = await env.Backup.exportSettings()
    eq(doc.workspaces, undefined, 'workspaces stay out of it')
  }),

  test('the two file kinds refuse to be mistaken for each other', async () => {
    const env = boot()
    await env.Workspaces.create()

    const workspaceDoc = JSON.stringify(await env.Backup.exportAll())
    const settingsDoc = JSON.stringify(await env.Backup.exportSettings())

    try {
      env.Backup.parseSettings(workspaceDoc)
      throw new Error('should have refused')
    } catch (err) {
      ok(err.message.includes('workspace backup'), 'names what it actually is')
      ok(err.message.includes('Restore a backup'), 'points at the right control')
    }

    try {
      env.Backup.parse(settingsDoc)
      throw new Error('should have refused')
    } catch (err) {
      ok(err.message.includes('settings backup'), 'names what it actually is')
      ok(err.message.includes('under Settings'), 'points at the right control')
    }
  }),

  test('a settings file from a newer format is refused', async () => {
    const env = boot()
    try {
      env.Backup.parseSettings(
        JSON.stringify({
          format: 'my-simple-tabs-workspace-settings',
          formatVersion: 99,
          settings: {},
        })
      )
      throw new Error('should have refused')
    } catch (err) {
      ok(err.message.includes('99'), 'names the version')
    }
  }),

  test('a settings file written before the rename still restores', async () => {
    const env = boot()
    const legacy = {
      format: 'simple-tab-workspaces-settings',
      formatVersion: 1,
      settings: { ui: { scale: 1.8 }, behavior: { quickSwitchKeys: false } },
    }
    const { settings } = await env.Backup.importSettings(JSON.stringify(legacy))
    eq(settings.ui.scale, 1.8, 'value carried across the rename')
    eq(settings.behavior.quickSwitchKeys, false, 'and the toggle')
  }),

  test('an old workspace file is still recognised as the wrong kind', async () => {
    const env = boot()
    try {
      env.Backup.parseSettings(
        JSON.stringify({ format: 'simple-tab-workspaces', formatVersion: 1, workspaces: [] })
      )
      throw new Error('should have refused')
    } catch (err) {
      ok(err.message.includes('workspace backup'), 'named correctly despite the old spelling')
    }
  }),

  test('a tampered settings file cannot break the popup', async () => {
    const env = boot()
    const doc = {
      format: 'my-simple-tabs-workspace-settings',
      formatVersion: 1,
      settings: { ui: { scale: 9999, text: -1, listHeight: 'tall' } },
    }
    const { settings } = await env.Backup.importSettings(JSON.stringify(doc))
    eq(settings.ui.scale, 3, 'clamped')
    eq(settings.ui.text, 1, 'clamped')
    eq(settings.ui.listHeight, 460, 'default for a non-number')
  }),

  test('turning off session restore makes reopening rebuild instead', async () => {
    const env = boot()
    const wsId = await env.Workspaces.create()
    let winId = env.Workspaces.byWs.get(wsId)
    env.addTab(winId, { url: 'https://example.com/a', title: 'A' })
    await env.Workspaces.snapshot(winId)

    await env.Settings.update({ 'behavior.preferSessionRestore': false })
    await env.browser.windows.remove(winId)
    env.Workspaces.unbind(winId)

    await env.Workspaces.activate(wsId)
    winId = env.Workspaces.byWs.get(wsId)

    // A rebuild leaves the closed window unclaimed in the session list.
    eq(env.state.recentlyClosed.length, 1, 'the closed window was not consumed')
    eq((await env.browser.tabs.query({ windowId: winId })).length, 2, 'tabs rebuilt anyway')
  }),

  test('restoring loaded rather than unloaded is honoured', async () => {
    const env = boot()
    const wsId = await env.Workspaces.create()
    let winId = env.Workspaces.byWs.get(wsId)
    env.addTab(winId, { url: 'https://example.com/a', title: 'A' })
    await env.Workspaces.snapshot(winId)

    await env.Settings.update({
      'behavior.preferSessionRestore': false,
      'behavior.restoreUnloaded': false,
    })
    await env.browser.windows.remove(winId)
    env.Workspaces.unbind(winId)
    await env.Workspaces.activate(wsId)

    const tabs = await env.browser.tabs.query({ windowId: env.Workspaces.byWs.get(wsId) })
    ok(tabs.every(t => !t.discarded), 'nothing restored discarded')
  }),
]

await run('settings', tests)
