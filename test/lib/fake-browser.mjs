// A fake WebExtension `browser` API for testing extension background code
// without a browser.
//
// The point is not to be complete. The point is to model the ways Firefox says
// no, because that is where the bugs are. Every rule below exists because a
// real bug got through without it:
//
//   - tabs.create rejects privileged urls          -> tabs silently vanished on restore
//   - cookieStoreId needs the "cookies" permission -> container tabs were dropped
//   - a closed window's group becomes "saved"      -> tab groups were duplicated
//
// Add a rule here whenever the browser surprises us.

import vm from 'node:vm'
import { readFileSync } from 'node:fs'

export const NO_GROUP = -1

export function createFakeBrowser(options = {}) {
  const {
    permissions = ['tabs', 'sessions', 'storage', 'menus'],
    privilegedSchemes = ['about:', 'chrome:', 'moz-extension:'],
  } = options

  const state = {
    local: {},
    winValues: new Map(),
    tabValues: new Map(),
    windows: new Map(), // id -> { id, type, focused }
    tabs: new Map(), // id -> tab
    groups: new Map(), // id -> { id, windowId, saved, title, color, collapsed }
    menus: new Map(),
    recentlyClosed: [], // newest first, like sessions.getRecentlyClosed()
    nextSessionId: 1,
    nextTabId: 100,
    nextWindowId: 10,
    nextGroupId: 1,
    log: [],
  }

  const has = perm => permissions.includes(perm)
  const isPrivileged = url => {
    if (!url) return false
    try {
      return privilegedSchemes.includes(new URL(url).protocol)
    } catch {
      return false
    }
  }

  function addTab(windowId, props = {}, index) {
    const tab = {
      id: state.nextTabId++,
      windowId,
      index: index ?? tabsIn(windowId).length,
      url: props.url ?? 'about:newtab',
      title: props.title ?? 'New Tab',
      pinned: !!props.pinned,
      active: !!props.active,
      hidden: !!props.hidden,
      discarded: !!props.discarded,
      cookieStoreId: props.cookieStoreId ?? 'firefox-default',
      groupId: props.groupId ?? NO_GROUP,
    }
    state.tabs.set(tab.id, tab)
    return tab
  }

  const tabsIn = windowId =>
    [...state.tabs.values()].filter(t => t.windowId === windowId).sort((a, b) => a.index - b.index)

  const browser = {
    runtime: {
      getManifest: () => ({
        name: options.name ?? 'My Simple Tabs Workspace',
        version: options.version ?? '0.0.0-test',
        permissions,
      }),
      onMessage: listener(),
      onStartup: listener(),
      onInstalled: listener(),
      openOptionsPage: async () => {},
      lastError: null,
    },

    storage: {
      local: {
        async get(keys) {
          if (keys === undefined || keys === null) return structuredClone(state.local)
          const list = Array.isArray(keys) ? keys : [keys]
          const out = {}
          for (const key of list) if (key in state.local) out[key] = structuredClone(state.local[key])
          return out
        },
        async set(obj) {
          Object.assign(state.local, structuredClone(obj))
        },
        async remove(keys) {
          for (const key of Array.isArray(keys) ? keys : [keys]) delete state.local[key]
        },
      },
    },

    sessions: {
      async getWindowValue(id, key) {
        return state.winValues.get(`${id}:${key}`)
      },
      async setWindowValue(id, key, value) {
        state.winValues.set(`${id}:${key}`, structuredClone(value))
      },
      async getTabValue(id, key) {
        return state.tabValues.get(`${id}:${key}`)
      },
      async setTabValue(id, key, value) {
        state.tabValues.set(`${id}:${key}`, structuredClone(value))
      },
      async removeTabValue(id, key) {
        state.tabValues.delete(`${id}:${key}`)
      },

      async getRecentlyClosed({ maxResults = 25 } = {}) {
        return state.recentlyClosed.slice(0, maxResults).map(e => structuredClone({ window: e.window }))
      },

      // Restores the window, its tabs, and the groups it took down with it.
      async restore(sessionId) {
        const idx = state.recentlyClosed.findIndex(e => e.window?.sessionId === sessionId)
        if (idx === -1) throw new Error(`No session with id: ${sessionId}`)
        const entry = state.recentlyClosed.splice(idx, 1)[0]

        const newId = state.nextWindowId++
        state.windows.set(newId, { id: newId, type: 'normal', focused: true })

        for (const gid of entry._savedGroups) {
          const group = state.groups.get(gid)
          if (group) {
            group.saved = false
            group.windowId = newId
          }
        }

        const tabs = entry.window.tabs.map((t, i) =>
          addTab(newId, { ...t, active: i === 0 }, i)
        )

        // Extension window values survive the round trip.
        for (const [name, value] of Object.entries(entry._values)) {
          state.winValues.set(`${newId}:${name}`, value)
        }

        return { window: { id: newId, sessionId, tabs } }
      },
    },

    windows: {
      WINDOW_ID_NONE: -1,
      WINDOW_ID_CURRENT: -2,

      async create(conf = {}) {
        const id = state.nextWindowId++
        state.windows.set(id, { id, type: conf.type ?? 'normal', focused: true })

        const urls = conf.url === undefined ? [undefined] : [].concat(conf.url)
        const created = urls.map((url, i) => {
          if (url !== undefined && isPrivileged(url)) {
            throw new Error(`Illegal URL: ${url}`)
          }
          return addTab(id, { url, active: i === 0 }, i)
        })

        return { id, type: 'normal', tabs: created }
      },

      async get(id) {
        const win = state.windows.get(id)
        if (!win) throw new Error(`No window with id: ${id}`)
        return win
      },

      async getCurrent() {
        return [...state.windows.values()][0] ?? { id: -1, type: 'normal' }
      },

      async getAll({ windowTypes } = {}) {
        const all = [...state.windows.values()]
        return windowTypes ? all.filter(w => windowTypes.includes(w.type)) : all
      },

      async update(id, props) {
        const win = state.windows.get(id)
        if (!win) throw new Error(`No window with id: ${id}`)
        Object.assign(win, props)
        return win
      },

      onCreated: listener(),
      onRemoved: listener(),
      onFocusChanged: listener(),

      async remove(id) {
        const closedTabs = tabsIn(id).map(t => ({ ...t }))
        state.windows.delete(id)
        for (const [tid, tab] of state.tabs) if (tab.windowId === id) state.tabs.delete(tid)

        // Firefox keeps a group whose window closed as a saved group: no longer
        // reachable via tabGroups.get(), and not revivable by id. It comes back
        // only when that window itself is restored.
        const savedGroups = []
        for (const group of state.groups.values()) {
          if (group.windowId === id) {
            group.saved = true
            group.windowId = undefined
            savedGroups.push(group.id)
          }
        }

        // The window becomes a restorable session, carrying its extension
        // window values with it.
        const values = {}
        for (const [key, value] of state.winValues) {
          const [winId, name] = key.split(':')
          if (Number(winId) === id) values[name] = value
        }

        state.recentlyClosed.unshift({
          window: {
            sessionId: `s${state.nextSessionId++}`,
            id,
            tabs: closedTabs,
          },
          _savedGroups: savedGroups,
          _values: values,
        })
      },
    },

    tabs: {
      async query(info = {}) {
        let list = [...state.tabs.values()]
        if (info.windowId !== undefined) list = list.filter(t => t.windowId === info.windowId)
        if (info.pinned !== undefined) list = list.filter(t => t.pinned === info.pinned)
        if (info.hidden !== undefined) list = list.filter(t => t.hidden === info.hidden)
        if (info.active !== undefined) list = list.filter(t => t.active === info.active)
        return list.sort((a, b) => a.index - b.index)
      },

      async get(id) {
        const tab = state.tabs.get(id)
        if (!tab) throw new Error(`No tab with id: ${id}`)
        return tab
      },

      async create(props = {}) {
        if (props.url !== undefined && isPrivileged(props.url)) {
          throw new Error(`Illegal URL: ${props.url}`)
        }
        if (
          props.cookieStoreId &&
          props.cookieStoreId !== 'firefox-default' &&
          !has('cookies')
        ) {
          throw new Error('Extension does not have permission to use cookieStoreId')
        }
        if (props.discarded && props.active) {
          throw new Error('Cannot create a discarded active tab')
        }
        if (props.title !== undefined && !props.discarded) {
          throw new Error('Title may only be set for discarded tabs')
        }
        return addTab(props.windowId, props, props.index)
      },

      async update(id, props) {
        const tab = state.tabs.get(id)
        if (!tab) throw new Error(`No tab with id: ${id}`)
        if (props.active) {
          for (const other of tabsIn(tab.windowId)) other.active = false
          if (tab.hidden) tab.hidden = false
        }
        Object.assign(tab, props)
        return tab
      },

      async move(ids, { windowId, index }) {
        for (const id of [].concat(ids)) {
          const tab = state.tabs.get(id)
          if (!tab) continue
          if (windowId !== undefined) tab.windowId = windowId
          tab.index = index === -1 ? tabsIn(tab.windowId).length : index
        }
      },

      async remove(ids) {
        for (const id of [].concat(ids)) state.tabs.delete(id)
      },

      async hide(ids) {
        if (!has('tabHide')) throw new Error('Missing tabHide permission')
        const hidden = []
        for (const id of [].concat(ids)) {
          const tab = state.tabs.get(id)
          if (!tab || tab.active || tab.pinned) continue
          tab.hidden = true
          hidden.push(id)
        }
        return hidden
      },

      async show(ids) {
        if (!has('tabHide')) throw new Error('Missing tabHide permission')
        for (const id of [].concat(ids)) {
          const tab = state.tabs.get(id)
          if (tab) tab.hidden = false
        }
      },

      async group({ tabIds, groupId, createProperties }) {
        const ids = [].concat(tabIds)
        if (!ids.length) throw new Error('No tabs to group')

        let gid = groupId
        if (gid !== undefined) {
          const group = state.groups.get(gid)
          if (!group) throw new Error(`No group with id: ${gid}`)
          // A saved group cannot be revived by id. MDN: "when a tab group is
          // restored, its groupId may differ from its original value", and
          // tabGroups offers no way to create or remove groups. Verified
          // against real Firefox: reopening kept making new groups.
          if (group.saved) throw new Error(`No group with id: ${gid}`)
          group.windowId = state.tabs.get(ids[0]).windowId
        } else {
          gid = state.nextGroupId++
          state.groups.set(gid, {
            id: gid,
            windowId: createProperties?.windowId ?? state.tabs.get(ids[0]).windowId,
            saved: false,
          })
        }

        for (const id of ids) {
          const tab = state.tabs.get(id)
          if (tab) tab.groupId = gid
        }
        return gid
      },

      async ungroup(tabIds) {
        const touched = new Set()
        for (const id of [].concat(tabIds)) {
          const tab = state.tabs.get(id)
          if (!tab) continue
          if (tab.groupId !== NO_GROUP) touched.add(tab.groupId)
          tab.groupId = NO_GROUP
        }
        // MDN, tabs.ungroup: "If any groups become empty, they are deleted."
        for (const gid of touched) {
          const stillUsed = [...state.tabs.values()].some(t => t.groupId === gid)
          if (!stillUsed) state.groups.delete(gid)
        }
      },

      onCreated: listener(),
      onRemoved: listener(),
      onUpdated: listener(),
      onMoved: listener(),
      onAttached: listener(),
      onDetached: listener(),
    },

    tabGroups: {
      // A saved group is invisible here, exactly like a closed one in Firefox.
      async get(id) {
        const group = state.groups.get(id)
        if (!group || group.saved) throw new Error(`No group with id: ${id}`)
        return group
      },
      async query({ windowId } = {}) {
        return [...state.groups.values()].filter(
          g => !g.saved && (windowId === undefined || g.windowId === windowId)
        )
      },
      async update(id, props) {
        const group = state.groups.get(id)
        if (!group) throw new Error(`No group with id: ${id}`)
        Object.assign(group, props)
        return group
      },
      onCreated: listener(),
      onUpdated: listener(),
      onRemoved: listener(),
      onMoved: listener(),
    },

    menus: {
      async removeAll() {
        state.menus.clear()
      },
      create(props) {
        state.menus.set(props.id ?? `auto-${state.menus.size}`, props)
        return props.id
      },
      onClicked: listener(),
    },
  }

  if (!has('tabGroups')) delete browser.tabGroups
  if (!has('cookies')) {
    // still present, just refuses container ids - handled in tabs.create
  }

  return { browser, state, addTab, tabsIn }
}

