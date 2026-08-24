// Executes the real popup.html + popup.js in a DOM.
import { JSDOM, VirtualConsole } from '../node_modules/jsdom/lib/api.js'
import { readFileSync } from 'node:fs'
import { test, run, eq, ok } from './lib/test-kit.mjs'

const dir = new URL('../popup/', import.meta.url).pathname
const sent = []

function mount(workspaces) {
  sent.length = 0
  const vc = new VirtualConsole()
  vc.on('jsdomError', e => {
    throw new Error(e.message)
  })

  const dom = new JSDOM(readFileSync(dir + 'popup.html', 'utf8'), {
    runScripts: 'dangerously',
    url: 'moz-extension://test/popup/popup.html',
    virtualConsole: vc,
    beforeParse(win) {
      win.browser = {
        runtime: {
          getManifest: () => ({ version: '1.0.1' }),
          sendMessage: async msg => {
            sent.push(msg)
            if (msg.method === 'nextName') return { name: 'Workspace 4' }
            return workspaces
          },
        },
      }
      win.close = () => {}
      // jsdom implements no layout, so scrollIntoView is missing entirely.
      win.HTMLElement.prototype.scrollIntoView = () => {}
    },
  })
  dom.window.eval(readFileSync(dir + '../shared/palette.js', 'utf8'))
  dom.window.eval(readFileSync(dir + 'popup.js', 'utf8'))
  return dom
}

const ws = (id, name, extra = {}) => ({
  type: 'workspace',
  id,
  name,
  open: true,
  current: false,
  tabCount: 1,
  color: 'default',
  icon: '',
  ...extra,
})

const WS = [
  ws('a', 'Work', { current: true, tabCount: 3, color: 'purple', icon: '💼' }),
  ws('b', 'Personal', { tabCount: 7 }),
  ws('c', 'Archive', { open: false, tabCount: 12, color: 'green', icon: '📚' }),
]

const WITH_SEP = [
  ws('a', 'Work', { current: true, color: 'purple' }),
  { type: 'separator', id: 'sep-1', label: 'Personal' },
  ws('b', 'Shopping'),
  ws('c', 'Media'),
]

