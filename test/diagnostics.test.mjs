// The diagnostics dump is made to be pasted somewhere public, so what it leaves
// out matters more than what it includes.
import { createFakeBrowser, loadExtension } from './lib/fake-browser.mjs'
import { test, run, eq, ok } from './lib/test-kit.mjs'

const ROOT = new URL('..', import.meta.url).pathname

function boot() {
  const fake = createFakeBrowser({
    permissions: ['tabs', 'cookies', 'tabGroups', 'sessions', 'storage', 'menus'],
    version: '1.4.0',
  })
  const { globals } = loadExtension(ROOT, fake.browser)
  return { ...fake, ...globals(['Workspaces', 'Diagnostics', 'Store']) }
}

const SECRET_URL = 'https://bank.example.com/accounts/4471/statements?from=2026-01'
const SECRET_TITLE = 'Q3 layoff planning'

async function seed(env) {
  const wsId = await env.Workspaces.create()
  const winId = env.Workspaces.byWs.get(wsId)
  env.addTab(winId, { url: SECRET_URL, title: SECRET_TITLE })
  await env.Workspaces.snapshot(winId)
  return { wsId, winId }
}

const tests = [
  test('a dump carries no page titles', async () => {
    const env = boot()
    await seed(env)
    const text = JSON.stringify(await env.Diagnostics.dump())
    ok(!text.includes(SECRET_TITLE), 'the title is nowhere in the dump')
  }),

  test('a dump carries no paths, queries or fragments', async () => {
    const env = boot()
    await seed(env)
    const text = JSON.stringify(await env.Diagnostics.dump())

    ok(!text.includes('4471'), 'account number gone')
    ok(!text.includes('statements'), 'path gone')
    ok(!text.includes('from=2026-01'), 'query gone')
    ok(text.includes('bank.example.com'), 'the site is still there to diagnose with')
  }),

  test('the snapshots inside storage are redacted too', async () => {
    const env = boot()
    const { wsId } = await seed(env)
    const dump = await env.Diagnostics.dump()

    // storage.local holds every workspace snapshot: the largest source of urls.
    const stored = dump.storage[`ws@${wsId}`]
    ok(stored, 'the workspace is in the dump')
    for (const tab of stored.tabs) {
      ok(!tab.title, 'no title on a snapshot tab')
      ok(!tab.url.includes('4471'), 'no path on a snapshot tab')
    }
  }),

  test('a dump says whether it was redacted', async () => {
    const env = boot()
    await seed(env)
    eq((await env.Diagnostics.dump()).redacted, true, 'flagged by default')
    eq((await env.Diagnostics.dump({ full: true })).redacted, false, 'and when it is not')
  }),

  test('asking for the full form gives it back', async () => {
    const env = boot()
    await seed(env)
    const text = JSON.stringify(await env.Diagnostics.dump({ full: true }))
    ok(text.includes(SECRET_URL), 'url intact')
    ok(text.includes(SECRET_TITLE), 'title intact')
  }),

  test('everything a bug was ever diagnosed from survives redaction', async () => {
    const env = boot()
    const { wsId, winId } = await seed(env)
    const dump = await env.Diagnostics.dump()

    eq(dump.version, '1.4.0', 'version')
    eq(dump.tabGroupsApi, true, 'whether the groups api is there')
    ok(dump.bindings.byWs.length > 0, 'window to workspace bindings')
    ok(dump.windows.length > 0, 'the windows')
    ok(dump.windows[0].tabs.every(t => 'groupId' in t), 'group ids, which found the last bug')
    ok(dump.windows[0].tabs.every(t => 'ctr' in t), 'containers')
    eq(dump.windows[0].wsId, wsId, 'which workspace the window shows')
    ok(Array.isArray(dump.log), 'the log')
    ok(winId !== undefined, 'window id resolved')
  }),

  test('an unparseable url does not break the dump', async () => {
    const env = boot()
    const { wsId } = await seed(env)
    const ws = await env.Store.loadWs(wsId)
    ws.tabs.push({ url: 'not a url at all', title: 'x' })
    await env.Store.saveWs(ws)

    const dump = await env.Diagnostics.dump()
    const odd = dump.storage[`ws@${wsId}`].tabs.at(-1)
    eq(odd.url, '(unparseable url)', 'reported rather than thrown')
  }),

  test('about: and moz-extension: urls keep only their scheme', async () => {
    const env = boot()
    eq(env.Diagnostics.redactUrl('about:addons', false), 'about:addons', 'about page named')
    ok(
      !env.Diagnostics.redactUrl('moz-extension://abc-123/popup.html', false).includes('abc-123'),
      'extension uuid not exposed'
    )
  }),
]

await run('diagnostics redaction', tests)
