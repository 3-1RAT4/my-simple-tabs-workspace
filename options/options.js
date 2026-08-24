'use strict'

const statusEl = document.getElementById('status')

function say(text, kind = 'ok') {
  statusEl.textContent = text
  statusEl.dataset.kind = kind
  statusEl.hidden = false
}

function stamp() {
  const now = new Date()
  const pad = n => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

// ---- optional permissions ---------------------------------------------------

// Said at the moment it matters: right after a restore that contains container
// tabs, while the workspaces are still closed and nothing has been lost yet.
function showContainerPrompt(result) {
  const box = document.getElementById('import-containers')
  if (!result.containerTabs || result.canRestoreContainers) {
    box.hidden = true
    return
  }

  const n = result.containerTabs
  document.getElementById('import-containers-text').textContent =
    `${n} restored tab${n === 1 ? '' : 's'} belong${n === 1 ? 's' : ''} to a container. ` +
    `Without permission to read cookies ${n === 1 ? 'it' : 'they'} will reopen in the default ` +
    `container. Nothing is lost yet: the containers are still recorded.`
  box.hidden = false
}

document.getElementById('import-containers-fix').addEventListener('click', async () => {
  const granted = await browser.permissions.request(COOKIES)
  if (!granted) return
  document.getElementById('import-containers').hidden = true
  await renderPermission()
  say('Containers will be restored.')
})

const COOKIES = { permissions: ['cookies'] }

async function renderPermission() {
  const { granted, storedContainerTabs } = await browser.runtime.sendMessage({
    method: 'containerInfo',
  })
  const state = document.getElementById('perm-state')
  const button = document.getElementById('perm-toggle')

  // Saying how many saved tabs actually use a container turns an abstract
  // permission question into a concrete one.
  const affected =
    storedContainerTabs === 0
      ? 'No saved tab uses a container, so this changes nothing today.'
      : `${storedContainerTabs} saved tab${storedContainerTabs === 1 ? '' : 's'} use${
          storedContainerTabs === 1 ? 's' : ''
        } a container.`

  state.hidden = false
  state.textContent = granted
    ? `Granted. Rebuilt tabs return to their containers. ${affected}`
    : `Not granted. Rebuilt tabs return to the default container. ${affected}`
  state.dataset.kind = granted ? 'ok' : ''
  button.textContent = granted ? 'Withdraw permission' : 'Allow container tabs'
}

document.getElementById('perm-toggle').addEventListener('click', async () => {
  // request() and remove() both need a user gesture, which is why this lives on
  // a button rather than being asked for when a restore happens to need it.
  const granted = await browser.permissions.contains(COOKIES)
  if (granted) await browser.permissions.remove(COOKIES)
  else await browser.permissions.request(COOKIES)
  await renderPermission()
})

// ---- settings ---------------------------------------------------------------

// The schema comes from the background, so this page renders whatever the
// add-on currently supports without needing to know the list itself.
async function renderSettings() {
  const { settings, schema } = await browser.runtime.sendMessage({ method: 'getSettings' })
  const host = document.getElementById('settings')
  host.textContent = ''

  for (const [path, spec] of Object.entries(schema)) {
    const value = path.split('.').reduce((node, key) => node?.[key], settings)

    const row = document.createElement('div')
    row.className = 'setting'

    const label = document.createElement('span')
    label.className = 'setting-label'
    label.textContent = spec.label

    const control = document.createElement('span')
    control.className = 'setting-control'

    const input = document.createElement('input')
    input.id = `set-${path}`
    label.setAttribute('for', input.id)

    if (spec.kind === 'boolean') {
      input.type = 'checkbox'
      input.checked = !!value
    } else {
      input.type = 'range'
      input.min = spec.min
      input.max = spec.max
      input.step = spec.step
      input.value = value
    }

    const readout = document.createElement('span')
    readout.className = 'value'
    const show = () => {
      readout.textContent = spec.kind === 'boolean' ? '' : input.value
    }
    show()

    input.addEventListener('input', show)
    input.addEventListener('change', async () => {
      const next = spec.kind === 'boolean' ? input.checked : Number(input.value)
      const res = await browser.runtime.sendMessage({
        method: 'updateSettings',
        values: { [path]: next },
      })
      // Echo back what was stored: the background may have clamped it.
      const stored = path.split('.').reduce((node, key) => node?.[key], res.settings)
      if (spec.kind === 'boolean') input.checked = stored
      else input.value = stored
      show()
      say('Saved.')
    })

    control.append(input, readout)

    const help = document.createElement('p')
    help.className = 'setting-help'
    help.textContent = spec.help

    row.append(label, control, help)
    host.append(row)
  }
}

document.getElementById('reset').addEventListener('click', async () => {
  if (!confirm('Put every setting back to its default?')) return
  await browser.runtime.sendMessage({ method: 'resetSettings' })
  await renderSettings()
  say('Settings reset.')
})

document.getElementById('export-settings').addEventListener('click', async () => {
  try {
    const doc = await browser.runtime.sendMessage({ method: 'backupSettings' })
    download(doc, `my-simple-tabs-workspace-settings-${stamp()}.json`)
    say('Saved your settings.')
  } catch (err) {
    say(String(err?.message ?? err), 'error')
  }
})

document.getElementById('import-settings').addEventListener('change', async event => {
  const file = event.target.files?.[0]
  if (!file) return
  try {
    const text = await file.text()
    const result = await browser.runtime.sendMessage({ method: 'restoreSettings', text })
    if (result?.error) throw new Error(result.error)
    await renderSettings()
    say('Settings restored.')
  } catch (err) {
    say(String(err?.message ?? err), 'error')
  } finally {
    event.target.value = ''
  }
})

// ---- workspaces -------------------------------------------------------------

function download(doc, filename) {
  const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)

  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()

  // Revoked late so the download has certainly started.
  setTimeout(() => URL.revokeObjectURL(url), 10000)
}

document.getElementById('export').addEventListener('click', async () => {
  try {
    const doc = await browser.runtime.sendMessage({ method: 'backup' })
    download(doc, `my-simple-tabs-workspace-${stamp()}.json`)
    say(`Saved ${doc.workspaces.length} workspaces.`)
  } catch (err) {
    say(String(err?.message ?? err), 'error')
  }
})

document.getElementById('import').addEventListener('change', async event => {
  const file = event.target.files?.[0]
  if (!file) return

  const mode = document.querySelector('input[name="mode"]:checked').value
  if (mode === 'replace') {
    const ok = confirm('Replace every current workspace with the ones in this file?')
    if (!ok) {
      event.target.value = ''
      return
    }
  }

  try {
    const text = await file.text()
    const result = await browser.runtime.sendMessage({ method: 'restore', text, mode })
    if (result?.error) throw new Error(result.error)
    say(
      result.mode === 'replace'
        ? `Replaced everything with ${result.imported} workspaces.`
        : `Added ${result.imported} workspaces.`
    )
    showContainerPrompt(result)
  } catch (err) {
    say(String(err?.message ?? err), 'error')
  } finally {
    event.target.value = ''
  }
})

renderSettings().catch(err => say(String(err?.message ?? err), 'error'))
renderPermission().catch(err => say(String(err?.message ?? err), 'error'))
