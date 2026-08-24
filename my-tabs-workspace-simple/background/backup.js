'use strict'

// Backup format
// =============
//
// {
//   "format": "simple-tab-workspaces",
//   "formatVersion": 1,
//   "app":  { "name": "...", "version": "1.0.7" },
//   "exportedAt": "2026-08-24T12:00:00.000Z",
//   "workspaces": [
//     { "id", "name", "color", "icon", "tabs": [...], "groups": [...] }
//   ]
// }
//
// Rules that keep this readable by later versions, and by this version after
// later ones have touched it:
//
//   1. `formatVersion` rises only for a BREAKING change. Adding a field is not
//      breaking, so a v1 reader must tolerate fields it has never heard of.
//   2. Unknown fields are PRESERVED, not dropped. Importing a file written by a
//      newer version and exporting it again must not quietly delete whatever
//      that version added. Everything outside the known set is carried through.
//   3. An importer refuses a file whose formatVersion it does not know, rather
//      than guessing. Refusing is recoverable; a bad guess corrupts data.
//   4. Migrations are a chain of small steps, MIGRATIONS[n] taking version n to
//      n+1. Old files stay importable forever by running the chain.
//
// Runtime-only values are deliberately excluded: window bindings, and the
// numeric group ids, which mean nothing in another profile or after a restart.

