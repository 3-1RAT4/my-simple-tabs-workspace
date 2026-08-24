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

document.getElementById('export').addEventListener('click', async () => {
  try {
    const doc = await browser.runtime.sendMessage({ method: 'backup' })
    const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)

    const link = document.createElement('a')
    link.href = url
    link.download = `simple-tab-workspaces-${stamp()}.json`
    link.click()

    // Revoked late so the download has certainly started.
    setTimeout(() => URL.revokeObjectURL(url), 10000)
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
  } catch (err) {
    say(String(err?.message ?? err), 'error')
  } finally {
    event.target.value = ''
  }
})
