'use strict'

// Storage layout
//
//   session (window)  wsId       the workspace this window is showing
//   storage.local     index      { order: [id], separators: { id: { label } } }
//                                order holds workspace ids and separator ids
//                                together, so one array drives the whole list
//                                and reordering needs no special cases.
//   storage.local     ws@<wsId>  { id, name, tabs, groups, savedAt }
//
// One workspace is shown by at most one window, and every window shows exactly
// one workspace. The binding lives in a window session value, so a window that
// Firefox restores comes back attached to the same workspace.
//
// `tabs` is a snapshot kept up to date while the workspace is open. It is only
// read when reopening a workspace whose window is gone.

const Store = {
  async loadIndex() {
    const res = await browser.storage.local.get('index')
    const index = res.index || {}
    if (!Array.isArray(index.order)) index.order = []
    if (!index.separators || typeof index.separators !== 'object') index.separators = {}
    return index
  },

  // Separator ids are recognisable on sight, which keeps every loop that walks
  // `order` honest about what it is looking at.
  isSeparatorId(id) {
    return typeof id === 'string' && id.startsWith('sep-')
  },

  async saveIndex(index) {
    await browser.storage.local.set({ index })
  },

  async loadWs(wsId) {
    const key = `ws@${wsId}`
    const res = await browser.storage.local.get(key)
    return res[key] || null
  },

  async saveWs(ws) {
    await browser.storage.local.set({ [`ws@${ws.id}`]: ws })
  },

  async removeWs(wsId) {
    await browser.storage.local.remove(`ws@${wsId}`)
    const index = await Store.loadIndex()
    index.order = index.order.filter(id => id !== wsId)
    await Store.saveIndex(index)
  },

  async removeSeparator(sepId) {
    const index = await Store.loadIndex()
    index.order = index.order.filter(id => id !== sepId)
    delete index.separators[sepId]
    await Store.saveIndex(index)
  },

  async loadAll() {
    const index = await Store.loadIndex()
    const out = []
    for (const id of index.order) {
      const ws = await Store.loadWs(id)
      if (ws) out.push(ws)
    }
    return out
  },

  async getWindowWs(windowId) {
    return await browser.sessions.getWindowValue(windowId, 'wsId').catch(() => undefined)
  },

  async setWindowWs(windowId, wsId) {
    await browser.sessions.setWindowValue(windowId, 'wsId', wsId)
  },
}
