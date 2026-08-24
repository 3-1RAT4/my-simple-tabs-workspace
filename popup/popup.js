'use strict'

const listEl = document.getElementById('list')
const filterEl = document.getElementById('filter')
const emptyEl = document.getElementById('empty')
const errEl = document.getElementById('error')
const hintEl = document.getElementById('hint')

let settings = null
let workspaces = []
let visible = []
let focusIndex = 0
let dragging = null

function showError(err) {
  errEl.textContent = String(err?.message ?? err)
  errEl.hidden = false
}

async function send(method, extra = {}) {
  errEl.hidden = true
  try {
    return await browser.runtime.sendMessage({ method, ...extra })
  } catch (err) {
    showError(err)
    throw err
  }
}

function apply(next) {
  workspaces = next ?? workspaces
  const query = filterEl.value.trim().toLowerCase()
  // Filtering is a search through workspaces; separators are structure, not
  // results, so they step aside while a query is active.
  visible = query
    ? workspaces.filter(item => isWorkspace(item) && item.name.toLowerCase().includes(query))
    : workspaces

  emptyEl.hidden = visible.length > 0

  // Keep the cursor on the current workspace, or on whatever is still in view.
  const current = visible.findIndex(item => item.current)
  focusIndex = clampToWorkspace(current === -1 ? focusIndex : current, 1)

  render()
  updateHint()
}

// Separators are not workspaces, in the count or under the cursor.
function isWorkspace(item) {
  return item && item.type !== 'separator'
}

function clampToWorkspace(index, direction = 1) {
  if (!visible.length) return 0
  let i = Math.min(Math.max(index, 0), visible.length - 1)
  while (i >= 0 && i < visible.length && !isWorkspace(visible[i])) i += direction
  if (i < 0 || i >= visible.length) {
    i = visible.findIndex(isWorkspace)
    if (i === -1) i = 0
  }
  return i
}

function updateHint() {
  const total = workspaces.filter(isWorkspace).length
  hintEl.textContent = `${total} workspace${total === 1 ? '' : 's'} · v${
    browser.runtime.getManifest().version
  }`
}

function render() {
  listEl.textContent = ''

  visible.forEach((item, index) => {
    if (item.type === 'separator') {
      listEl.append(renderSeparator(item))
      return
    }
    listEl.append(renderWorkspace(item, index))
  })

  listEl.children[focusIndex]?.scrollIntoView({ block: 'nearest' })
}

// A rule with an optional label, which can sit left, centre or right and take
// a colour. Two line segments flex around the label; alignment decides which
// of them grows.
function renderSeparator(item) {
  const row = document.createElement('li')
  row.className = 'sep'
  row.draggable = true
  row.dataset.id = item.id
  row.dataset.align = item.align || 'left'
  row.dataset.color = item.color || 'default'
  row.setAttribute('role', 'separator')
  if (item.label) row.setAttribute('aria-label', item.label)

  const lineBefore = document.createElement('span')
  lineBefore.className = 'sep-line'

  const label = document.createElement('span')
  label.className = 'sep-label'
  label.textContent = item.label
  label.title = 'Click to edit this separator'

  const lineAfter = document.createElement('span')
  lineAfter.className = 'sep-line'

  const actions = document.createElement('span')
  actions.className = 'actions sep-actions'

  const edit = document.createElement('button')
  edit.className = 'act edit'
  edit.textContent = '\u270e'
  edit.title = 'Label, alignment and colour'
  edit.setAttribute('aria-label', 'Edit separator')

  const del = document.createElement('button')
  del.className = 'act del'
  del.textContent = '\u00d7'
  del.title = 'Remove separator'
  del.setAttribute('aria-label', 'Remove separator')

  actions.append(edit, del)
  row.append(lineBefore, label, lineAfter, actions)

  const open = event => {
    event.stopPropagation()
    toggleSeparatorEditor(row, item)
  }
  label.addEventListener('click', open)
  edit.addEventListener('click', open)

  del.addEventListener('click', async event => {
    event.stopPropagation()
    apply(await send('deleteSeparator', { separatorId: item.id }))
  })

  return row
}

