// The options page against the real background.
//
// The gesture rule is the thing worth pinning down here: Firefox refuses
// permissions.request() unless it is reached before the click handler awaits
// anything. "It resolves eventually" is not the same as "it was called during
// the gesture", so these tests check the call happens in the same tick as the
// click, with nothing awaited first.
import { JSDOM, VirtualConsole } from '../node_modules/jsdom/lib/api.js'
import { readFileSync } from 'node:fs'
import { createFakeBrowser, loadExtension } from './lib/fake-browser.mjs'
import { test, run, eq, ok } from './lib/test-kit.mjs'

const ROOT = new URL('..', import.meta.url).pathname

async function boot({ granted = false, seed } = {}) {
  const permissions = ['tabs', 'tabGroups', 'sessions', 'storage', 'menus']
  if (granted) permissions.push('cookies')

  const fake = createFakeBrowser({ permissions, version: '1.5.4' })
  const { globals } = loadExtension(ROOT, fake.browser)
  const api = globals(['Workspaces', 'Store', 'Backup'])

  const win = await fake.browser.windows.create({})
  await api.Workspaces.adoptWindow(win.id)
  await new Promise(r => setTimeout(r, 20))
  if (seed) await seed({ ...fake, ...api })

  // Records exactly when the permission calls happen.
  const calls = []
  const realRequest = fake.browser.permissions.request
  fake.browser.permissions.request = async perms => {
    calls.push({ method: 'request', tick: 'sync' })
    return realRequest(perms)
  }
  const realRemove = fake.browser.permissions.remove
  fake.browser.permissions.remove = async perms => {
    calls.push({ method: 'remove', tick: 'sync' })
    return realRemove(perms)
  }

  const vc = new VirtualConsole()
  const errors = []
  vc.on('jsdomError', e => errors.push(e.message))

  const dom = new JSDOM(readFileSync(`${ROOT}options/options.html`, 'utf8'), {
    runScripts: 'dangerously',
    url: 'moz-extension://test/options/options.html',
    virtualConsole: vc,
    beforeParse(w) {
      w.browser = fake.browser
      w.confirm = () => true
    },
  })
  dom.window.eval(readFileSync(`${ROOT}options/options.js`, 'utf8'))
  await new Promise(r => setTimeout(r, 80))

  return { ...fake, ...api, dom, doc: dom.window.document, errors, calls }
}

const click = (dom, el) => el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))

const tests = [
  test('the page loads and reports the permission state', async () => {
    const env = await boot()
    eq(env.errors, [], 'no errors')
    ok(env.doc.getElementById('perm-state').textContent.includes('Not granted'), 'state shown')
    eq(env.doc.getElementById('perm-toggle').textContent, 'Allow container tabs', 'button label')
  }),

  test('the permission is requested during the click, not after an await', async () => {
    const env = await boot()

    // dispatchEvent returns once the handler has run its synchronous part. If
    // the handler awaited before requesting, nothing would be recorded yet, and
    // Firefox would have refused the call for the same reason.
    click(env.dom, env.doc.getElementById('perm-toggle'))
    eq(env.calls.length, 1, 'requested within the gesture')
    eq(env.calls[0].method, 'request', 'and it was a request')
  }),

  test('withdrawing is also done during the click', async () => {
    const env = await boot({ granted: true })
    click(env.dom, env.doc.getElementById('perm-toggle'))
    eq(env.calls.length, 1, 'called within the gesture')
    eq(env.calls[0].method, 'remove', 'and it was a removal')
  }),

  test('granting updates what the page says', async () => {
    const env = await boot()
    click(env.dom, env.doc.getElementById('perm-toggle'))
    await new Promise(r => setTimeout(r, 80))

    ok(env.doc.getElementById('perm-state').textContent.includes('Granted'), 'state refreshed')
    eq(env.doc.getElementById('perm-toggle').textContent, 'Withdraw permission', 'button follows')
  }),

  test('the page counts how many saved tabs use a container', async () => {
    const env = await boot({
      async seed(e) {
        const wsId = await e.Workspaces.create({ name: 'Work' })
        const winId = e.Workspaces.byWs.get(wsId)
        e.addTab(winId, { url: 'https://a.example', cookieStoreId: 'firefox-container-1' })
        e.addTab(winId, { url: 'https://b.example', cookieStoreId: 'firefox-container-2' })
        await e.Workspaces.snapshot(winId)
      },
    })
    ok(env.doc.getElementById('perm-state').textContent.includes('2 saved tabs'), 'counted')
  }),

  test('with nothing in a container the page says it changes nothing', async () => {
    const env = await boot()
    ok(
      env.doc.getElementById('perm-state').textContent.includes('changes nothing today'),
      'no false alarm'
    )
  }),

  test('the import prompt stays hidden until it is needed', async () => {
    const env = await boot()
    eq(env.doc.getElementById('import-containers').hidden, true, 'hidden at rest')
  }),
]

await run('options page', tests)
