# Simple Tab Workspaces

Per-window tab workspaces for Firefox / LibreWolf. Switching a workspace hides
one set of tabs and shows another. No sidebar, no theming, no tab tree — the
browser keeps looking like the browser.

Inspired by [tab-workspaces](https://github.com/fonse/tab-workspaces), rewritten
to fix the problems listed below and to allow reordering workspaces by dragging.

## The rule

**One workspace per window, one window per workspace.** The list is global: every
window's popup shows every workspace. Clicking one raises its window if it has
one, and otherwise opens a new window built from its saved tabs. A workspace is
never shown by two windows at once.

Because of that rule nothing is ever hidden or moved between windows. While a
workspace is open its tabs are simply that window's tabs.

## Features

- Global workspace list, shown from any window.
- Click a workspace to jump to its window, or reopen it if closed.
- Create, rename, delete from the popup.
- **Give each workspace a colour and an icon** (✎ on a row) so the list is
  readable at a glance. Colours match Firefox's own tab group colours.
- **Drag a row to reorder the list.**
- Right-click a tab -> *Move tab to workspace*.
- **Separators** to group the list. Click one to give it a label, or leave it
  as a plain rule. Drag them like any other row.
- **Find a workspace** by typing in the filter at the top.
- Native tab groups are saved and rebuilt when a workspace reopens.

## State shown in the popup

| Mark | Meaning |
|---|---|
| filled dot | the workspace this window is showing |
| hollow dot | open in another window |
| small dot, dimmed | closed; the count is its saved tabs |

## Backup

Add-ons manager -> Simple Tab Workspaces -> Preferences, or `backup` in the popup
footer. Saves every workspace, its tabs and its tab groups to a JSON file, and
restores one either alongside the current workspaces or in place of them.
Restored workspaces arrive closed.

The file is designed to stay readable across releases:

```json
{
  "format": "simple-tab-workspaces",
  "formatVersion": 1,
  "app": { "name": "Simple Tab Workspaces", "version": "1.0.7" },
  "exportedAt": "2026-08-24T12:00:00.000Z",
  "workspaces": [
    { "id": "...", "name": "Research", "color": "purple", "icon": "\ud83d\udcda",
      "tabs": [ { "url": "...", "title": "...", "pinned": false, "active": true,
                  "cookieStoreId": "firefox-default", "groupKey": 0 } ],
      "groups": [ { "title": "Reading", "color": "cyan", "collapsed": false } ] }
  ]
}
```

Four rules make that work:

1. `formatVersion` rises only for a **breaking** change. New fields do not bump it.
2. Unknown fields are **preserved**, not dropped, so a file written by a later
   release survives a round trip through this one.
3. A file from a newer format is **refused with a clear message** rather than
   read incorrectly.
4. Old files stay importable through a chain of migrations, `MIGRATIONS[n]`
   taking version n to n+1.

Runtime-only values are excluded: window bindings, and the numeric tab group
ids, which mean nothing in another profile. Group titles, colours and collapsed
state are kept.

Everything read from a file is validated. A backup is editable text, including
one this add-on wrote.

## Storage layout

```
session (window)   wsId       the workspace this window shows
storage.local      index      { order: [id], separators: { id: { label } } }
storage.local      ws@<wsId>  { id, name, color, icon, tabs, groups, savedAt }
```

`order` holds workspace ids and separator ids together, so one array drives the
whole list and reordering needs no special cases. Separator ids start with
`sep-`, which every loop over `order` checks with `Store.isSeparatorId`.

The window binding lives in a session value, so a window Firefox restores comes
back attached to the same workspace. `tabs` is a snapshot kept current while the
workspace is open, and read only when reopening a workspace whose window is gone.

## How reopening works

Two paths, in order:

1. **Native window restore.** If the workspace's own window is still in Firefox's
   recently-closed list, `sessions.restore()` reopens *that* window. Navigation
   history, scroll position, containers and the tab group all come back, and the
   group Firefox saved on close is reclaimed rather than duplicated.
2. **Rebuild from the snapshot.** Used when the closed window is gone, for
   instance after a browser restart or once Firefox has dropped it from the
   list (`browser.sessionstore.max_closed_windows`). Tabs are recreated, so
   history and scroll position are lost, and the tab group is rebuilt.

## Limits

- The rebuild path loses history and scroll position, and cannot recreate
  `about:` or `moz-extension:` tabs.
- `about:`, `chrome:` and `moz-extension:` tabs cannot be recreated and are
  skipped when a workspace reopens.
- Tabs are restored unloaded, the way session restore does.

## Sizing

The popup's size is two CSS variables at the top of `popup/popup.css`:

```css
--scale: 2;    /* the box and its spacing */
--text: 1.5;   /* type */
```

Nothing else hard-codes a size, so either can be changed on its own.

## Files

```
background/util.js         uuid, the serial queue, debounce, url check
background/store.js        storage and session helpers
background/groups.js       native tab group snapshot and rebuild
background/workspaces.js   all workspace logic
background/main.js         listeners, popup messages, context menu
background/backup.js       the backup format, its rules and migrations
shared/palette.js          colours and icons, shared by background and popup
options/                   the backup page
popup/                     the toolbar popup
```

## Install

Temporary (gone on restart, good for iterating):

1. `about:debugging` -> This Firefox -> Load Temporary Add-on
2. Pick `manifest.json`

The LibreWolf flatpak sandbox can only read `~/Downloads`, so the extension has
to live there (or the sandbox needs `flatpak override --user
--filesystem=<dir>:ro io.gitlab.librewolf-community`).

Permanent: `./build.sh` writes `~/Downloads/simple-tab-workspaces.xpi`, which
installs once `xpinstall.signatures.required` is `false`. `./sign.sh` signs it
through addons.mozilla.org instead, so signature enforcement can stay on.
