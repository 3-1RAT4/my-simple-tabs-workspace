// The backup format has to survive version drift in both directions, so most
// of these are about what happens when the file and the reader disagree.
import { createFakeBrowser, loadExtension } from './lib/fake-browser.mjs'
import { test, run, eq, ok } from './lib/test-kit.mjs'

const ROOT = new URL('..', import.meta.url).pathname
const PERMS = ['tabs', 'cookies', 'tabGroups', 'sessions', 'storage', 'menus']

function bootWithout() {
  const fake = createFakeBrowser({
    permissions: ['tabs', 'tabGroups', 'sessions', 'storage', 'menus'],
    version: '1.5.3',
  })
  const { globals } = loadExtension(ROOT, fake.browser)
  return { ...fake, ...globals(['Workspaces', 'Store', 'Backup', 'Palette']) }
}

function boot() {
  const fake = createFakeBrowser({ permissions: PERMS, version: '1.0.7' })
  const { globals } = loadExtension(ROOT, fake.browser)
  return { ...fake, ...globals(['Workspaces', 'Store', 'Backup', 'Palette']) }
}

async function seed(env) {
  const wsId = await env.Workspaces.create()
  const winId = env.Workspaces.byWs.get(wsId)
  env.addTab(winId, { url: 'https://example.com/a', title: 'A' })
  env.addTab(winId, { url: 'https://example.com/b', title: 'B', cookieStoreId: 'firefox-container-1' })
  await env.Workspaces.update(wsId, { name: 'Research', color: 'purple', icon: '📚' })
  await env.Workspaces.snapshot(winId)
  return wsId
}