const Backup = {
  FORMAT: 'simple-tab-workspaces',
  VERSION: 1,

  // Fields this version understands. Anything else on a workspace is unknown
  // and rides along untouched.
  KNOWN_WORKSPACE_FIELDS: ['id', 'name', 'color', 'icon', 'tabs', 'groups', 'savedAt'],

  // MIGRATIONS[n] upgrades a v(n) document to v(n+1). Empty until the format
  // has to break; the machinery is here so the first break is cheap.
  MIGRATIONS: {},

  async exportAll() {
    const all = await Store.loadAll()
    const index = await Store.loadIndex()

    return {
      format: Backup.FORMAT,
      formatVersion: Backup.VERSION,
      app: {
        name: browser.runtime.getManifest().name,
        version: browser.runtime.getManifest().version,
      },
      exportedAt: new Date().toISOString(),
      workspaces: all.map(Backup._exportWorkspace),
      // Additive, so formatVersion stays at 1: a reader that predates
      // separators ignores these two and still restores every workspace.
      order: index.order,
      separators: Object.entries(index.separators).map(([id, sep]) => ({
        id,
        label: sep.label || '',
      })),
    }
  },

  _exportWorkspace(ws) {
    const out = {
      id: ws.id,
      name: ws.name,
      color: ws.color || Palette.DEFAULT_COLOR,
      icon: ws.icon || Palette.DEFAULT_ICON,
      tabs: (ws.tabs || []).map(tab => ({ ...tab })),
      // Group ids are runtime values; the title, colour and collapsed state are
      // what actually mean something in a backup.
      groups: (ws.groups || []).map(({ gid, ...rest }) => ({ ...rest })),
    }
    if (ws.savedAt) out.savedAt = ws.savedAt

    // Rule 2: carry anything this version does not recognise.
    for (const [key, value] of Object.entries(ws)) {
      if (!Backup.KNOWN_WORKSPACE_FIELDS.includes(key) && key !== 'winUuid') {
        out[key] = value
      }
    }

    return out
  },

  // Throws with a message meant for a person, not a stack trace.
  parse(text) {
    let doc
    try {
      doc = JSON.parse(text)
    } catch {
      throw new Error('That file is not JSON.')
    }

    // "Not a backup" and "someone else's backup" are different problems and
    // lead to different next steps, so they get different messages.
    if (!doc || typeof doc !== 'object' || Array.isArray(doc) || typeof doc.format !== 'string') {
      throw new Error('That file is not a backup.')
    }
    if (doc.format !== Backup.FORMAT) {
      throw new Error('That backup was made by a different add-on.')
    }

    const version = Number(doc.formatVersion)
    if (!Number.isInteger(version) || version < 1) {
      throw new Error('That backup has no usable version number.')
    }
    if (version > Backup.VERSION) {
      throw new Error(
        `That backup is format version ${version}; this version reads up to ${Backup.VERSION}. Update the add-on to restore it.`
      )
    }

    doc = Backup._migrate(doc, version)

    if (!Array.isArray(doc.workspaces)) throw new Error('That backup has no workspaces in it.')
    return doc
  },

  _migrate(doc, from) {
    let current = doc
    for (let v = from; v < Backup.VERSION; v++) {
      const step = Backup.MIGRATIONS[v]
      if (!step) throw new Error(`No way to read format version ${v}.`)
      current = step(current)
    }
    return current
  },

  // mode 'merge' adds the backup's workspaces alongside the current ones.
  // mode 'replace' discards the current ones first.
  async importAll(text, mode = 'merge') {
    const doc = Backup.parse(text)
    const clean = doc.workspaces.map(Backup._sanitize).filter(Boolean)
    if (!clean.length) throw new Error('That backup has no workspaces in it.')

    if (mode === 'replace') {
      for (const ws of await Store.loadAll()) await Store.removeWs(ws.id)
      const old = await Store.loadIndex()
      for (const id of old.order.filter(Store.isSeparatorId)) await Store.removeSeparator(id)
    }

    const index = await Store.loadIndex()
    const taken = new Set(index.order)
    const idMap = new Map()

    // Separators, when the file has them. Ids are remapped alongside the
    // workspaces so a merge cannot collide with what is already there.
    const sepMap = new Map()
    if (Array.isArray(doc.separators)) {
      for (const sep of doc.separators.slice(0, 50)) {
        if (!sep || typeof sep.id !== 'string') continue
        const id = taken.has(sep.id) ? `sep-${Util.uuid()}` : sep.id
        sepMap.set(sep.id, id)
        taken.add(id)
        index.separators[id] = {
          label: typeof sep.label === 'string' ? sep.label.trim().slice(0, 40) : '',
        }
      }
    }

    for (const ws of clean) {
      // A fresh id whenever the old one is in use, so a merge never overwrites
      // a workspace that is open right now.
      ws.originalId = ws.id
      if (!ws.id || taken.has(ws.id)) ws.id = Util.uuid()
      taken.add(ws.id)

      await Store.saveWs(ws)
      idMap.set(ws.originalId ?? ws.id, ws.id)
      delete ws.originalId
      index.order.push(ws.id)
    }

    // Where the file recorded an arrangement, rebuild it so separators land
    // between the right workspaces instead of all at the end.
    if (Array.isArray(doc.order)) {
      const mapped = doc.order
        .map(id => sepMap.get(id) ?? idMap.get(id))
        .filter(id => id && (index.separators[id] || idMap.has(id) || !Store.isSeparatorId(id)))
      const missing = index.order.filter(id => !mapped.includes(id))
      if (mapped.length) index.order = [...missing, ...mapped]
    }

    await Store.saveIndex(index)

    // Imported workspaces have no window: they arrive closed, ready to open.
    // Any window whose workspace was just discarded adopts a new one.
    for (const win of await browser.windows.getAll({ windowTypes: ['normal'] })) {
      const wsId = Workspaces.byWindow.get(win.id)
      if (wsId && (await Store.loadWs(wsId))) continue
      Workspaces.unbind(win.id)
      await Workspaces.adoptWindow(win.id)
      await Workspaces.snapshot(win.id)
    }

    return { imported: clean.length, mode }
  },

  // Everything from a file is untrusted, including files this add-on wrote:
  // they are editable text. Known fields are checked; unknown ones are kept but
  // never acted on.
  _sanitize(raw) {
    if (!raw || typeof raw !== 'object') return null

    const name = typeof raw.name === 'string' ? raw.name.trim().slice(0, 60) : ''
    if (!name) return null

    const ws = { ...raw, name }
    ws.color = Palette.isColor(raw.color) ? raw.color : Palette.DEFAULT_COLOR
    ws.icon = Palette.isIcon(raw.icon) ? raw.icon : Palette.DEFAULT_ICON

    ws.tabs = Array.isArray(raw.tabs)
      ? raw.tabs
          .filter(tab => tab && typeof tab.url === 'string')
          .slice(0, 500)
          .map(tab => ({
            ...tab,
            url: tab.url,
            title: typeof tab.title === 'string' ? tab.title.slice(0, 300) : tab.url,
            pinned: !!tab.pinned,
            active: !!tab.active,
            cookieStoreId:
              typeof tab.cookieStoreId === 'string' ? tab.cookieStoreId : 'firefox-default',
          }))
      : []

    ws.groups = Array.isArray(raw.groups)
      ? raw.groups.slice(0, 50).map(({ gid, ...group }) => ({
          ...group,
          title: typeof group.title === 'string' ? group.title.slice(0, 100) : '',
        }))
      : []

    delete ws.winUuid
    return ws
  },
}
