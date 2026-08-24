// The popup and the background running against each other, with nothing
// stubbed between them. Unit tests on either side can both pass while the
// message they exchange does not line up.
import { JSDOM, VirtualConsole } from '../node_modules/jsdom/lib/api.js'
import { readFileSync } from 'node:fs'
import { createFakeBrowser, loadExtension } from './lib/fake-browser.mjs'
import { test, run, eq, ok } from './lib/test-kit.mjs'

const ROOT = new URL('..', import.meta.url).pathname

async function boot() {
  const fake = createFakeBrowser({
    permissions: ['tabs', 'cookies', 'tabGroups', 'sessions', 'storage', 'menus'],
    version: '1.5.1',
  })
  const { globals } = loadExtension(ROOT, fake.browser)
  const api = globals(['Workspaces', 'Store'])

  // A window to start from, as any real profile has.
  const win = await fake.browser.windows.create({})
  await api.Workspaces.adoptWindow(win.id)
  await new Promise(r => setTimeout(r, 20))

  const vc = new VirtualConsole()
  const errors = []
  vc.on('jsdomError', e => errors.push(e.message))

  const dom = new JSDOM(readFileSync(`${ROOT}popup/popup.html`, 'utf8'), {
    runScripts: 'dangerously',
    url: 'moz-extension://test/popup/popup.html',
    virtualConsole: vc,
    beforeParse(win) {
      win.browser = fake.browser
      win.close = () => {}
      win.confirm = () => true
      win.HTMLElement.prototype.scrollIntoView = () => {}
    },
  })
  dom.window.eval(readFileSync(`${ROOT}shared/palette.js`, 'utf8'))
  dom.window.eval(readFileSync(`${ROOT}popup/popup.js`, 'utf8'))
  await new Promise(r => setTimeout(r, 80))

  return { ...fake, ...api, dom, errors, doc: dom.window.document }
}

const click = (dom, el) => el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))

const tests = [
  test('the popup lists what the background actually has', async () => {
    const env = await boot()
    eq(env.errors, [], 'no errors while loading')
    eq(env.doc.querySelectorAll('.row').length, 1, 'the starting workspace is listed')
  }),

  test('Add separator puts a separator in the list', async () => {
    const env = await boot()
    click(env.dom, env.doc.getElementById('add-sep'))
    await new Promise(r => setTimeout(r, 80))

    const index = await env.Store.loadIndex()
    eq(index.order.filter(id => id.startsWith('sep-')).length, 1, 'stored by the background')
    eq(env.doc.querySelectorAll('.sep').length, 1, 'and shown in the popup')
    eq(env.errors, [], 'no errors')
  }),

  test('a separator survives a reopen of the popup', async () => {
    const env = await boot()
    click(env.dom, env.doc.getElementById('add-sep'))
    await new Promise(r => setTimeout(r, 80))

    const list = await env.Workspaces.list(-1)
    eq(list.filter(i => i.type === 'separator').length, 1, 'still there')
  }),

  test('labelling a separator reaches storage', async () => {
    const env = await boot()
    click(env.dom, env.doc.getElementById('add-sep'))
    await new Promise(r => setTimeout(r, 80))

    click(env.dom, env.doc.querySelector('.sep-label'))
    const input = env.doc.querySelector('.editor .rename')
    input.value = 'Reference'
    input.dispatchEvent(new env.dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await new Promise(r => setTimeout(r, 80))

    const index = await env.Store.loadIndex()
    const sep = Object.values(index.separators)[0]
    eq(sep.label, 'Reference', 'label stored')
  }),

  test('alignment and colour reach storage', async () => {
    const env = await boot()
    click(env.dom, env.doc.getElementById('add-sep'))
    await new Promise(r => setTimeout(r, 80))

    click(env.dom, env.doc.querySelector('.sep-label'))
    click(env.dom, env.doc.querySelector('.align-opt[data-align="center"]'))
    await new Promise(r => setTimeout(r, 80))
    click(env.dom, env.doc.querySelector('.sep-label'))
    click(env.dom, env.doc.querySelector('.editor .swatch[data-color="orange"]'))
    await new Promise(r => setTimeout(r, 80))

    const sep = Object.values((await env.Store.loadIndex()).separators)[0]
    eq(sep.align, 'center', 'alignment stored')
    eq(sep.color, 'orange', 'colour stored')
  }),

  test('removing a separator takes it out of storage', async () => {
    const env = await boot()
    click(env.dom, env.doc.getElementById('add-sep'))
    await new Promise(r => setTimeout(r, 80))
    click(env.dom, env.doc.querySelector('.sep .del'))
    await new Promise(r => setTimeout(r, 80))

    const index = await env.Store.loadIndex()
    eq(index.order.filter(id => id.startsWith('sep-')).length, 0, 'gone from the order')
    eq(env.doc.querySelectorAll('.sep').length, 0, 'and from the list')
  }),

  test('the new workspace form creates one with its details', async () => {
    const env = await boot()
    click(env.dom, env.doc.getElementById('new'))
    await new Promise(r => setTimeout(r, 80))

    const draft = env.doc.querySelector('.draft')
    ok(draft, 'the form opened')
    draft.querySelector('.rename').value = 'Research'
    click(env.dom, draft.querySelector('.swatch[data-color="cyan"]'))
    click(env.dom, draft.querySelector('#draft-create'))
    await new Promise(r => setTimeout(r, 80))

    const made = (await env.Store.loadAll()).find(w => w.name === 'Research')
    ok(made, 'workspace created')
    eq(made.color, 'cyan', 'with the chosen colour')
  }),
]

await run('popup and background together', tests)
