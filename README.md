# My Simple Tabs Workspace

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
- **New workspace** opens a form first: name, colour and icon, then the window.
  Nothing is stored until you confirm, so cancelling leaves no trace.
- Rename and delete from the popup.
- **Give each workspace a colour and an icon** (✎ on a row) so the list is
  readable at a glance. Colours match Firefox's own tab group colours.
- **Drag a row to reorder the list.**
- Right-click a tab -> *Move tab to workspace*.
- **Separators** to group the list. A new one arrives labelled `---SEPARATOR---`.
  Click it to open its editor: a label, an alignment (left, centre or right) and
  a colour. Clear the label for a plain rule. Drag them like any other row.
- **Find a workspace** by typing in the filter at the top.
- Native tab groups are saved and rebuilt when a workspace reopens.

## State shown in the popup

| Mark | Meaning |
|---|---|
| filled dot | the workspace this window is showing |
| hollow dot | open in another window |
| small dot, dimmed | closed; the count is its saved tabs |

## Backup

Two separate files, because they answer different questions. Workspaces are your
tabs; settings are how the add-on behaves. Carrying a setup to another profile
should not bring that profile's tabs with it.

| File | `format` | Holds |
|---|---|---|
| Workspaces | `my-simple-tabs-workspace` | workspaces, tabs, groups, separators, order |
| Settings | `my-simple-tabs-workspace-settings` | the settings above |

Files written before the rename used `simple-tab-workspaces` and
`simple-tab-workspaces-settings`. Those spellings are still accepted on import,
listed in `LEGACY_FORMATS`, because a format string is matched rather than shown
and dropping one only ever strands files. Exports always use the current name.

Each refuses to be restored as the other, naming what the file actually is and
which control to use.

Add-ons manager -> My Simple Tabs Workspace -> Preferences, or `configuration`
in the popup footer. Saves every workspace, its tabs and its tab groups to a JSON file, and
restores one either alongside the current workspaces or in place of them.
Restored workspaces arrive closed.

The file is designed to stay readable across releases:

```json
{
  "format": "my-simple-tabs-workspace",
  "formatVersion": 1,
  "app": { "name": "My Simple Tabs Workspace", "version": "1.2.0" },
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

## Diagnostics

The `diagnostics` link in the popup footer copies a JSON dump: version,
permissions, window and workspace bindings, every window's tabs with their group
ids and containers, and a log of recent warnings.

It is made to be pasted into an issue or a chat, so it leaves out anything that
identifies a page. Addresses are cut to their site, `https://bank.example.com/…`,
and titles are dropped entirely - a title says more than the address it came
from. Structure is what has actually diagnosed every bug here, and structure is
kept in full. A checkbox restores the detail when a specific page is the bug.

## Permissions

| Permission | Why |
|---|---|
| `tabs` | read and move the tabs a workspace is made of |
| `sessions` | remember which workspace a window shows, across restarts |
| `storage` | workspace names, colours, ordering and snapshots |
| `tabGroups` | keep native tab groups through a close and reopen |
| `menus` | the *Move tab to workspace* item |
| `cookies` (optional) | rebuild a tab in its container after a restart. Asked for from the options page or the popup, never at install |

Without the `cookies` permission a rebuilt tab still comes back, in the default
container. That only happens on the rebuild path: reopening a window Firefox
still remembers keeps containers either way. When it does happen the popup says
so and offers the permission, rather than leaving it to be discovered by a site
asking for a password.

No host permissions, no content scripts, and nothing loaded from the network.
The content security policy is declared explicitly rather than relying on the
default.

## Storage layout

```
session (window)   wsId       the workspace this window shows
storage.local      index      { order: [id], separators: { id: { label, align, color } } }
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

## Settings

Add-ons manager -> Preferences, or `configuration` in the popup footer. Every
macro adjustment lives in one schema,
`background/settings.js`, which supplies the default, the bounds and the
validation. The options page renders whatever that schema declares, so adding a
setting means adding one entry.

| Setting | Default | Range |
|---|---|---|
| Popup size | 2 | 1 - 3 |
| Text size | 1.5 | 1 - 3 |
| List height | 460px | 200 - 560 |
| Reopen the original window | on | |
| Restore tabs unloaded | on | |
| Confirm before deleting | on | |
| Number key shortcuts | on | |

Values are validated where they are stored, not where they are typed. A number
out of range is clamped; a value of the wrong type falls back to its default. A
hand-edited settings file cannot leave the add-on unable to render.

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

## Working on it

```bash
npm install       # web-ext and jsdom
npm run lint      # manifest, syntax, web-ext lint
npm test          # 80 scenarios against a mock browser API
npm run build     # writes the .xpi to ~/Downloads
npm run dev       # auto-reloading Firefox with the add-on loaded
```

Tests run without a browser: `test/lib/fake-browser.mjs` is a mock
WebExtension API that models the ways Firefox refuses things. See `CLAUDE.md`
for how the layers fit together.

## Install

Temporary (gone on restart, good for iterating):

1. `about:debugging` -> This Firefox -> Load Temporary Add-on
2. Pick `manifest.json`

The LibreWolf flatpak sandbox can only read `~/Downloads`, so the extension has
to live there (or the sandbox needs `flatpak override --user
--filesystem=<dir>:ro io.gitlab.librewolf-community`).

Permanent: `./build.sh` writes `~/Downloads/my-simple-tabs-workspace.xpi`, which
installs once `xpinstall.signatures.required` is `false`. `./sign.sh` signs it
through addons.mozilla.org instead, so signature enforcement can stay on.
