'use strict'

// Everything needed to explain a misbehaviour, in one JSON blob, without
// devtools. The popup exposes this as a "diagnostics" link.
//
// This dump exists to be pasted into a chat or an issue, so it must not carry
// anything a person would not knowingly publish. Page identities are the risk:
// a title like "Q3 layoff planning" says more than the url it came from, and
// the workspace snapshots hold every tab of every workspace, open or closed -
// closer to a history export than a status report.
//
// So urls are cut to their origin and titles are dropped. Everything that has
// ever actually diagnosed a bug here - bindings, group ids, counts, ordering,
// the log - is structure, and structure is kept in full. `full: true` restores
// the detail for the rare bug that is about a specific page.

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

  // Reduces a url to scheme and host. Anything that identifies the page - path,
  // query, fragment - is what carries meaning to a reader, so it goes.
  redactUrl(url, full) {
    if (full) return url
    if (!url) return ''
    try {
      const parsed = new URL(url)
      if (parsed.protocol === 'about:' || parsed.protocol === 'moz-extension:') {
        return parsed.protocol + parsed.pathname.split('/')[0]
      }
      return `${parsed.protocol}//${parsed.host}/…`
    } catch {
      return '(unparseable url)'
    }
  },

  redactTabs(tabs, full) {
    return (tabs || []).map(tab => {
      const out = { ...tab, url: Diagnostics.redactUrl(tab.url, full) }
      if (!full) delete out.title
      return out
    })
  },

  async dump({ full = false } = {}) {
    const out = {
      redacted: !full,
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
      const storage = await browser.storage.local.get()
      // Workspace records carry the tab snapshots, which is where the page
      // identities live.
      for (const [key, value] of Object.entries(storage)) {
        if (key.startsWith('ws@') && value?.tabs) {
          value.tabs = Diagnostics.redactTabs(value.tabs, full)
        }
      }
      out.storage = storage
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
            url: Diagnostics.redactUrl(t.url, full),
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
