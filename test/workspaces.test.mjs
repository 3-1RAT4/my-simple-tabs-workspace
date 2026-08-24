// Scenarios for the 1:1 window/workspace model. Each one exists because it
// either broke in a real browser or is a rule we must not regress.
import { createFakeBrowser, loadExtension } from './lib/fake-browser.mjs'
import { test, run, eq, ok } from './lib/test-kit.mjs'

const ROOT = new URL('..', import.meta.url).pathname
const PERMS = ['tabs', 'cookies', 'tabGroups', 'sessions', 'storage', 'menus']

function boot(permissions = PERMS) {
  const fake = createFakeBrowser({ permissions })
  const { globals } = loadExtension(ROOT, fake.browser)
  return { ...fake, ...globals(['Workspaces', 'Store', 'Groups', 'Util']) }
}

async function populate(env, winId) {
  const a = env.addTab(winId, { url: 'https://example.com/a', title: 'A', cookieStoreId: 'firefox-container-1' })
  const b = env.addTab(winId, { url: 'https://example.com/b', title: 'B' })
  return { a, b }
}

const tests = [
  test('a new window gets its own workspace, not another window\'s', async () => {
    const env = boot()
    const w1 = await env.Workspaces.create()
    const win2 = await env.browser.windows.create({})
    const w2 = await env.Workspaces.adoptWindow(win2.id)
    ok(w1 !== w2, 'workspaces differ')
  }),

  test('a workspace is never shown by two windows', async () => {
    const env = boot()
    const wsId = await env.Workspaces.create()
    const first = env.Workspaces.byWs.get(wsId)
    await env.Workspaces.activate(wsId) // must focus, not open a second window
    eq(env.Workspaces.byWs.get(wsId), first, 'still the same window')
  }),

  test('closing and reopening keeps every tab, containers included', async () => {
    const env = boot()
    const wsId = await env.Workspaces.create()
    let winId = env.Workspaces.byWs.get(wsId)
    await populate(env, winId)
    await env.Workspaces.snapshot(winId)

    await env.browser.windows.remove(winId)
    env.Workspaces.unbind(winId)
    await env.Workspaces.activate(wsId)

    winId = env.Workspaces.byWs.get(wsId)
    const tabs = await env.browser.tabs.query({ windowId: winId })
    eq(tabs.length, 3, 'tab count')
    eq(tabs[1].cookieStoreId, 'firefox-container-1', 'container preserved')
  }),

  // The rebuild path only runs when no closed window matches, so these clear
  // the session list to reach it deliberately.
  test('a container tab still restores when the cookies permission is missing', async () => {
    const env = boot(['tabs', 'tabGroups', 'sessions', 'storage', 'menus'])
    const wsId = await env.Workspaces.create()
    let winId = env.Workspaces.byWs.get(wsId)
    await populate(env, winId)
    await env.Workspaces.snapshot(winId)

    await env.browser.windows.remove(winId)
    env.Workspaces.unbind(winId)
    env.state.recentlyClosed.length = 0
    await env.Workspaces.activate(wsId)

    winId = env.Workspaces.byWs.get(wsId)
    const tabs = await env.browser.tabs.query({ windowId: winId })
    eq(tabs.length, 3, 'no tab lost to the failed container')
    eq(tabs[1].cookieStoreId, 'firefox-default', 'fell back to default')
  }),

  test('the popup count matches what actually reopens', async () => {
    const env = boot()
    const wsId = await env.Workspaces.create()
    const winId = env.Workspaces.byWs.get(wsId)
    await populate(env, winId)
    await env.Workspaces.snapshot(winId)

    const before = (await env.Workspaces.list(winId))[0].tabCount
    await env.browser.windows.remove(winId)
    env.Workspaces.unbind(winId)
    await env.Workspaces.activate(wsId)

    const after = (await env.browser.tabs.query({
      windowId: env.Workspaces.byWs.get(wsId),
    })).length
    eq(after, before, 'restored count equals reported count')
  }),

  test('reopening does not multiply tab groups', async () => {
    const env = boot()
    const wsId = await env.Workspaces.create()
    let winId = env.Workspaces.byWs.get(wsId)
    const { a, b } = await populate(env, winId)

    await env.browser.tabs.group({ tabIds: [a.id, b.id], createProperties: { windowId: winId } })
    await env.browser.tabGroups.update(a.groupId, { title: 'WORKSPACE2_GROUP', color: 'blue' })
    await env.Workspaces.snapshot(winId)

    for (let i = 0; i < 5; i++) {
      await env.browser.windows.remove(winId)
      env.Workspaces.unbind(winId)
      await env.Workspaces.activate(wsId)
      winId = env.Workspaces.byWs.get(wsId)
    }

    const live = await env.browser.tabGroups.query({ windowId: winId })
    eq(live.length, 1, 'exactly one live group in the window')
    eq(live[0].title, 'WORKSPACE2_GROUP', 'title kept')

    // Firefox saves a group when its window closes and gives extensions no way
    // to delete it, so saved ones accumulate one per close no matter what we
    // do. What must not happen is more than one appearing per cycle.
    const total = env.state.groups.size
    ok(total <= 6, `total groups after 5 cycles: ${total}`)
  }),

  test('same-named groups already in a window collapse instead of breeding', async () => {
    const env = boot()
    const wsId = await env.Workspaces.create()
    let winId = env.Workspaces.byWs.get(wsId)
    const { a, b } = await populate(env, winId)

    // Two separate groups with identical title+colour, as earlier builds produced.
    await env.browser.tabs.group({ tabIds: [a.id], createProperties: { windowId: winId } })
    await env.browser.tabGroups.update(a.groupId, { title: 'DUP', color: 'blue' })
    await env.browser.tabs.group({ tabIds: [b.id], createProperties: { windowId: winId } })
    await env.browser.tabGroups.update(b.groupId, { title: 'DUP', color: 'blue' })
    await env.Workspaces.snapshot(winId)

    await env.browser.windows.remove(winId)
    env.Workspaces.unbind(winId)
    env.state.recentlyClosed.length = 0
    await env.Workspaces.activate(wsId)
    winId = env.Workspaces.byWs.get(wsId)

    const live = await env.browser.tabGroups.query({ windowId: winId })
    eq(live.length, 1, 'the duplicates merged into one')
  }),

  test('X-closing then reopening does not leave a duplicate group', async () => {
    const env = boot()
    const wsId = await env.Workspaces.create()
    let winId = env.Workspaces.byWs.get(wsId)
    const { a, b } = await populate(env, winId)

    await env.browser.tabs.group({ tabIds: [a.id, b.id], createProperties: { windowId: winId } })
    await env.browser.tabGroups.update(a.groupId, { title: 'WORKSTATIONS2', color: 'purple' })
    await env.Workspaces.snapshot(winId)

    // Closed with the window's own X: no cooperation from the extension.
    for (let i = 0; i < 5; i++) {
      await env.browser.windows.remove(winId)
      env.Workspaces.unbind(winId)
      await env.Workspaces.activate(wsId)
      winId = env.Workspaces.byWs.get(wsId)
    }

    const all = [...env.state.groups.values()]
    eq(all.length, 1, 'exactly one group exists in the browser')
    eq(all[0].title, 'WORKSTATIONS2', 'and it is the original')

    const tabs = await env.browser.tabs.query({ windowId: winId })
    eq(tabs.filter(t => t.groupId !== -1).length, 2, 'both tabs still grouped')
  }),

  test('a workspace with no matching closed window still rebuilds by hand', async () => {
    const env = boot()
    const wsId = await env.Workspaces.create()
    let winId = env.Workspaces.byWs.get(wsId)
    await populate(env, winId)
    await env.Workspaces.snapshot(winId)

    await env.browser.windows.remove(winId)
    env.Workspaces.unbind(winId)
    env.state.recentlyClosed.length = 0 // as after a browser restart

    await env.Workspaces.activate(wsId)
    winId = env.Workspaces.byWs.get(wsId)
    const tabs = await env.browser.tabs.query({ windowId: winId })
    eq(tabs.length, 3, 'rebuilt from the snapshot')
  }),

  test('renaming persists and survives a restart', async () => {
    const env = boot()
    const wsId = await env.Workspaces.create()
    const winId = env.Workspaces.byWs.get(wsId)

    await env.Workspaces.rename(wsId, '  Research  ')
    eq((await env.Store.loadWs(wsId)).name, 'Research', 'trimmed and saved')

    env.Workspaces.byWs.clear()
    env.Workspaces.byWindow.clear()
    await env.Workspaces.init()
    eq((await env.Workspaces.list(winId))[0].name, 'Research', 'still there after restart')
  }),

  test('an empty rename keeps the old name', async () => {
    const env = boot()
    const wsId = await env.Workspaces.create()
    const before = (await env.Store.loadWs(wsId)).name

    await env.Workspaces.rename(wsId, '   ')
    eq((await env.Store.loadWs(wsId)).name, before, 'unchanged')
  }),

  test('renaming a closed workspace works too', async () => {
    const env = boot()
    const wsId = await env.Workspaces.create()
    const winId = env.Workspaces.byWs.get(wsId)
    await env.browser.windows.remove(winId)
    env.Workspaces.unbind(winId)

    await env.Workspaces.rename(wsId, 'Archive')
    eq((await env.Store.loadWs(wsId)).name, 'Archive', 'renamed while closed')
  }),

  test('a separator keeps its place in the list', async () => {
    const env = boot()
    const first = await env.Workspaces.create()
    const sepId = await env.Workspaces.addSeparator('Personal')
    const second = await env.Workspaces.create()

    const list = await env.Workspaces.list(env.Workspaces.byWs.get(first))
    eq(list.map(i => i.type), ['workspace', 'separator', 'workspace'], 'order preserved')
    eq(list[1].id, sepId, 'the separator we added')
    eq(list[1].label, 'Personal', 'with its label')
    eq(list[2].id, second, 'workspace after it')
  }),

  test('a separator can be relabelled and removed', async () => {
    const env = boot()
    const wsId = await env.Workspaces.create()
    const sepId = await env.Workspaces.addSeparator('Old')

    await env.Workspaces.updateSeparator(sepId, '  Renamed  ')
    let list = await env.Workspaces.list(env.Workspaces.byWs.get(wsId))
    eq(list.find(i => i.id === sepId).label, 'Renamed', 'trimmed and saved')

    await env.Workspaces.removeSeparator(sepId)
    list = await env.Workspaces.list(env.Workspaces.byWs.get(wsId))
    eq(list.filter(i => i.type === 'separator').length, 0, 'gone')
  }),

  test('separators do not count as workspaces', async () => {
    const env = boot()
    const wsId = await env.Workspaces.create()
    await env.Workspaces.addSeparator('Divider')

    // The last workspace is still the last one, separators notwithstanding.
    try {
      await env.Workspaces.remove(wsId)
      throw new Error('should have refused')
    } catch (err) {
      ok(err.message.includes('last workspace'), 'refused for the right reason')
    }

    // And the next workspace is numbered 2, not 3.
    const next = await env.Workspaces.create()
    eq((await env.Store.loadWs(next)).name, 'Workspace 2', 'numbering ignores separators')
  }),

  test('reordering moves separators along with workspaces', async () => {
    const env = boot()
    const a = await env.Workspaces.create()
    const sepId = await env.Workspaces.addSeparator('Line')
    const b = await env.Workspaces.create()

    await env.Workspaces.reorder([b, sepId, a])
    const list = await env.Workspaces.list(env.Workspaces.byWs.get(a))
    eq(list.map(i => i.id), [b, sepId, a], 'new arrangement stored')
  }),

  test('a workspace can be created already named and styled', async () => {
    const env = boot()
    const wsId = await env.Workspaces.create({ name: '  Research  ', color: 'cyan', icon: '📚' })
    const ws = await env.Store.loadWs(wsId)

    eq(ws.name, 'Research', 'name trimmed and kept')
    eq(ws.color, 'cyan', 'colour kept')
    eq(ws.icon, '📚', 'icon kept')
    ok(env.Workspaces.byWs.get(wsId) !== undefined, 'and its window opened')
  }),

  test('creating without details still falls back to a numbered name', async () => {
    const env = boot()
    await env.Workspaces.create()
    const second = await env.Workspaces.create({ name: '   ', color: 'nonsense' })
    const ws = await env.Store.loadWs(second)

    eq(ws.name, 'Workspace 2', 'numbered')
    eq(ws.color, 'default', 'bad colour refused')
  }),

  test('losing a container on rebuild is recorded, not swallowed', async () => {
    // No cookies permission: exactly the state a fresh install is in.
    const env = boot(['tabs', 'tabGroups', 'sessions', 'storage', 'menus'])
    const wsId = await env.Workspaces.create()
    let winId = env.Workspaces.byWs.get(wsId)
    env.addTab(winId, { url: 'https://a.example', title: 'A', cookieStoreId: 'firefox-container-1' })
    env.addTab(winId, { url: 'https://b.example', title: 'B', cookieStoreId: 'firefox-container-2' })
    await env.Workspaces.snapshot(winId)

    await env.browser.windows.remove(winId)
    env.Workspaces.unbind(winId)
    env.state.recentlyClosed.length = 0 // force the rebuild path
    await env.Workspaces.activate(wsId)

    const { containerNotice } = await env.browser.storage.local.get('containerNotice')
    ok(containerNotice, 'the loss was recorded')
    eq(containerNotice.count, 2, 'both tabs counted')

    // The tabs still came back, just in the default container.
    winId = env.Workspaces.byWs.get(wsId)
    const tabs = await env.browser.tabs.query({ windowId: winId })
    eq(tabs.length, 3, 'nothing was dropped')
    ok(tabs.every(t => t.cookieStoreId === 'firefox-default'), 'all in the default container')
  }),

  test('with the permission, containers survive the rebuild and nothing is recorded', async () => {
    const env = boot()
    const wsId = await env.Workspaces.create()
    let winId = env.Workspaces.byWs.get(wsId)
    env.addTab(winId, { url: 'https://a.example', title: 'A', cookieStoreId: 'firefox-container-1' })
    await env.Workspaces.snapshot(winId)

    await env.browser.windows.remove(winId)
    env.Workspaces.unbind(winId)
    env.state.recentlyClosed.length = 0
    await env.Workspaces.activate(wsId)

    const stored = await env.browser.storage.local.get('containerNotice')
    eq(stored.containerNotice, undefined, 'nothing to report')

    winId = env.Workspaces.byWs.get(wsId)
    const tabs = await env.browser.tabs.query({ windowId: winId })
    ok(
      tabs.some(t => t.cookieStoreId === 'firefox-container-1'),
      'the container came back'
    )
  }),

  test('reopening the remembered window keeps containers without the permission', async () => {
    const env = boot(['tabs', 'tabGroups', 'sessions', 'storage', 'menus'])
    const wsId = await env.Workspaces.create()
    let winId = env.Workspaces.byWs.get(wsId)
    env.addTab(winId, { url: 'https://a.example', title: 'A', cookieStoreId: 'firefox-container-1' })
    await env.Workspaces.snapshot(winId)

    // The session restore path: Firefox reopens the window itself.
    await env.browser.windows.remove(winId)
    env.Workspaces.unbind(winId)
    await env.Workspaces.activate(wsId)

    winId = env.Workspaces.byWs.get(wsId)
    const tabs = await env.browser.tabs.query({ windowId: winId })
    ok(
      tabs.some(t => t.cookieStoreId === 'firefox-container-1'),
      'container intact, no permission needed'
    )
    const stored = await env.browser.storage.local.get('containerNotice')
    eq(stored.containerNotice, undefined, 'and nothing to report')
  }),

  test('workspaces survive a restart via the window session value', async () => {
    const env = boot()
    const wsId = await env.Workspaces.create()
    const winId = env.Workspaces.byWs.get(wsId)
    await populate(env, winId)
    await env.Workspaces.snapshot(winId)

    // Restart: runtime bindings are lost, session values and storage are not.
    env.Workspaces.byWs.clear()
    env.Workspaces.byWindow.clear()
    await env.Workspaces.init()

    eq(env.Workspaces.byWindow.get(winId), wsId, 'rebound to the same workspace')
  }),
]

await run('workspaces (1:1 model)', tests)
