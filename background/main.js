'use strict'

const MENU_ROOT = 'send-tab-to-workspace'

async function currentWindowId() {
  const win = await browser.windows.getCurrent()
  return win.id
}

// ---- messages from the popup ------------------------------------------------

browser.runtime.onMessage.addListener(async msg => {
  const windowId = msg.windowId ?? (await currentWindowId())

  switch (msg.method) {
    case 'list':
      return await Util.serial(async () => {
        await Workspaces.adoptWindow(windowId)
        return await Workspaces.list(windowId)
      })

    case 'activate':
      await Util.serial(() => Workspaces.activate(msg.workspaceId))
      return null

    case 'create':
      await Util.serial(() => Workspaces.create())
      return null

    case 'update':
      await Util.serial(() => Workspaces.update(msg.workspaceId, msg.props))
      refreshMenu()
      return await Util.serial(() => Workspaces.list(windowId))

    case 'rename':
      await Util.serial(() => Workspaces.rename(msg.workspaceId, msg.name))
      refreshMenu()
      return await Util.serial(() => Workspaces.list(windowId))

    case 'delete':
      await Util.serial(() => Workspaces.remove(msg.workspaceId))
      refreshMenu()
      return await Util.serial(() => Workspaces.list(windowId))

    case 'reorder':
      await Util.serial(() => Workspaces.reorder(msg.order))
      refreshMenu()
      return await Util.serial(() => Workspaces.list(windowId))

    case 'addSeparator':
      await Util.serial(() => Workspaces.addSeparator(msg.label))
      return await Util.serial(() => Workspaces.list(windowId))

    case 'updateSeparator':
      await Util.serial(() => Workspaces.updateSeparator(msg.separatorId, msg.label))
      return await Util.serial(() => Workspaces.list(windowId))

    case 'deleteSeparator':
      await Util.serial(() => Workspaces.removeSeparator(msg.separatorId))
      return await Util.serial(() => Workspaces.list(windowId))

    case 'getSettings':
      return { settings: await Settings.load(), schema: Settings.SCHEMA }

    case 'updateSettings':
      return { settings: await Settings.update(msg.values) }

    case 'resetSettings':
      return { settings: await Settings.reset() }

    case 'backupSettings':
      return await Backup.exportSettings()

    case 'restoreSettings':
      try {
        return await Backup.importSettings(msg.text)
      } catch (err) {
        Diagnostics.warn('settings restore refused:', err)
        return { error: String(err?.message ?? err) }
      }

    case 'backup':
      return await Util.serial(() => Backup.exportAll())

    case 'restore':
      // The message carries a file the user chose, so a bad one is an expected
      // outcome, not a crash: report it as text the page can show.
      try {
        return await Util.serial(() => Backup.importAll(msg.text, msg.mode))
      } catch (err) {
        Diagnostics.warn('restore refused:', err)
        return { error: String(err?.message ?? err) }
      }

    case 'diagnostics':
      return await Diagnostics.dump()

    default:
      throw new Error(`Unknown method: ${msg.method}`)
  }
})

// ---- window lifecycle -------------------------------------------------------

browser.windows.onCreated.addListener(win => {
  if (win.type !== 'normal') return
  // A window we opened for a workspace is already bound by the time this runs,
  // because opening holds the serial queue; adoptWindow then does nothing.
  Util.serial(async () => {
    await Workspaces.adoptWindow(win.id)
    await Workspaces.snapshot(win.id)
  }).catch(err => Diagnostics.warn('onCreated window:', err))
  refreshMenu()
})

browser.windows.onRemoved.addListener(windowId => {
  // The snapshot was kept current while the window lived, so there is nothing
  // to save here - just release the workspace so it can be reopened.
  Util.serial(async () => Workspaces.unbind(windowId)).catch(() => {})
  refreshMenu()
})

// ---- keeping the snapshot current -------------------------------------------

const snapshotters = new Map()
function scheduleSnapshot(windowId) {
  if (windowId === undefined || windowId === browser.windows.WINDOW_ID_NONE) return
  let fn = snapshotters.get(windowId)
  if (!fn) {
    fn = Util.debounce(() => {
      Util.serial(() => Workspaces.snapshot(windowId)).catch(err => {
        Diagnostics.warn('snapshot:', err)
      })
    }, 700)
    snapshotters.set(windowId, fn)
  }
  fn()
}

browser.tabs.onCreated.addListener(tab => scheduleSnapshot(tab.windowId))
browser.tabs.onRemoved.addListener((id, info) => {
  if (!info.isWindowClosing) scheduleSnapshot(info.windowId)
})
browser.tabs.onMoved.addListener((id, info) => scheduleSnapshot(info.windowId))
browser.tabs.onAttached.addListener((id, info) => scheduleSnapshot(info.newWindowId))
browser.tabs.onDetached.addListener((id, info) => scheduleSnapshot(info.oldWindowId))
browser.tabs.onUpdated.addListener(
  (id, change, tab) => scheduleSnapshot(tab.windowId),
  { properties: ['url', 'title', 'pinned'] }
)
if (browser.tabGroups) {
  for (const event of ['onCreated', 'onUpdated', 'onRemoved', 'onMoved']) {
    browser.tabGroups[event]?.addListener(group => scheduleSnapshot(group.windowId))
  }
}

// ---- "Send tab to workspace" context menu -----------------------------------

async function buildMenu() {
  await browser.menus.removeAll()

  browser.menus.create({
    id: MENU_ROOT,
    title: 'Move tab to workspace',
    contexts: ['tab'],
  })

  const windowId = await currentWindowId()
  const workspaces = await Util.serial(() => Workspaces.list(windowId))

  for (const ws of workspaces) {
    if (ws.type === 'separator') continue
    browser.menus.create({
      id: `ws:${ws.id}`,
      parentId: MENU_ROOT,
      title: `${ws.icon ? ws.icon + ' ' : ''}${ws.name} (${ws.tabCount}${ws.open ? '' : ', closed'})`,
      enabled: !ws.current,
    })
  }
}

const refreshMenu = Util.debounce(() => {
  buildMenu().catch(err => Diagnostics.warn('menu:', err))
}, 400)

browser.menus.onClicked.addListener(async (info, tab) => {
  const id = String(info.menuItemId)
  if (!id.startsWith('ws:')) return
  const wsId = id.slice(3)

  try {
    await Util.serial(async () => {
      // The destination needs a window before a tab can be moved into it.
      if (!Workspaces.isOpen(wsId)) await Workspaces.activate(wsId)
      const windowId = Workspaces.byWs.get(wsId)
      if (windowId === undefined) return
      await browser.tabs.move(tab.id, { windowId, index: -1 })
      await browser.windows.update(windowId, { focused: true })
    })
  } catch (err) {
    Diagnostics.warn('menu click:', err)
  }
  refreshMenu()
})

browser.windows.onFocusChanged.addListener(windowId => {
  if (windowId !== browser.windows.WINDOW_ID_NONE) refreshMenu()
})

// ---- startup ----------------------------------------------------------------

Util.serial(() => Workspaces.init())
  .then(() => buildMenu())
  .catch(err => Diagnostics.err('init failed:', err))
