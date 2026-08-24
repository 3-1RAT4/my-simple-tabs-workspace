'use strict'

// Shared by the background and the popup so the list the user picks from and
// the list the background validates against cannot drift apart.
//
// Colour names match Firefox's own tab group colours, so a workspace tinted
// "purple" looks like a purple tab group rather than something invented.

// Published on globalThis rather than declared: this classic script is loaded
// by both the background page and the popup, and under 'use strict' neither a
// top-level `const` nor a `var` reliably reaches other scripts in every
// environment that runs this file.
globalThis.Palette = {
  DEFAULT_COLOR: 'default',
  DEFAULT_ICON: '',

  colors: ['default', 'blue', 'purple', 'cyan', 'green', 'yellow', 'orange', 'red', 'pink', 'grey'],

  icons: ['', '💼', '🏠', '🎓', '🛒', '🎵', '🎮', '📚', '🔧', '💡', '🧪', '✈️', '❤️', '🌐'],

  isColor(value) {
    return Palette.colors.includes(value)
  },

  // Emoji only, and short: this is a label, not a place to smuggle text in.
  isIcon(value) {
    if (typeof value !== 'string') return false
    if (value === '') return true
    return [...value].length <= 2
  },
}

if (typeof module !== 'undefined') module.exports = { Palette: globalThis.Palette }
