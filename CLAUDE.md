# Working on extensions in this tree

Read this before debugging or changing any addon here.

## The constraint that shapes everything

Claude has **no browser, no flatpak, no container runtime** in its sandbox. It can never
run or observe the extension itself. Every browser fact has to come from the user, so
browser round-trips are the scarce resource. Spend them only on what genuinely needs a
browser.

## Four layers, cheapest first

| Layer | What | Command |
|---|---|---|
| L0 | Syntax, manifest, `web-ext lint` | `npm run lint` |
| L1 | Mock WebExtension API scenarios | `npm test` |
| L2 | Popup executed in jsdom | `npm test` |
| L3 | Real browser, auto-reload | `./tools/dev-firefox.sh <project>` |

Never spend a round-trip on something a lower layer can catch.

## Rules

**1. Bug report → failing test → fix.** Reproduce in `lib/fake-browser.mjs` first. Every bug
in this tree so far was expressible as an L1 scenario: dropped container tabs, uncounted
blank tabs, multiplying tab groups.

**2. Environment before code.** On any "it doesn't work", run `./tools/env-report.sh` first.
Three dead ends were environmental, not code:
- the flatpak sandbox could only read `~/Downloads`, so a temp-loaded addon had no popup
- `userChrome.css` collapsing `#TabsToolbar`
- `user.js` reapplying a pref at startup, so `about:config` edits appeared not to work

**3. Load the extension from its manifest, never from a copied list.**
`loadExtension(root, browser)` reads `background.scripts` out of `manifest.json`.
Three separate breakages came from test files keeping their own copy of that list
and drifting when a script was added.

**4. The mock must model how the browser says *no*.** Its value is in the failure modes.
When the browser surprises us, encode the surprise in `lib/fake-browser.mjs` with a comment
saying where the rule came from. A mock that only does the happy path will happily confirm a
wrong assumption — this already happened once, when the mock let a saved tab group be revived
by id and "proved" a fix that did not work in Firefox.

**5. Check the API docs before assuming.** Two wrong guesses were settled in one WebFetch of
MDN. Cheaper than a round-trip.

**6. Mark unverifiable assumptions.** Anything that cannot be tested locally gets
`ASSUMPTION:` in the code, naming what would falsify it.

**7. Bump the version on every build** (`./build.sh --bump`), and show it in the popup, so
"which build are you running" is never a question.

**8. Say what is verified.** Distinguish "verified by test" from "reasoned about" in reports
to the user. They act on the difference.

## Getting evidence out of the browser

Each addon exposes a **diagnostics** link in its popup: version, permissions, storage,
bindings, every window with its tabs and group ids, and the recent log ring buffer. One click
copies JSON. Ask for that rather than for prose descriptions, and never ask the user to open
devtools — it has already failed for them once.

## Known Firefox behaviours worth remembering

- A tab group whose window closes becomes a **saved group**. Extensions cannot list or delete
  saved groups (`tabGroups` has no `remove()`), and a saved group's id cannot be regrouped —
  MDN: "when a tab group is restored, its groupId may differ from its original value". The
  only lever is `tabs.ungroup()` before the window closes, since emptied groups are deleted.
- `tabs.create({ cookieStoreId })` needs the **`cookies`** permission or it throws, silently
  losing container tabs.
- `tabs.create` refuses `about:`, `chrome:` and `moz-extension:` urls.
- Extension buttons are hidden in the Extensions panel until pinned to the toolbar.

## Layout

```
lib/fake-browser.mjs   mock browser API + VM loader for background scripts
lib/test-kit.mjs       tiny runner: test, run, eq, ok
tools/lint.mjs         L0
tools/test.mjs         runs every project's *.test.mjs
tools/env-report.sh    browser environment snapshot
tools/dev-firefox.sh   L3 auto-reload browser
<project>/test/*.test.mjs
```

Background scripts are plain scripts sharing globals. `loadBackground()` runs them in one VM
context in manifest order; read their globals back with `globals([...])`, because a top-level
`const` never becomes a property of the context.
