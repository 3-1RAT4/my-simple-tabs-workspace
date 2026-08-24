'use strict'

// One workspace per window, one window per workspace.
//
// While a workspace is open its tabs are simply the window's tabs - nothing is
// hidden or moved. A snapshot of those tabs is kept up to date so the
// workspace can be reopened after its window is gone.

const Workspaces = {
  // wsId -> windowId and back. Runtime only; window ids change every restart,
  // the durable binding is the 'wsId' session value on the window.
  byWs: new Map(),
  byWindow: new Map(),

  isOpen(wsId) {
    return Workspaces.byWs.has(wsId)
  },

  bind(windowId, wsId) {
    Workspaces.byWs.set(wsId, windowId)
    Workspaces.byWindow.set(windowId, wsId)
    return Store.setWindowWs(windowId, wsId)
  },

  unbind(windowId) {
    const wsId = Workspaces.byWindow.get(windowId)
    if (wsId !== undefined) Workspaces.byWs.delete(wsId)
    Workspaces.byWindow.delete(windowId)
  },

  // ---- snapshots -----------------------------------------------------------

  async snapshot(windowId) {
    const wsId = Workspaces.byWindow.get(windowId)
    if (wsId === undefined) return

    const ws = await Store.loadWs(wsId)
    if (!ws) return

    let tabs
    try {
      tabs = await browser.tabs.query({ windowId })
    } catch {
      return // window is gone; keep the last good snapshot
    }

    const { groups, keyById } = await Groups.snapshot(tabs)

    ws.tabs = tabs.map(tab => {
      const gid = Groups.idOf(tab)
      const entry = {
        url: tab.url,
        title: tab.title || tab.url,
        pinned: !!tab.pinned,
        active: !!tab.active,
        cookieStoreId: tab.cookieStoreId,
      }
      if (keyById.has(gid)) entry.groupKey = keyById.get(gid)
      return entry
    })
    ws.groups = groups
    ws.savedAt = Date.now()

    await Store.saveWs(ws)
  },

  // ---- lifecycle -----------------------------------------------------------

  // Every window must show a workspace. Restores the binding recorded in the
  // window's session data, or creates a workspace for it.
  async adoptWindow(windowId) {
    if (Workspaces.byWindow.has(windowId)) return Workspaces.byWindow.get(windowId)

    const recorded = await Store.getWindowWs(windowId)
    if (recorded) {
      const ws = await Store.loadWs(recorded)
      // Refuse to bind a workspace that another window already shows.
      if (ws && !Workspaces.isOpen(recorded)) {
        await Workspaces.bind(windowId, recorded)
        return recorded
      }
    }

    const index = await Store.loadIndex()
    const ws = {
      id: Util.uuid(),
      name: `Workspace ${index.order.filter(id => !Store.isSeparatorId(id)).length + 1}`,
      color: Palette.DEFAULT_COLOR,
      icon: Palette.DEFAULT_ICON,
      tabs: [],
      groups: [],
    }
    await Store.saveWs(ws)
    index.order.push(ws.id)
    await Store.saveIndex(index)

    await Workspaces.bind(windowId, ws.id)
    return ws.id
  },

  // Returns the list as it should be shown: workspaces and separators in the
  // order the user arranged them.
  async list(currentWindowId) {
    const index = await Store.loadIndex()
    const currentWsId = Workspaces.byWindow.get(currentWindowId)

    const out = []
    for (const id of index.order) {
      if (Store.isSeparatorId(id)) {
        const sep = index.separators[id] || {}
        out.push({
          type: 'separator',
          id,
          label: sep.label || '',
          align: sep.align || Palette.DEFAULT_ALIGN,
          color: sep.color || Palette.DEFAULT_COLOR,
        })
        continue
      }

      const ws = await Store.loadWs(id)
      if (!ws) continue

      const windowId = Workspaces.byWs.get(ws.id)
      const open = windowId !== undefined

      let tabCount = (ws.tabs || []).length
      if (open) {
        try {
          tabCount = (await browser.tabs.query({ windowId })).length
        } catch {
          /* keep the snapshot count */
        }
      }

      out.push({
        type: 'workspace',
        id: ws.id,
        name: ws.name,
        color: ws.color || Palette.DEFAULT_COLOR,
        icon: ws.icon || Palette.DEFAULT_ICON,
        open,
        current: ws.id === currentWsId,
        tabCount,
      })
    }

    return out
  },

  // ---- separators ----------------------------------------------------------

  // Takes { label, align, color }, or a bare label string.
  async addSeparator(props = {}) {
    const patch = typeof props === 'string' ? { label: props } : props
    const index = await Store.loadIndex()
    const id = `sep-${Util.uuid()}`
    index.order.push(id)
    index.separators[id] = Workspaces._cleanSeparator({}, patch)
    await Store.saveIndex(index)
    return id
  },

  // Accepts any subset of { label, align, color } and leaves the rest alone.
  async updateSeparator(sepId, props = {}) {
    const index = await Store.loadIndex()
    const current = index.separators[sepId]
    if (!current) return

    // A bare string keeps the older call style working.
    const patch = typeof props === 'string' ? { label: props } : props
    index.separators[sepId] = Workspaces._cleanSeparator(current, patch)
    await Store.saveIndex(index)
  },

  _cleanSeparator(current, patch) {
    const out = {
      label: current.label || '',
      align: current.align || Palette.DEFAULT_ALIGN,
      color: current.color || Palette.DEFAULT_COLOR,
    }
    if (patch.label !== undefined) out.label = String(patch.label ?? '').trim().slice(0, 40)
    if (Palette.isAlign(patch.align)) out.align = patch.align
    if (Palette.isColor(patch.color)) out.color = patch.color
    return out
  },

  async removeSeparator(sepId) {
    await Store.removeSeparator(sepId)
  },

  // Clicking a workspace: raise its window if it has one, otherwise give it a
  // new window built from its snapshot. Never two windows for one workspace.
  async activate(wsId) {
    const existing = Workspaces.byWs.get(wsId)
    if (existing !== undefined) {
      await browser.windows.update(existing, { focused: true })
      return
    }

    const ws = await Store.loadWs(wsId)
    if (!ws) throw new Error('No such workspace')

    // Prefer letting Firefox reopen the actual closed window. That consumes the
    // tab group it saved when the window closed, instead of leaving it orphaned
    // beside a new one, and brings back navigation history and scroll position.
    const settings = await Settings.load()
    const restoredId = settings.behavior.preferSessionRestore
      ? await Workspaces._restoreFromSession(ws)
      : null
    if (restoredId !== null) {
      await Workspaces.bind(restoredId, wsId)
      await Workspaces._ensureGroups(restoredId, ws)
      await Workspaces.snapshot(restoredId)
      return
    }

    // Blank tabs are kept: they come back as a plain new tab, so the count in
    // the popup matches what actually reopens.
    const saved = (ws.tabs || []).filter(t => Util.isRestorable(t.url))
    const first = saved[0]

    const win = await browser.windows.create(
      first && !Util.isBlankURL(first.url) ? { url: first.url } : {}
    )
    await Workspaces.bind(win.id, wsId)

    const created = []
    if (first) {
      const firstTab = win.tabs && win.tabs[0]
      if (firstTab) {
        created.push({ tab: firstTab, entry: first })
        if (first.pinned) await browser.tabs.update(firstTab.id, { pinned: true }).catch(() => {})
      }
    }

    for (let i = 1; i < saved.length; i++) {
      const entry = saved[i]
      const tab = await Workspaces._createTab(win.id, entry, i, settings)
      if (tab) created.push({ tab, entry })
    }

    await Groups.rebuild(
      win.id,
      created.map(c => ({ tab: c.tab, groupKey: c.entry.groupKey })),
      ws.groups
    )

    const wanted = created.find(c => c.entry.active)
    if (wanted) await browser.tabs.update(wanted.tab.id, { active: true }).catch(() => {})

    await Workspaces.snapshot(win.id)
  },

  // Finds the closed window belonging to this workspace and reopens it.
  // Returns the new window id, or null to fall back to rebuilding by hand.
  //
  // Only windows closed during this browser session are available, and Firefox
  // keeps a limited number (browser.sessionstore.max_closed_windows), so the
  // fallback is not optional.
  async _restoreFromSession(ws) {
    if (!browser.sessions?.getRecentlyClosed) return null

    const wanted = (ws.tabs || []).map(t => t.url).sort()
    if (!wanted.length) return null

    let closed = []
    try {
      closed = await browser.sessions.getRecentlyClosed({ maxResults: 25 })
    } catch {
      return null
    }

    for (const entry of closed) {
      const win = entry.window
      if (!win?.tabs || !win.sessionId) continue

      // Match on the exact set of urls: this workspace's window and no other.
      const got = win.tabs.map(t => t.url).sort()
      if (got.length !== wanted.length) continue
      if (got.some((url, i) => url !== wanted[i])) continue

      try {
        const session = await browser.sessions.restore(win.sessionId)
        const id = session?.window?.id
        if (id !== undefined) return id
      } catch (err) {
        Diagnostics.warn('session restore failed, rebuilding instead:', err)
      }
      return null
    }

    return null
  },

  // ASSUMPTION: a natively restored window brings its tab groups back with it.
  // Undocumented, so this checks rather than trusts: if the groups did not
  // return, they are rebuilt from the snapshot. Falsified by seeing ungrouped
  // tabs after reopening a workspace that had a group.
  async _ensureGroups(windowId, ws) {
    if (!browser.tabGroups || !ws.groups?.length) return

    const tabs = await browser.tabs.query({ windowId })
    if (tabs.some(t => Groups.idOf(t) !== -1)) return // groups came back

    const byUrl = new Map()
    for (const tab of tabs) if (!byUrl.has(tab.url)) byUrl.set(tab.url, tab)

    const created = []
    for (const entry of ws.tabs || []) {
      if (entry.groupKey === undefined) continue
      const tab = byUrl.get(entry.url)
      if (tab) created.push({ tab, groupKey: entry.groupKey })
    }

    if (created.length) await Groups.rebuild(windowId, created, ws.groups)
  },

  // Creating a tab can fail for reasons worth retrying past: a container that
  // no longer exists, or a url the browser refuses. Losing one tab must not
  // cost the rest of the workspace.
  async _createTab(windowId, entry, index, settings) {
    const base = { windowId, index, pinned: !!entry.pinned, active: false }
    if (!Util.isBlankURL(entry.url)) {
      base.url = entry.url
      if (!entry.pinned && settings?.behavior?.restoreUnloaded !== false) {
        base.discarded = true
        base.title = entry.title
      }
    }

    const withContainer = { ...base }
    if (entry.cookieStoreId && entry.cookieStoreId !== 'firefox-default') {
      withContainer.cookieStoreId = entry.cookieStoreId
    }

    try {
      return await browser.tabs.create(withContainer)
    } catch (err) {
      if (withContainer.cookieStoreId) {
        Diagnostics.warn('container unavailable, restoring in default:', err)
        try {
          return await browser.tabs.create(base)
        } catch (err2) {
          Diagnostics.warn('could not restore tab:', entry.url, err2)
          return null
        }
      }
      Diagnostics.warn('could not restore tab:', entry.url, err)
      return null
    }
  },

  async create() {
    const index = await Store.loadIndex()
    const ws = {
      id: Util.uuid(),
      name: `Workspace ${index.order.filter(id => !Store.isSeparatorId(id)).length + 1}`,
      color: Palette.DEFAULT_COLOR,
      icon: Palette.DEFAULT_ICON,
      tabs: [],
      groups: [],
    }
    await Store.saveWs(ws)
    index.order.push(ws.id)
    await Store.saveIndex(index)

    const win = await browser.windows.create({})
    await Workspaces.bind(win.id, ws.id)
    await Workspaces.snapshot(win.id)
    return ws.id
  },

  // Name, colour and icon in one place. Everything is validated here rather
  // than trusted from the popup.
  async update(wsId, props = {}) {
    const ws = await Store.loadWs(wsId)
    if (!ws) return

    if (props.name !== undefined) {
      const name = String(props.name).trim()
      if (name) ws.name = name.slice(0, 60)
    }

    if (props.color !== undefined && Palette.isColor(props.color)) {
      ws.color = props.color
    }

    if (props.icon !== undefined && Palette.isIcon(props.icon)) {
      ws.icon = props.icon
    }

    await Store.saveWs(ws)
  },

  async rename(wsId, name) {
    await Workspaces.update(wsId, { name })
  },

  async remove(wsId) {
    const index = await Store.loadIndex()
    const workspaceCount = index.order.filter(id => !Store.isSeparatorId(id)).length
    if (workspaceCount <= 1) throw new Error('Cannot delete the last workspace')

    const windowId = Workspaces.byWs.get(wsId)
    if (windowId !== undefined) {
      Workspaces.unbind(windowId)
      await browser.windows.remove(windowId).catch(() => {})
    }
    await Store.removeWs(wsId)
  },

  async reorder(order) {
    const index = await Store.loadIndex()
    const same = order.length === index.order.length && order.every(id => index.order.includes(id))
    if (!same) throw new Error('Reorder does not match the current workspaces')

    index.order = order
    await Store.saveIndex(index)
  },

  // ---- startup -------------------------------------------------------------

  async init() {
    const windows = await browser.windows.getAll({ windowTypes: ['normal'] })
    for (const win of windows) {
      await Workspaces.adoptWindow(win.id)
      await Workspaces.snapshot(win.id)
    }
  },
}
