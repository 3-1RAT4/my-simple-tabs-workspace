'use strict'

// Native Firefox tab groups, captured into a workspace snapshot and rebuilt
// when the workspace is reopened. Best effort throughout: if the API is
// missing or a call fails, tabs come back ungrouped rather than not at all.

const NO_GROUP = -1

const Groups = {
  get available() {
    return typeof browser.tabs.group === 'function' && !!browser.tabGroups
  },

  idOf(tab) {
    const id = tab.groupId
    return id === undefined || id === null || id === NO_GROUP ? NO_GROUP : id
  },

  // Reads the groups used by these tabs. Returns the group list plus a
  // groupId -> key map, where the key is a snapshot-local index that stays
  // meaningful after the real group ids are gone.
  async snapshot(tabs) {
    const groups = []
    const keyById = new Map()
    if (!Groups.available) return { groups, keyById }

    for (const tab of tabs) {
      const gid = Groups.idOf(tab)
      if (gid === NO_GROUP || keyById.has(gid)) continue

      let info = {}
      try {
        const group = await browser.tabGroups.get(gid)
        info = { title: group.title, color: group.color, collapsed: group.collapsed }
      } catch {
        info = {}
      }

      keyById.set(gid, groups.length)
      // The real group id is kept so a reopened workspace can rejoin the group
      // Firefox saved when the window closed, instead of making a new one.
      groups.push({ gid, ...info })
    }

    return { groups, keyById }
  },

  // Rebuilds the snapshot's groups over freshly created tabs.
  // `created` is an array of { tab, groupKey }.
  async rebuild(windowId, created, groups) {
    if (!Groups.available || !groups || !groups.length) return

    // Collapse snapshot groups that are really the same group. Once a window
    // ends up with two identically named groups, every save/restore cycle would
    // otherwise carry both forward and add more.
    const clusters = new Map()
    for (const { tab, groupKey } of created) {
      if (groupKey === undefined || groupKey === null) continue
      const identity = Groups.identityOf(groups[groupKey])
      if (!clusters.has(identity)) clusters.set(identity, { key: groupKey, tabIds: [] })
      clusters.get(identity).tabIds.push(tab.id)
    }

    for (const { key, tabIds } of clusters.values()) {
      if (!tabIds.length) continue
      const info = groups[key] || {}
      try {
        const gid = await Groups._joinOrCreate(windowId, tabIds, info)
        if (gid === NO_GROUP) continue

        const props = {}
        if (info.title !== undefined) props.title = info.title
        if (info.color !== undefined) props.color = info.color
        if (info.collapsed !== undefined) props.collapsed = info.collapsed
        if (Object.keys(props).length) {
          await browser.tabGroups.update(gid, props).catch(() => {})
        }
      } catch (err) {
        Diagnostics.warn('could not rebuild tab group:', err)
      }
    }
  },

  // What makes two group records "the same group" to us. Ids are useless for
  // this: MDN states a restored group's id may differ from its original.
  identityOf(info) {
    if (!info) return 'ungrouped'
    return `${info.title ?? ''}\u0000${info.color ?? ''}`
  },

  // Joins an existing group where possible instead of adding another one.
  //
  // A group whose window closed becomes a saved group. Firefox gives no way to
  // reach it: tabGroups has no remove(), query() does not list it, and grouping
  // by its old id fails. So the only duplicates we can prevent are the ones
  // inside a live window - which is what stops the count multiplying.
  async _joinOrCreate(windowId, tabIds, info) {
    const wanted = info.gid

    if (wanted !== undefined && wanted !== NO_GROUP) {
      try {
        const live = await browser.tabGroups.get(wanted)
        if (live && live.windowId === windowId) {
          await browser.tabs.group({ tabIds, groupId: wanted })
          return wanted
        }
      } catch {
        // gone or saved; fall through
      }
    }

    // Any live group in this window that is the same group by title and colour.
    const identity = Groups.identityOf(info)
    if (identity !== 'ungrouped' && info.title) {
      try {
        const live = await browser.tabGroups.query({ windowId })
        const match = live.find(g => Groups.identityOf(g) === identity)
        if (match) {
          await browser.tabs.group({ tabIds, groupId: match.id })
          return match.id
        }
      } catch {
        // query unavailable; fall through
      }
    }

    await browser.tabs.group({ tabIds, createProperties: { windowId } })
    const probe = await browser.tabs.get(tabIds[0])
    return Groups.idOf(probe)
  },
}