function toggleSeparatorEditor(row, item) {
  const existing = row.nextElementSibling
  if (existing?.classList.contains('editor')) {
    existing.remove()
    delete row.dataset.editing
    return
  }

  document.querySelectorAll('.editor').forEach(el => el.remove())
  document.querySelectorAll('[data-editing]').forEach(el => delete el.dataset.editing)
  row.dataset.editing = 'true'

  const panel = document.createElement('li')
  panel.className = 'editor'

  const input = document.createElement('input')
  input.className = 'rename'
  input.type = 'text'
  input.value = item.label
  input.maxLength = 40
  input.placeholder = 'Label, or leave empty for a plain rule'
  input.setAttribute('aria-label', 'Separator label')

  const patch = async props => apply(await send('updateSeparator', { separatorId: item.id, props }))

  const aligns = document.createElement('div')
  aligns.className = 'aligns'
  for (const align of Palette.aligns) {
    const button = document.createElement('button')
    button.className = 'align-opt'
    button.dataset.align = align
    button.dataset.selected = String((item.align || 'left') === align)
    button.textContent = { left: '\u2261', center: '\u2261', right: '\u2261' }[align]
    button.title = `Align ${align}`
    button.setAttribute('aria-label', `Align ${align}`)
    aligns.append(button)

    button.addEventListener('click', event => {
      event.stopPropagation()
      patch({ align })
    })
  }

  const colors = document.createElement('div')
  colors.className = 'swatches'
  for (const color of Palette.colors) {
    const swatch = document.createElement('button')
    swatch.className = 'swatch'
    swatch.dataset.color = color
    swatch.dataset.selected = String((item.color || 'default') === color)
    swatch.title = color
    swatch.setAttribute('aria-label', `Colour ${color}`)
    colors.append(swatch)

    swatch.addEventListener('click', event => {
      event.stopPropagation()
      patch({ color })
    })
  }

  panel.append(input, aligns, colors)
  row.after(panel)
  input.focus()
  input.select()

  let done = false
  const finish = commit => {
    if (done) return
    done = true
    delete row.dataset.editing
    if (commit) patch({ label: input.value })
    else apply()
  }

  input.addEventListener('blur', () => finish(true), { once: true })
  input.addEventListener('click', event => event.stopPropagation())
  panel.addEventListener('click', event => event.stopPropagation())
  input.addEventListener('keydown', event => {
    event.stopPropagation()
    if (event.key === 'Enter') {
      event.preventDefault()
      finish(true)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      finish(false)
    }
  })
}

function renderWorkspace(ws, index) {
    const row = document.createElement('li')
    row.className = 'row'
    row.draggable = true
    row.dataset.id = ws.id
    row.dataset.color = ws.color || 'default'
    row.dataset.current = String(ws.current)
    row.dataset.open = String(ws.open)
    row.dataset.focused = String(index === focusIndex)
    row.setAttribute('role', 'option')
    row.setAttribute('aria-selected', String(ws.current))

    const chip = document.createElement('span')
    chip.className = 'chip'
    chip.textContent = ws.icon || (ws.current ? '\u25cf' : ws.open ? '\u25cb' : '\u00b7')

    const name = document.createElement('span')
    name.className = 'name'
    name.textContent = ws.name

    const count = document.createElement('span')
    count.className = 'count'
    count.textContent = ws.tabCount
    count.title = ws.open
      ? `${ws.tabCount} open tabs`
      : `${ws.tabCount} tabs, reopens with the window`

    const actions = document.createElement('span')
    actions.className = 'actions'

    const edit = document.createElement('button')
    edit.className = 'act edit'
    edit.textContent = '\u270e'
    edit.title = 'Rename, colour and icon'
    edit.setAttribute('aria-label', `Edit ${ws.name}`)

    const del = document.createElement('button')
    del.className = 'act del'
    del.textContent = '\u00d7'
    del.title = 'Delete workspace'
    del.setAttribute('aria-label', `Delete ${ws.name}`)

    actions.append(edit, del)
    row.append(chip, name, count, actions)

    row.addEventListener('click', () => {
      if (row.dataset.editing) return
      activate(ws)
    })

    row.addEventListener('mouseenter', () => setFocus(index, false))

    edit.addEventListener('click', event => {
      event.stopPropagation()
      toggleEditor(row, ws)
    })

    del.addEventListener('click', event => {
      event.stopPropagation()
      armDelete(del, ws)
    })

  return row
}