const tests = [
  test('rows render with the right state marks', async () => {
    const dom = mount(WS)
    await new Promise(r => setTimeout(r, 60))
    const rows = [...dom.window.document.querySelectorAll('.row')]
    eq(rows.length, 3, 'row count')
    eq(rows[0].dataset.current, 'true', 'current marked')
    eq(rows[2].dataset.open, 'false', 'closed marked')
  }),

  test('the chip shows the workspace icon', async () => {
    const dom = mount(WS)
    await new Promise(r => setTimeout(r, 60))
    const chips = [...dom.window.document.querySelectorAll('.chip')]
    eq(chips[0].textContent, '💼', 'icon shown')
    eq(chips[2].textContent, '📚', 'icon shown on closed row too')
  }),

  test('the colour is carried by the whole row', async () => {
    const dom = mount(WS)
    await new Promise(r => setTimeout(r, 60))
    const rows = [...dom.window.document.querySelectorAll('.row')]
    eq(rows.map(r => r.dataset.color), ['purple', 'default', 'green'], 'per-row colour')
  }),

  test('an uncoloured workspace still gets a row colour value', async () => {
    const dom = mount([{ id: 'x', name: 'Plain', open: true, current: false, tabCount: 1 }])
    await new Promise(r => setTimeout(r, 60))
    eq(dom.window.document.querySelector('.row').dataset.color, 'default', 'defaults cleanly')
  }),

  test('a workspace with no icon falls back to a state mark', async () => {
    const dom = mount(WS)
    await new Promise(r => setTimeout(r, 60))
    const chip = [...dom.window.document.querySelectorAll('.chip')][1]
    eq(chip.textContent, '\u25cb', 'open-elsewhere mark')
  }),

  test('the edit button opens a panel with name, colours and icons', async () => {
    const dom = mount(WS)
    await new Promise(r => setTimeout(r, 60))
    const row = dom.window.document.querySelector('.row')
    row.querySelector('.act.edit').dispatchEvent(
      new dom.window.MouseEvent('click', { bubbles: true })
    )

    const panel = dom.window.document.querySelector('.editor')
    ok(panel, 'panel opened')
    eq(panel.querySelector('.rename').value, 'Work', 'name prefilled')
    eq(panel.querySelectorAll('.swatch').length, 10, 'every colour offered')
    eq(panel.querySelectorAll('.icon-opt').length, 14, 'every icon offered')
    eq(panel.querySelector('.swatch[data-color="purple"]').dataset.selected, 'true', 'current colour marked')
  }),

  test('clicking a swatch sends the colour', async () => {
    const dom = mount(WS)
    await new Promise(r => setTimeout(r, 60))
    const row = dom.window.document.querySelector('.row')
    row.querySelector('.act.edit').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
    dom.window.document
      .querySelector('.swatch[data-color="red"]')
      .dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
    await new Promise(r => setTimeout(r, 60))

    const msg = sent.find(m => m.method === 'update' && m.props.color)
    ok(msg, 'update sent')
    eq(msg.props.color, 'red', 'the chosen colour')
    eq(msg.workspaceId, 'a', 'for the right workspace')
  }),

  test('clicking an icon sends the icon', async () => {
    const dom = mount(WS)
    await new Promise(r => setTimeout(r, 60))
    const row = dom.window.document.querySelector('.row')
    row.querySelector('.act.edit').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
    const opt = [...dom.window.document.querySelectorAll('.icon-opt')].find(b => b.textContent === '🎮')
    opt.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
    await new Promise(r => setTimeout(r, 60))

    const msg = sent.find(m => m.method === 'update' && m.props.icon)
    ok(msg, 'update sent')
    eq(msg.props.icon, '🎮', 'the chosen icon')
  }),

  test('Enter in the name field commits a rename', async () => {
    const dom = mount(WS)
    await new Promise(r => setTimeout(r, 60))
    const row = dom.window.document.querySelector('.row')
    row.querySelector('.act.edit').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))

    const input = dom.window.document.querySelector('.rename')
    input.value = 'Renamed'
    input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await new Promise(r => setTimeout(r, 60))

    const msg = sent.find(m => m.method === 'update' && m.props.name)
    ok(msg, 'update sent')
    eq(msg.props.name, 'Renamed', 'with the typed name')
  }),

  test('Escape closes the editor without renaming', async () => {
    const dom = mount(WS)
    await new Promise(r => setTimeout(r, 60))
    const row = dom.window.document.querySelector('.row')
    row.querySelector('.act.edit').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))

    const input = dom.window.document.querySelector('.rename')
    input.value = 'Discard me'
    input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await new Promise(r => setTimeout(r, 60))

    eq(sent.filter(m => m.method === 'update').length, 0, 'nothing sent')
    ok(!dom.window.document.querySelector('.editor'), 'panel closed')
  }),

  test('the edit button toggles the panel shut again', async () => {
    const dom = mount(WS)
    await new Promise(r => setTimeout(r, 60))
    const row = dom.window.document.querySelector('.row')
    const edit = row.querySelector('.act.edit')
    edit.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
    ok(dom.window.document.querySelector('.editor'), 'open')
    edit.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
    ok(!dom.window.document.querySelector('.editor'), 'closed')
  }),

  test('opening the editor does not switch workspace', async () => {
    const dom = mount(WS)
    await new Promise(r => setTimeout(r, 60))
    const row = dom.window.document.querySelectorAll('.row')[1]
    row.querySelector('.act.edit').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
    await new Promise(r => setTimeout(r, 60))
    eq(sent.filter(m => m.method === 'activate').length, 0, 'no activate sent')
  }),

  test('arrow keys move the focus cursor', async () => {
    const dom = mount(WS)
    await new Promise(r => setTimeout(r, 60))
    const rows = () => [...dom.window.document.querySelectorAll('.row')]

    eq(rows()[0].dataset.focused, 'true', 'starts on the current workspace')
    dom.window.document.dispatchEvent(
      new dom.window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })
    )
    eq(rows()[1].dataset.focused, 'true', 'moved down')
    dom.window.document.dispatchEvent(
      new dom.window.KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true })
    )
    eq(rows()[0].dataset.focused, 'true', 'moved back up')
  }),

  test('the cursor does not run off either end', async () => {
    const dom = mount(WS)
    await new Promise(r => setTimeout(r, 60))
    const press = key =>
      dom.window.document.dispatchEvent(
        new dom.window.KeyboardEvent('keydown', { key, bubbles: true })
      )

    press('ArrowUp')
    eq([...dom.window.document.querySelectorAll('.row')][0].dataset.focused, 'true', 'held at top')
    press('End')
    press('ArrowDown')
    eq([...dom.window.document.querySelectorAll('.row')][2].dataset.focused, 'true', 'held at bottom')
  }),

  test('Enter activates the focused workspace', async () => {
    const dom = mount(WS)
    await new Promise(r => setTimeout(r, 60))
    dom.window.document.dispatchEvent(
      new dom.window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })
    )
    dom.window.document.dispatchEvent(
      new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
    )
    await new Promise(r => setTimeout(r, 60))

    const msg = sent.find(m => m.method === 'activate')
    ok(msg, 'activate sent')
    eq(msg.workspaceId, 'b', 'the focused one')
  }),

  test('number keys jump straight to a workspace', async () => {
    const dom = mount(WS)
    await new Promise(r => setTimeout(r, 60))
    dom.window.document.dispatchEvent(
      new dom.window.KeyboardEvent('keydown', { key: '3', bubbles: true })
    )
    await new Promise(r => setTimeout(r, 60))

    const msg = sent.find(m => m.method === 'activate')
    ok(msg, 'activate sent')
    eq(msg.workspaceId, 'c', 'the third row')
  }),

  test('F2 opens the editor for the focused workspace', async () => {
    const dom = mount(WS)
    await new Promise(r => setTimeout(r, 60))
    dom.window.document.dispatchEvent(
      new dom.window.KeyboardEvent('keydown', { key: 'F2', bubbles: true })
    )
    const panel = dom.window.document.querySelector('.editor')
    ok(panel, 'editor opened')
    eq(panel.querySelector('.rename').value, 'Work', 'for the focused row')
  }),

  test('delete takes two clicks and says so', async () => {
    const dom = mount(WS)
    await new Promise(r => setTimeout(r, 60))
    const del = dom.window.document.querySelector('.row .del')

    del.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
    eq(del.dataset.armed, 'true', 'armed')
    eq(del.textContent, 'Close and delete?', 'says what happens next')
    eq(sent.filter(m => m.method === 'delete').length, 0, 'nothing deleted yet')

    del.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
    await new Promise(r => setTimeout(r, 60))
    eq(sent.filter(m => m.method === 'delete').length, 1, 'second click deletes')
  }),

  test('a closed workspace offers a plain delete', async () => {
    const dom = mount(WS)
    await new Promise(r => setTimeout(r, 60))
    const del = [...dom.window.document.querySelectorAll('.row .del')][2]
    del.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
    eq(del.textContent, 'Delete?', 'no window to close')
  }),

  test('the filter is always available', async () => {
    const dom = mount(WS)
    await new Promise(r => setTimeout(r, 60))
    eq(dom.window.document.getElementById('filter').hidden, false, 'shown with three workspaces')
  }),

  test('separators render as a labelled rule', async () => {
    const dom = mount(WITH_SEP)
    await new Promise(r => setTimeout(r, 60))
    const seps = [...dom.window.document.querySelectorAll('.sep')]
    eq(seps.length, 1, 'one separator')
    eq(seps[0].querySelector('.sep-label').textContent, 'Personal', 'label shown')
    eq(seps[0].getAttribute('role'), 'separator', 'announced as a separator')
    eq(dom.window.document.querySelectorAll('.row').length, 3, 'workspaces still listed')
  }),

  test('the cursor steps over separators', async () => {
    const dom = mount(WITH_SEP)
    await new Promise(r => setTimeout(r, 60))
    const press = key =>
      dom.window.document.dispatchEvent(
        new dom.window.KeyboardEvent('keydown', { key, bubbles: true })
      )
    const focusedId = () =>
      [...dom.window.document.querySelectorAll('.row')].find(r => r.dataset.focused === 'true')
        ?.dataset.id

    eq(focusedId(), 'a', 'starts on the current workspace')
    press('ArrowDown')
    eq(focusedId(), 'b', 'skipped the separator')
    press('ArrowUp')
    eq(focusedId(), 'a', 'and skipped it going back')
  }),

  test('number keys count workspaces, not list rows', async () => {
    const dom = mount(WITH_SEP)
    await new Promise(r => setTimeout(r, 60))
    dom.window.document.dispatchEvent(
      new dom.window.KeyboardEvent('keydown', { key: '2', bubbles: true })
    )
    await new Promise(r => setTimeout(r, 60))
    eq(sent.find(m => m.method === 'activate')?.workspaceId, 'b', 'second workspace, not the separator')
  }),

  test('clicking a separator opens its editor', async () => {
    const dom = mount(WITH_SEP)
    await new Promise(r => setTimeout(r, 60))
    dom.window.document
      .querySelector('.sep-label')
      .dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))

    const panel = dom.window.document.querySelector('.editor')
    ok(panel, 'editor appeared')
    eq(panel.querySelector('.rename').value, 'Personal', 'label prefilled')
    eq(panel.querySelectorAll('.align-opt').length, 3, 'three alignments offered')
    eq(panel.querySelectorAll('.swatch').length, 10, 'every colour offered')
  }),

  test('Enter saves a separator label', async () => {
    const dom = mount(WITH_SEP)
    await new Promise(r => setTimeout(r, 60))
    dom.window.document
      .querySelector('.sep-label')
      .dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))

    const input = dom.window.document.querySelector('.editor .rename')
    input.value = 'Leisure'
    input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await new Promise(r => setTimeout(r, 60))

    const msg = sent.find(m => m.method === 'updateSeparator')
    ok(msg, 'update sent')
    eq(msg.props.label, 'Leisure', 'the typed label')
    eq(msg.separatorId, 'sep-1', 'for the right separator')
  }),

  test('alignment and colour are applied to the separator row', async () => {
    const dom = mount([
      ws('a', 'Work', { current: true }),
      { type: 'separator', id: 'sep-1', label: 'Middle', align: 'center', color: 'purple' },
    ])
    await new Promise(r => setTimeout(r, 60))
    const sep = dom.window.document.querySelector('.sep')
    eq(sep.dataset.align, 'center', 'alignment on the row')
    eq(sep.dataset.color, 'purple', 'colour on the row')
    eq(sep.querySelectorAll('.sep-line').length, 2, 'a line either side of the label')
  }),

  test('choosing an alignment sends it', async () => {
    const dom = mount(WITH_SEP)
    await new Promise(r => setTimeout(r, 60))
    dom.window.document
      .querySelector('.sep-label')
      .dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
    dom.window.document
      .querySelector('.align-opt[data-align="center"]')
      .dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
    await new Promise(r => setTimeout(r, 60))

    const msg = sent.find(m => m.method === 'updateSeparator' && m.props.align)
    ok(msg, 'update sent')
    eq(msg.props.align, 'center', 'the chosen alignment')
  }),

  test('choosing a separator colour sends it', async () => {
    const dom = mount(WITH_SEP)
    await new Promise(r => setTimeout(r, 60))
    dom.window.document
      .querySelector('.sep-label')
      .dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
    dom.window.document
      .querySelector('.editor .swatch[data-color="orange"]')
      .dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
    await new Promise(r => setTimeout(r, 60))

    const msg = sent.find(m => m.method === 'updateSeparator' && m.props.color)
    ok(msg, 'update sent')
    eq(msg.props.color, 'orange', 'the chosen colour')
  }),

  test('a separator is draggable, which the drag handlers must accept', async () => {
    const dom = mount(WITH_SEP)
    await new Promise(r => setTimeout(r, 60))
    const sep = dom.window.document.querySelector('.sep')
    eq(sep.draggable, true, 'marked draggable')

    // The bug this covers: the handlers matched .row only, so dragstart on a
    // separator never took hold and it could not be moved.
    const transfer = { effectAllowed: '', setData() {}, dropEffect: '' }
    const event = new dom.window.MouseEvent('dragstart', { bubbles: true })
    Object.defineProperty(event, 'dataTransfer', { value: transfer })
    sep.dispatchEvent(event)
    eq(sep.dataset.dragging, 'true', 'the drag was picked up')
  }),

  test('removing a separator asks the background to drop it', async () => {
    const dom = mount(WITH_SEP)
    await new Promise(r => setTimeout(r, 60))
    dom.window.document
      .querySelector('.sep .del')
      .dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
    await new Promise(r => setTimeout(r, 60))
    eq(sent.find(m => m.method === 'deleteSeparator')?.separatorId, 'sep-1', 'by id')
  }),

  test('New workspace opens a form instead of creating one', async () => {
    const dom = mount(WS)
    await new Promise(r => setTimeout(r, 60))
    dom.window.document
      .getElementById('new')
      .dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
    await new Promise(r => setTimeout(r, 60))

    const draft = dom.window.document.querySelector('.draft')
    ok(draft, 'the form appeared')
    eq(draft.querySelector('.rename').value, 'Workspace 4', 'name suggested')
    eq(draft.querySelectorAll('.swatch').length, 10, 'colours offered')
    eq(draft.querySelectorAll('.icon-opt').length, 14, 'icons offered')
    eq(sent.filter(m => m.method === 'create').length, 0, 'nothing created yet')
  }),

  test('the form sends the chosen name, colour and icon', async () => {
    const dom = mount(WS)
    await new Promise(r => setTimeout(r, 60))
    dom.window.document
      .getElementById('new')
      .dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
    await new Promise(r => setTimeout(r, 60))

    const draft = dom.window.document.querySelector('.draft')
    draft.querySelector('.rename').value = 'Research'
    draft
      .querySelector('.swatch[data-color="cyan"]')
      .dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
    ;[...draft.querySelectorAll('.icon-opt')]
      .find(b => b.textContent === '📚')
      .dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))

    draft
      .querySelector('#draft-create')
      .dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
    await new Promise(r => setTimeout(r, 60))

    const msg = sent.find(m => m.method === 'create')
    ok(msg, 'create sent')
    eq(msg.props.name, 'Research', 'name')
    eq(msg.props.color, 'cyan', 'colour')
    eq(msg.props.icon, '📚', 'icon')
  }),

  test('choosing in the form marks the selection without creating anything', async () => {
    const dom = mount(WS)
    await new Promise(r => setTimeout(r, 60))
    dom.window.document
      .getElementById('new')
      .dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
    await new Promise(r => setTimeout(r, 60))

    const draft = dom.window.document.querySelector('.draft')
    const red = draft.querySelector('.swatch[data-color="red"]')
    red.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))

    eq(red.dataset.selected, 'true', 'the choice shows')
    eq(draft.querySelector('.swatch[data-color="default"]').dataset.selected, 'false', 'and the old one clears')
    eq(sent.filter(m => m.method === 'create' || m.method === 'update').length, 0, 'still nothing stored')
  }),

  test('Cancel leaves no trace', async () => {
    const dom = mount(WS)
    await new Promise(r => setTimeout(r, 60))
    dom.window.document
      .getElementById('new')
      .dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
    await new Promise(r => setTimeout(r, 60))

    const cancel = [...dom.window.document.querySelectorAll('.draft-actions .new')].at(-1)
    cancel.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
    await new Promise(r => setTimeout(r, 60))

    ok(!dom.window.document.querySelector('.draft'), 'form closed')
    eq(sent.filter(m => m.method === 'create').length, 0, 'nothing created')
  }),

  test('Escape in the form cancels it', async () => {
    const dom = mount(WS)
    await new Promise(r => setTimeout(r, 60))
    dom.window.document
      .getElementById('new')
      .dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
    await new Promise(r => setTimeout(r, 60))

    dom.window.document
      .querySelector('.draft .rename')
      .dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await new Promise(r => setTimeout(r, 60))
    ok(!dom.window.document.querySelector('.draft'), 'form closed')
  }),

  test('Enter in the name field creates it', async () => {
    const dom = mount(WS)
    await new Promise(r => setTimeout(r, 60))
    dom.window.document
      .getElementById('new')
      .dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
    await new Promise(r => setTimeout(r, 60))

    const input = dom.window.document.querySelector('.draft .rename')
    input.value = 'Quick'
    input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await new Promise(r => setTimeout(r, 60))

    eq(sent.find(m => m.method === 'create')?.props.name, 'Quick', 'created with that name')
  }),

  test('the add separator button asks for one', async () => {
    const dom = mount(WS)
    await new Promise(r => setTimeout(r, 60))
    dom.window.document
      .getElementById('add-sep')
      .dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
    await new Promise(r => setTimeout(r, 60))
    ok(sent.some(m => m.method === 'addSeparator'), 'requested')
  }),

  test('filtering hides separators along with non-matches', async () => {
    const dom = mount(WITH_SEP)
    await new Promise(r => setTimeout(r, 60))
    const filter = dom.window.document.getElementById('filter')
    filter.value = 'shop'
    filter.dispatchEvent(new dom.window.Event('input', { bubbles: true }))

    eq(dom.window.document.querySelectorAll('.row').length, 1, 'one match')
    eq(dom.window.document.querySelectorAll('.sep').length, 0, 'separator stepped aside')
  }),

  test('filtering narrows the list and reports an empty result', async () => {
    const dom = mount(
      Array.from({ length: 8 }, (_, i) => ({
        id: `w${i}`,
        name: i === 3 ? 'Research' : `Workspace ${i}`,
        open: true,
        current: i === 0,
        tabCount: 1,
      }))
    )
    await new Promise(r => setTimeout(r, 60))

    const filter = dom.window.document.getElementById('filter')
    filter.value = 'resea'
    filter.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    eq(dom.window.document.querySelectorAll('.row').length, 1, 'one match')

    filter.value = 'zzzz'
    filter.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    eq(dom.window.document.querySelectorAll('.row').length, 0, 'no matches')
    eq(dom.window.document.getElementById('empty').hidden, false, 'empty state shown')
  }),

  test('rows carry listbox semantics', async () => {
    const dom = mount(WS)
    await new Promise(r => setTimeout(r, 60))
    const rows = [...dom.window.document.querySelectorAll('.row')]
    eq(rows[0].getAttribute('role'), 'option', 'role')
    eq(rows[0].getAttribute('aria-selected'), 'true', 'current row selected')
    eq(rows[1].getAttribute('aria-selected'), 'false', 'others not')
  }),

  test('the footer reports the count and version', async () => {
    const dom = mount(WS)
    await new Promise(r => setTimeout(r, 60))
    ok(dom.window.document.getElementById('hint').textContent.includes('v1.0.1'), 'version shown')
    ok(dom.window.document.getElementById('hint').textContent.includes('3 workspaces'), 'count shown')

    const mixed = mount(WITH_SEP)
    await new Promise(r => setTimeout(r, 60))
    ok(
      mixed.window.document.getElementById('hint').textContent.includes('3 workspaces'),
      'separators are not counted as workspaces'
    )
  }),

  test('drag rows are draggable', async () => {
    const dom = mount(WS)
    await new Promise(r => setTimeout(r, 60))
    ok([...dom.window.document.querySelectorAll('.row')].every(r => r.draggable), 'draggable')
  }),
]

await run('popup', tests)
