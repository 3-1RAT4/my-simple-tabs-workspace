'use strict'

// Every macro adjustment lives here, with its default, its bounds and one
// place that validates it. The UI only ever proposes a value; this decides
// whether it is allowed. A setting that is out of range or the wrong type is
// replaced by its default rather than rejected, so a hand-edited settings file
// can never leave the add-on unusable.

const Settings = {
  KEY: 'settings',

  // kind drives both validation and what the options page renders.
  SCHEMA: {
    'ui.scale': {
      kind: 'number',
      default: 2,
      min: 1,
      max: 3,
      step: 0.1,
      label: 'Popup size',
      help: 'Width and spacing. 1 is the original compact size.',
    },
    'ui.text': {
      kind: 'number',
      default: 1.5,
      min: 1,
      max: 3,
      step: 0.1,
      label: 'Text size',
      help: 'Type scale, independent of the box.',
    },
    'ui.listHeight': {
      kind: 'number',
      default: 460,
      min: 200,
      max: 560,
      step: 20,
      label: 'List height',
      help: 'How tall the list grows before it scrolls, in pixels.',
    },
    'behavior.preferSessionRestore': {
      kind: 'boolean',
      default: true,
      label: 'Reopen the original window',
      help:
        'Restores the closed window itself, keeping history and reclaiming its tab group. Turn off to always rebuild tabs from the saved list.',
    },
    'behavior.restoreUnloaded': {
      kind: 'boolean',
      default: true,
      label: 'Restore tabs unloaded',
      help: 'Rebuilt tabs load when you first visit them, the way session restore works.',
    },
    'behavior.confirmDelete': {
      kind: 'boolean',
      default: true,
      label: 'Confirm before deleting',
      help: 'Deleting a workspace takes two clicks.',
    },
    'behavior.quickSwitchKeys': {
      kind: 'boolean',
      default: true,
      label: 'Number key shortcuts',
      help: 'Press 1 to 9 in the popup to jump straight to a workspace.',
    },
  },

  defaults() {
    const out = {}
    for (const [path, spec] of Object.entries(Settings.SCHEMA)) {
      Settings._set(out, path, spec.default)
    }
    return out
  },

  async load() {
    const res = await browser.storage.local.get(Settings.KEY)
    return Settings.validate(res[Settings.KEY])
  },

  async save(values) {
    const clean = Settings.validate(values)
    await browser.storage.local.set({ [Settings.KEY]: clean })
    return clean
  },

  // Merges a partial update over what is stored.
  async update(partial) {
    const current = await Settings.load()
    for (const [path, value] of Object.entries(partial ?? {})) {
      if (Settings.SCHEMA[path]) Settings._set(current, path, value)
    }
    return await Settings.save(current)
  },

  async reset() {
    await browser.storage.local.remove(Settings.KEY)
    return Settings.defaults()
  },

  // Anything unrecognised or out of range falls back to the default.
  validate(raw) {
    const out = Settings.defaults()
    if (!raw || typeof raw !== 'object') return out

    for (const [path, spec] of Object.entries(Settings.SCHEMA)) {
      const value = Settings._get(raw, path)
      if (value === undefined) continue

      if (spec.kind === 'boolean') {
        if (typeof value === 'boolean') Settings._set(out, path, value)
      } else if (spec.kind === 'number') {
        // Number() turns null, '' and [] into 0, which would clamp to the
        // minimum and look like a deliberate choice. Only a real number, or a
        // string holding one, counts: range inputs hand over strings.
        const numeric =
          typeof value === 'number' ||
          (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value)))
        if (!numeric) continue

        const num = Number(value)
        if (Number.isFinite(num)) {
          Settings._set(out, path, Math.min(Math.max(num, spec.min), spec.max))
        }
      }
    }

    return out
  },

  _get(obj, path) {
    return path.split('.').reduce((node, key) => (node == null ? undefined : node[key]), obj)
  },

  _set(obj, path, value) {
    const keys = path.split('.')
    const last = keys.pop()
    let node = obj
    for (const key of keys) {
      if (!node[key] || typeof node[key] !== 'object') node[key] = {}
      node = node[key]
    }
    node[last] = value
  },
}
