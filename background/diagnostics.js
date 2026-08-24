'use strict'

// Everything needed to explain a misbehaviour, in one JSON blob, without
// devtools. The popup exposes this as a "diagnostics" link.

const Diagnostics = {
  MAX: 200,
  entries: [],

  log(level, msg, ...args) {
    Diagnostics.entries.push({
      at: new Date().toISOString(),
      level,
      msg,
      args: args.map(a => {
        try {
          return a instanceof Error ? String(a) : JSON.parse(JSON.stringify(a))
        } catch {
          return String(a)
        }
      }),
    })
    if (Diagnostics.entries.length > Diagnostics.MAX) Diagnostics.entries.shift()
    console[level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log'](
      `[workspaces] ${msg}`,
      ...args
    )
  },

  info: (msg, ...a) => Diagnostics.log('info', msg, ...a),
  warn: (msg, ...a) => Diagnostics.log('warn', msg, ...a),
  err: (msg, ...a) => Diagnostics.log('error', msg, ...a),

  async dump() {
    const out = {
      version: browser.runtime.getManifest().version,
      at: new Date().toISOString(),
      permissions: browser.runtime.getManifest().permissions,
      tabGroupsApi: !!browser.tabGroups,
      bindings: {
        byWs: [...Workspaces.byWs.entries()],
        byWindow: [...Workspaces.byWindow.entries()],
      },
      storage: {},
      windows: [],
      liveGroups: [],
      log: Diagnostics.entries,
    }

    try {
      out.storage = await browser.storage.local.get()
    } catch (err) {
      out.storage = String(err)
    }

    try {
      for (const win of await browser.windows.getAll({ windowTypes: ['normal'] })) {
        const tabs = await browser.tabs.query({ windowId: win.id })
        out.windows.push({
          id: win.id,
          wsId: await browser.sessions.getWindowValue(win.id, 'wsId').catch(() => undefined),
          tabs: tabs.map(t => ({
            id: t.id,
            index: t.index,
            groupId: t.groupId,
            pinned: t.pinned,
            ctr: t.cookieStoreId,
            url: (t.url || '').slice(0, 80),
          })),
        })

        // Only live groups are visible here. A group whose window closed is
        // saved by Firefox and cannot be listed, so if the browser shows more
        // groups than this, the extras are Firefox's saved groups.
        if (browser.tabGroups) {
          const groups = await browser.tabGroups.query({ windowId: win.id }).catch(() => [])
          out.liveGroups.push(...groups.map(g => ({ ...g })))
        }
      }
    } catch (err) {
      out.windowsError = String(err)
    }

    return out
  },
}