function listener() {
  const fns = []
  return {
    addListener: fn => fns.push(fn),
    removeListener: fn => fns.splice(fns.indexOf(fn), 1),
    hasListener: fn => fns.includes(fn),
    emit: (...args) => fns.forEach(fn => fn(...args)),
  }
}

// Loads an extension's background scripts straight from its manifest, so a
// test can never drift out of step with what the add-on actually loads. Three
// separate breakages came from hand-maintained copies of this list.
export function loadExtension(root, browser, extras = {}) {
  const manifest = JSON.parse(readFileSync(`${root}/manifest.json`, 'utf8'))
  const scripts = manifest.background?.scripts ?? []
  return loadBackground(root, scripts, browser, extras)
}

// Loads background scripts into one VM context, the way a background page runs
// them: plain scripts sharing globals, in manifest order.
//
// Top level `const` does not become a property of the context object, so the
// exported globals have to be read back with an expression.
export function loadBackground(dir, files, browser, extras = {}) {
  const ctx = vm.createContext({
    browser,
    console,
    crypto,
    URL, // its absence once produced a convincing but entirely fake bug
    setTimeout,
    clearTimeout,
    structuredClone,
    ...extras,
  })

  for (const file of files) {
    vm.runInContext(readFileSync(`${dir}/${file}`, 'utf8'), ctx, { filename: file })
  }

  return {
    ctx,
    globals(names) {
      return vm.runInContext(`({ ${names.join(', ')} })`, ctx)
    },
  }
}
