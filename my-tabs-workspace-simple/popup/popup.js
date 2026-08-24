'use strict'

const listEl = document.getElementById('list')
const filterEl = document.getElementById('filter')
const emptyEl = document.getElementById('empty')
const errEl = document.getElementById('error')
const hintEl = document.getElementById('hint')

// Shown only once the list is long enough that scanning it stops being instant.
const FILTER_THRESHOLD = 6

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
  visible = query ? workspaces.filter(ws => ws.name.toLowerCase().includes(query)) : workspaces

  filterEl.hidden = workspaces.length < FILTER_THRESHOLD
  emptyEl.hidden = visible.length > 0

  // Keep the cursor on the current workspace, or on whatever is still in view.
  const current = visible.findIndex(ws => ws.current)
  focusIndex = Math.min(Math.max(current === -1 ? focusIndex : current, 0), Math.max(visible.length - 1, 0))

  render()
  updateHint()
}

function updateHint() {
  const total = workspaces.length
  hintEl.textContent = `${total} workspace${total === 1 ? '' : 's'} · v${
    browser.runtime.getManifest().version
  }`
}

function render() {
  listEl.textContent = ''

  visible.forEach((ws, index) => {
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
    chip.textContent = ws.icon || (ws.current ? '●' : ws.open ? '○' : '·')

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
    edit.textContent = '✎'
    edit.title = 'Rename, colour and icon'
    edit.setAttribute('aria-label', `Edit ${ws.name}`)

    const del = document.createElement('button')
    del.className = 'act del'
    del.textContent = '×'
    del.title = 'Delete workspace'
    del.setAttribute('aria-label', `Delete ${ws.name}`)

    actions.append(edit, del)
    row.append(chip, name, count, actions)
    listEl.append(row)

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
  })

  const focused = listEl.children[focusIndex]
  focused?.scrollIntoView({ block: 'nearest' })
}

async function activate(ws) {
  if (!ws.current) await send('activate', { workspaceId: ws.id })
  window.close()
}

function setFocus(index, scroll = true) {
  focusIndex = Math.min(Math.max(index, 0), visible.length - 1)
  ;[...listEl.children].forEach((row, i) => {
    row.dataset.focused = String(i === focusIndex)
  })
  if (scroll) listEl.children[focusIndex]?.scrollIntoView({ block: 'nearest' })
}

// Two-step rather than a confirm() dialog: the popup stays put, and the button
// says what the next click does.
let armedTimer
function armDelete(button, ws) {
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

  const ws = visible[focusIndex]

  if (event.key === 'ArrowDown') {
    event.preventDefault()
    setFocus(focusIndex + 1)
  } else if (event.key === 'ArrowUp') {
    event.preventDefault()
    setFocus(focusIndex - 1)
  } else if (event.key === 'Home') {
    event.preventDefault()
    setFocus(0)
  } else if (event.key === 'End') {
    event.preventDefault()
    setFocus(visible.length - 1)
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
  } else if (/^[1-9]$/.test(event.key) && document.activeElement !== filterEl) {
    const target = visible[Number(event.key) - 1]
    if (target) {
      event.preventDefault()
      activate(target)
    }
  }
})

filterEl.addEventListener('input', () => apply())

// ---- drag to reorder --------------------------------------------------------

listEl.addEventListener('dragstart', event => {
  const row = event.target.closest('.row')
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

  const over = event.target.closest('.row')
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

document.getElementById('backup').addEventListener('click', event => {
  event.preventDefault()
  browser.runtime.openOptionsPage()
  window.close()
})

document.getElementById('diag').addEventListener('click', async event => {
  event.preventDefault()
  const dump = JSON.stringify(await send('diagnostics'), null, 2)

  const out = document.getElementById('diagout')
  out.value = dump
  out.hidden = false
  out.select()

  try {
    await navigator.clipboard.writeText(dump)
    event.target.textContent = 'copied'
  } catch {
    event.target.textContent = 'select all and copy'
  }
})

send('list').then(apply).catch(() => {})