async function activate(ws) {
  if (!ws.current) await send('activate', { workspaceId: ws.id })
  window.close()
}

function setFocus(index, scroll = true, direction = 1) {
  focusIndex = clampToWorkspace(index, direction)
  ;[...listEl.children].forEach((row, i) => {
    if (row.classList.contains('row')) row.dataset.focused = String(i === focusIndex)
  })
  if (scroll) listEl.children[focusIndex]?.scrollIntoView({ block: 'nearest' })
}

// Two-step rather than a confirm() dialog: the popup stays put, and the button
// says what the next click does.
let armedTimer
function armDelete(button, ws) {
  if (settings && settings.behavior.confirmDelete === false) {
    send('delete', { workspaceId: ws.id }).then(apply)
    return
  }

  if (button.dataset.armed) {
    send('delete', { workspaceId: ws.id }).then(apply)
    return
  }

  document.querySelectorAll('.del[data-armed]').forEach(el => {
    delete el.dataset.armed
    el.textContent = '×'
  })

  button.dataset.armed = 'true'
  button.textContent = ws.open ? 'Close and delete?' : 'Delete?'

  clearTimeout(armedTimer)
  armedTimer = setTimeout(() => {
    delete button.dataset.armed
    button.textContent = '×'
  }, 3000)
}

// ---- the per-workspace editor ----------------------------------------------

function toggleEditor(row, ws) {
  const existing = row.nextElementSibling
  if (existing?.classList.contains('editor')) {
    existing.remove()
    delete row.dataset.editing
    return
  }

  document.querySelectorAll('.editor').forEach(el => el.remove())
  document.querySelectorAll('.row').forEach(el => delete el.dataset.editing)
  row.dataset.editing = 'true'

  const panel = document.createElement('li')
  panel.className = 'editor'

  const input = document.createElement('input')
  input.className = 'rename'
  input.type = 'text'
  input.value = ws.name
  input.maxLength = 60
  input.setAttribute('aria-label', 'Workspace name')

  const colors = document.createElement('div')
  colors.className = 'swatches'
  for (const color of Palette.colors) {
    const swatch = document.createElement('button')
    swatch.className = 'swatch'
    swatch.dataset.color = color
    swatch.dataset.selected = String((ws.color || 'default') === color)
    swatch.title = color
    swatch.setAttribute('aria-label', `Colour ${color}`)
    colors.append(swatch)

    swatch.addEventListener('click', async event => {
      event.stopPropagation()
      apply(await send('update', { workspaceId: ws.id, props: { color } }))
    })
  }

  const icons = document.createElement('div')
  icons.className = 'icons'
  for (const icon of Palette.icons) {
    const button = document.createElement('button')
    button.className = 'icon-opt'
    button.dataset.selected = String((ws.icon || '') === icon)
    button.textContent = icon || '∅'
    button.title = icon ? `Use ${icon}` : 'No icon'
    button.setAttribute('aria-label', icon ? `Icon ${icon}` : 'No icon')
    icons.append(button)

    button.addEventListener('click', async event => {
      event.stopPropagation()
      apply(await send('update', { workspaceId: ws.id, props: { icon } }))
    })
  }

  panel.append(input, colors, icons)
  row.after(panel)
  input.focus()
  input.select()

  const commit = async () => {
    const value = input.value.trim()
    if (!value || value === ws.name) return
    apply(await send('update', { workspaceId: ws.id, props: { name: value } }))
  }

  input.addEventListener('keydown', event => {
    event.stopPropagation()
    if (event.key === 'Enter') {
      event.preventDefault()
      commit()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      panel.remove()
      delete row.dataset.editing
    }
  })
  input.addEventListener('click', event => event.stopPropagation())
  panel.addEventListener('click', event => event.stopPropagation())
}

// ---- keyboard ---------------------------------------------------------------

