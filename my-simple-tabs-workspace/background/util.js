'use strict'

const Util = {
  uuid() {
    return crypto.randomUUID()
  },

  // Runs async operations one at a time. Every workspace mutation goes through
  // this, so a fast click or a burst of tab events cannot interleave two
  // switches and leave tabs tagged for a workspace that is no longer active.
  serial(fn) {
    const run = Util._queue.then(() => fn())
    Util._queue = run.catch(() => {})
    return run
  },
  _queue: Promise.resolve(),

  // An empty tab. tabs.create cannot navigate to these, but creating a tab with
  // no url at all produces the same thing, so they still come back.
  BLANK_URLS: ['about:newtab', 'about:blank', 'about:home', 'about:privatebrowsing'],

  isBlankURL(url) {
    return !url || Util.BLANK_URLS.includes(url)
  },

  // tabs.create refuses privileged urls, so they cannot come back when a
  // workspace is reopened.
  isRestorableURL(url) {
    if (!url) return false
    try {
      const protocol = new URL(url).protocol
      return protocol !== 'about:' && protocol !== 'chrome:' && protocol !== 'moz-extension:'
    } catch {
      return false
    }
  },

  // Can this snapshot entry come back at all?
  isRestorable(url) {
    return Util.isBlankURL(url) || Util.isRestorableURL(url)
  },

  debounce(fn, wait) {
    let timeout
    return (...args) => {
      clearTimeout(timeout)
      timeout = setTimeout(() => fn(...args), wait)
    }
  },
}