const tests = [
  test('an export carries the envelope a reader needs', async () => {
    const env = boot()
    await seed(env)
    const doc = await env.Backup.exportAll()

    eq(doc.format, 'my-simple-tabs-workspace', 'format tag')
    eq(doc.formatVersion, 1, 'version')
    eq(doc.app.version, '1.0.7', 'app version recorded')
    ok(doc.exportedAt.startsWith('20'), 'timestamp present')
    eq(doc.workspaces.length, 1, 'workspace count')
  }),

  test('a workspace round trips with its name, colour, icon and tabs', async () => {
    const env = boot()
    await seed(env)
    const doc = await env.Backup.exportAll()

    const fresh = boot()
    await fresh.Backup.importAll(JSON.stringify(doc), 'replace')
    const all = await fresh.Store.loadAll()

    const restored = all.find(ws => ws.name === 'Research')
    ok(restored, 'workspace restored')
    eq(restored.color, 'purple', 'colour')
    eq(restored.icon, '📚', 'icon')
    eq(restored.tabs.length, 3, 'tabs')
    eq(restored.tabs[2].cookieStoreId, 'firefox-container-1', 'container kept')
  }),

  test('runtime group ids are left out, group appearance is kept', async () => {
    const env = boot()
    const wsId = await seed(env)
    const ws = await env.Store.loadWs(wsId)
    ws.groups = [{ gid: 12345, title: 'Reading', color: 'cyan', collapsed: true }]
    await env.Store.saveWs(ws)

    const doc = await env.Backup.exportAll()
    const group = doc.workspaces[0].groups[0]
    eq(group.gid, undefined, 'runtime id dropped')
    eq(group.title, 'Reading', 'title kept')
    eq(group.collapsed, true, 'collapsed kept')
  }),

  test('fields from a newer version survive a round trip', async () => {
    const env = boot()
    const wsId = await seed(env)

    // As if a later release had added these.
    const ws = await env.Store.loadWs(wsId)
    ws.pinnedRules = ['example.com']
    ws.hotkey = 'Ctrl+3'
    await env.Store.saveWs(ws)

    const doc = await env.Backup.exportAll()
    eq(doc.workspaces[0].pinnedRules, ['example.com'], 'unknown field exported')

    const fresh = boot()
    await fresh.Backup.importAll(JSON.stringify(doc), 'replace')
    const restored = (await fresh.Store.loadAll()).find(w => w.name === 'Research')
    eq(restored.pinnedRules, ['example.com'], 'unknown field imported')
    eq(restored.hotkey, 'Ctrl+3', 'and the other one')
  }),

  test('a backup from a newer format is refused, not guessed at', async () => {
    const env = boot()
    const doc = { format: 'my-simple-tabs-workspace', formatVersion: 99, workspaces: [] }
    try {
      env.Backup.parse(JSON.stringify(doc))
      throw new Error('should have refused')
    } catch (err) {
      ok(err.message.includes('99'), 'names the version')
      ok(err.message.includes('Update the add-on'), 'says what to do')
    }
  }),

  test('a file from another add-on is refused', async () => {
    const env = boot()
    try {
      env.Backup.parse(JSON.stringify({ format: 'something-else', formatVersion: 1 }))
      throw new Error('should have refused')
    } catch (err) {
      ok(err.message.includes('different add-on'), 'clear about why')
    }
  }),

  test('malformed input fails with something a person can read', async () => {
    const env = boot()
    for (const [input, expected] of [
      ['not json at all', 'not JSON'],
      ['[]', 'not a backup'],
      [JSON.stringify({ format: 'my-simple-tabs-workspace' }), 'no usable version'],
    ]) {
      try {
        env.Backup.parse(input)
        throw new Error(`should have refused: ${input}`)
      } catch (err) {
        ok(err.message.includes(expected), `${expected} -> ${err.message}`)
      }
    }
  }),

  test('a migration chain runs old files forward', async () => {
    const env = boot()
    // Pretend this build reads v2 and knows how to lift a v1 file.
    env.Backup.VERSION = 2
    env.Backup.MIGRATIONS[1] = doc => ({
      ...doc,
      formatVersion: 2,
      workspaces: doc.workspaces.map(ws => ({ ...ws, icon: ws.icon || '🗂' })),
    })

    const parsed = env.Backup.parse(
      JSON.stringify({
        format: 'my-simple-tabs-workspace',
        formatVersion: 1,
        workspaces: [{ id: 'x', name: 'Old', tabs: [] }],
      })
    )

    eq(parsed.formatVersion, 2, 'lifted to the current version')
    eq(parsed.workspaces[0].icon, '🗂', 'migration applied')
  }),

  test('values from a file are validated, not trusted', async () => {
    const env = boot()
    const doc = {
      format: 'my-simple-tabs-workspace',
      formatVersion: 1,
      workspaces: [
        {
          id: 'a',
          name: 'Tampered',
          color: 'ultraviolet',
          icon: 'this is not an icon at all',
          tabs: [{ url: 'https://ok.example' }, { notATab: true }],
        },
      ],
    }

    await env.Backup.importAll(JSON.stringify(doc), 'replace')
    const ws = (await env.Store.loadAll()).find(w => w.name === 'Tampered')
    eq(ws.color, 'default', 'unknown colour rejected')
    eq(ws.icon, '', 'over-long icon rejected')
    eq(ws.tabs.length, 1, 'entry without a url dropped')
  }),

  test('merging keeps the current workspaces and never reuses an id', async () => {
    const env = boot()
    await seed(env)
    const doc = await env.Backup.exportAll()
    const before = (await env.Store.loadAll()).length

    await env.Backup.importAll(JSON.stringify(doc), 'merge')
    const all = await env.Store.loadAll()

    eq(all.length, before + 1, 'added rather than replaced')
    eq(new Set(all.map(w => w.id)).size, all.length, 'ids are unique')
  }),

  test('replacing leaves open windows with a workspace of their own', async () => {
    const env = boot()
    await seed(env)
    const doc = await env.Backup.exportAll()

    const fresh = boot()
    const liveId = await fresh.Workspaces.create()
    const winId = fresh.Workspaces.byWs.get(liveId)

    await fresh.Backup.importAll(JSON.stringify(doc), 'replace')

    const boundTo = fresh.Workspaces.byWindow.get(winId)
    ok(boundTo, 'the open window still has a workspace')
    ok(await fresh.Store.loadWs(boundTo), 'and that workspace exists')
  }),

  test('separators travel in the backup and keep their arrangement', async () => {
    const env = boot()
    await seed(env)
    const sepId = await env.Workspaces.addSeparator('Personal')
    const second = await env.Workspaces.create()
    await env.Workspaces.update(second, { name: 'Shopping' })

    const doc = await env.Backup.exportAll()
    eq(doc.separators.length, 1, 'separator exported')
    eq(doc.separators[0].label, 'Personal', 'with its label')
    ok(doc.order.includes(sepId), 'and its place in the order')

    const fresh = boot()
    await fresh.Backup.importAll(JSON.stringify(doc), 'replace')

    const list = await fresh.Workspaces.list(-1)
    const types = list.map(i => i.type)
    ok(types.includes('separator'), 'separator restored')
    eq(list.find(i => i.type === 'separator').label, 'Personal', 'label restored')
    eq(types.indexOf('separator'), 1, 'still between the two workspaces')
  }),

  test('a backup without separators still restores cleanly', async () => {
    const env = boot()
    const doc = {
      format: 'my-simple-tabs-workspace',
      formatVersion: 1,
      workspaces: [{ id: 'a', name: 'Solo', tabs: [] }],
    }
    await env.Backup.importAll(JSON.stringify(doc), 'replace')
    const list = await env.Workspaces.list(-1)
    eq(list.filter(i => i.type === 'workspace').length, 1, 'workspace restored')
    eq(list.filter(i => i.type === 'separator').length, 0, 'no separators invented')
  }),

  test('a backup written before the rename still restores', async () => {
    const env = boot()
    // Exactly what version 1.1.0 and earlier wrote.
    const legacy = {
      format: 'simple-tab-workspaces',
      formatVersion: 1,
      app: { name: 'Simple Tab Workspaces', version: '1.1.0' },
      workspaces: [{ id: 'old-1', name: 'From before', color: 'cyan', icon: '📦', tabs: [] }],
    }

    await env.Backup.importAll(JSON.stringify(legacy), 'replace')
    const ws = (await env.Store.loadAll()).find(w => w.name === 'From before')
    ok(ws, 'restored')
    eq(ws.color, 'cyan', 'colour kept')
    eq(ws.icon, '📦', 'icon kept')
  }),

  test('exports are written with the current format string', async () => {
    const env = boot()
    await seed(env)
    const doc = await env.Backup.exportAll()
    eq(doc.format, 'my-simple-tabs-workspace', 'current spelling on the way out')
  }),

  test('containers survive the whole round trip when allowed', async () => {
    const env = boot()
    const wsId = await env.Workspaces.create({ name: 'Work' })
    const winId = env.Workspaces.byWs.get(wsId)
    env.addTab(winId, { url: 'https://a.example', title: 'A', cookieStoreId: 'firefox-container-1' })
    await env.Workspaces.snapshot(winId)

    const doc = await env.Backup.exportAll()
    eq(doc.workspaces[0].tabs[1].cookieStoreId, 'firefox-container-1', 'in the file')

    const fresh = boot()
    await fresh.Backup.importAll(JSON.stringify(doc), 'replace')
    const stored = (await fresh.Store.loadAll()).find(w => w.name === 'Work')
    eq(stored.tabs[1].cookieStoreId, 'firefox-container-1', 'after import')

    await fresh.Workspaces.activate(stored.id)
    const tabs = await fresh.browser.tabs.query({
      windowId: fresh.Workspaces.byWs.get(stored.id),
    })
    ok(tabs.some(t => t.cookieStoreId === 'firefox-container-1'), 'after reopening')
  }),

  test('an import reports the container tabs it brought in', async () => {
    const env = boot()
    const wsId = await env.Workspaces.create({ name: 'Work' })
    const winId = env.Workspaces.byWs.get(wsId)
    env.addTab(winId, { url: 'https://a.example', title: 'A', cookieStoreId: 'firefox-container-1' })
    env.addTab(winId, { url: 'https://b.example', title: 'B', cookieStoreId: 'firefox-container-2' })
    env.addTab(winId, { url: 'https://c.example', title: 'C' })
    await env.Workspaces.snapshot(winId)
    const doc = await env.Backup.exportAll()

    // A fresh install has no cookies permission, which is the case that matters.
    const fresh = bootWithout()
    const result = await fresh.Backup.importAll(JSON.stringify(doc), 'replace')

    eq(result.containerTabs, 2, 'counted the tabs that need the permission')
    eq(result.canRestoreContainers, false, 'and reported that it is missing')
  }),

  test('an import with nothing in a container says so', async () => {
    const env = bootWithout()
    const doc = {
      format: 'my-simple-tabs-workspace',
      formatVersion: 1,
      workspaces: [{ id: 'a', name: 'Plain', tabs: [{ url: 'https://x.example' }] }],
    }
    const result = await env.Backup.importAll(JSON.stringify(doc), 'replace')
    eq(result.containerTabs, 0, 'nothing to warn about')
  }),

  test('a workspace with no name is skipped rather than imported blank', async () => {
    const env = boot()
    const doc = {
      format: 'my-simple-tabs-workspace',
      formatVersion: 1,
      workspaces: [{ id: 'a', name: '   ', tabs: [] }, { id: 'b', name: 'Real', tabs: [] }],
    }
    await env.Backup.importAll(JSON.stringify(doc), 'replace')
    const all = await env.Store.loadAll()
    eq(all.length, 1, 'only the usable one')
    eq(all[0].name, 'Real', 'and it is the right one')
  }),
]

await run('backup format', tests)