document.addEventListener('keydown', event => {
  if (document.querySelector('.editor')) return

  const ws = isWorkspace(visible[focusIndex]) ? visible[focusIndex] : null

  if (event.key === 'ArrowDown') {
    event.preventDefault()
    setFocus(focusIndex + 1, true, 1)
  } else if (event.key === 'ArrowUp') {
    event.preventDefault()
    setFocus(focusIndex - 1, true, -1)
  } else if (event.key === 'Home') {
    event.preventDefault()
    setFocus(0)
  } else if (event.key === 'End') {
    event.preventDefault()
    setFocus(visible.length - 1, true, -1)
  } else if (event.key === 'Enter' && ws) {
    event.preventDefault()
    activate(ws)
  } else if (event.key === 'F2' && ws) {
    event.preventDefault()
    toggleEditor(listEl.children[focusIndex], ws)
  } else if (event.key === 'Escape') {
    if (filterEl.value) {
      event.preventDefault()
      filterEl.value = ''
      apply()
    }
  } else if (
    /^[1-9]$/.test(event.key) &&
    document.activeElement !== filterEl &&
    settings?.behavior.quickSwitchKeys !== false
  ) {
    const target = visible.filter(isWorkspace)[Number(event.key) - 1]
    if (target) {
      event.preventDefault()
      activate(target)
    }
  }
})

filterEl.addEventListener('input', () => apply())

// ---- drag to reorder --------------------------------------------------------

listEl.addEventListener('dragstart', event => {
  // Separators are draggable as well, so the selector cannot be .row alone.
  const row = event.target.closest('.row, .sep')
  if (!row) return
  dragging = row
  row.dataset.dragging = 'true'
  event.dataTransfer.effectAllowed = 'move'
  event.dataTransfer.setData('text/plain', row.dataset.id)
})

listEl.addEventListener('dragover', event => {
  if (!dragging) return
  event.preventDefault()
  event.dataTransfer.dropEffect = 'move'

  const over = event.target.closest('.row, .sep')
  if (!over || over === dragging) return

  const box = over.getBoundingClientRect()
  listEl.insertBefore(dragging, event.clientY > box.top + box.height / 2 ? over.nextSibling : over)
})

listEl.addEventListener('dragend', async () => {
  if (!dragging) return
  delete dragging.dataset.dragging
  dragging = null

  // Reordering a filtered view would drop the hidden ones, so only the full
  // list can be reordered.
  if (filterEl.value.trim()) return apply()

  const order = [...listEl.children].filter(el => el.dataset.id).map(el => el.dataset.id)
  apply(await send('reorder', { order }))
})

// ---- footer -----------------------------------------------------------------

document.getElementById('new').addEventListener('click', async () => {
  await send('create')
  window.close()
})

document.getElementById('add-sep').addEventListener('click', async () => {
  apply(await send('addSeparator', { props: {} }))
})

document.getElementById('backup').addEventListener('click', event => {
  event.preventDefault()
  browser.runtime.openOptionsPage()
  window.close()
})

// The dump is made to be pasted somewhere public, so it leaves out page titles
// and shortens addresses to their site. The checkbox puts the detail back for
// the rare bug that is about one specific page.
async function copyDiagnostics(target) {
  const full = document.getElementById('diagfull').checked
  const dump = JSON.stringify(await send('diagnostics', { full }), null, 2)

  const out = document.getElementById('diagout')
  out.value = dump
  out.hidden = false
  out.select()

  try {
    await navigator.clipboard.writeText(dump)
    target.textContent = full ? 'copied, with addresses' : 'copied'
  } catch {
    target.textContent = 'select all and copy'
  }
}

document.getElementById('diag').addEventListener('click', async event => {
  event.preventDefault()
  document.getElementById('diagnote').hidden = false
  await copyDiagnostics(event.target)
})

document.getElementById('diagfull').addEventListener('change', () =>
  copyDiagnostics(document.getElementById('diag'))
)

// Settings arrive before the first paint so the popup never renders at one
// size and then jumps to another.
async function start() {
  try {
    const res = await send('getSettings')
    settings = res.settings
    applySettings(settings)
  } catch {
    // Falling back to the stylesheet's own values is fine.
  }
  apply(await send('list'))
}

function applySettings(values) {
  const root = document.documentElement
  root.style.setProperty('--scale', values.ui.scale)
  root.style.setProperty('--text', values.ui.text)
  root.style.setProperty('--list-height', `${values.ui.listHeight}px`)
}

start().catch(() => {})
