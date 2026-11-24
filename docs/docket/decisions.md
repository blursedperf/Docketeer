# Docket: decisions log

Where the plan (`docs/docket/PLAN.md`) meets the real codebase, and what was decided. Newest last.

## Phase 0

1. **"Vault" is "homebase" in the interface.** The plan's generic "vault" maps onto Quire's homebase (the
   folder of notes). The API keeps `app.vault` for plugin compatibility. Whether the Docket's Mod+5 panel is
   called "Vault" or "Homebase" is an open question for Checkpoint 0.
2. **The command registry extends the existing `Command` interface rather than replacing it.** Plugins use
   the Obsidian-shaped `addCommand` (`callback`, `checkCallback`, `editorCallback`, `hotkeys`). The plan's
   fields (`when`, `run`, `section`, `aliases`, `keywords`, `requiresUnlocked`, `confirm`, `source`) will be
   added as optional fields, with `when`/`run` derived from the existing callbacks where absent, so existing
   plugins keep working.
3. **The no-network test already exists** (`scripts/offline-audit.mjs`, run by `npm test` and CI, plus the
   run-time checks in the smoke test). It has an explicit allow-list. The plan's requirement is met by keeping
   it and extending its rules if new risky APIs appear, rather than adding a second test.
4. **Tests use the existing tools**: Vitest for pure logic (registry, layout tree, ranking, AGLC formatting),
   the Electron smoke test for keyboard-only end-to-end journeys, and the screenshot comparison for the UI.
   No new test runner is needed.

## Checkpoint 0 (answers)

5. **The Docket opens with Mod+P**, taking over the command palette's key; the palette lives on as the `>`
   prefix. Peek/Pinned switching moves from Mod+Shift+K to **Mod+Shift+P**. "Insert internal link" keeps Mod+K.
6. **Peek is the default mode.**
7. **Units are folders**: subjects and topics are folders in the homebase (a frontmatter override may come
   later). Ready to become clients and matters.
8. **The "Classic sidebars" fallback stays**, as a setting, as long as it does not add much overhead.
9. **Plugins may add Docket panels, and views in tabs or splits** (existing `registerView`). Whether plugins
   may search locked content once unlocked was not decided: until then, plugin search providers never receive
   locked notes, and this is revisited in the locking phase.
10. **Locking and encryption get their own phase**, before the Homebase panel's lock features (new
    Phase 4b; see below). Phase 4's Homebase panel ships without lock actions until then.
11. **Authorities and Cite are built into the app**, not provided by the AGLC4 plugin. The AGLC formatting
    code they need moves (or is shared) into a core module.
12. **The Mod+5 panel is "Homebase"**, matching the rest of the app.

## Phase 1

13. **Command ids keep Quire's existing form** (`app:new-note`, `editor:toggle-bold`, `<pluginId>:<name>`)
    rather than the plan's `core.note.new` / `plugin.<id>.<name>`. Renaming would break saved hotkeys in
    `.quire/hotkeys.json` and any plugin calling `executeCommandById`. `source` ("core" or "plugin:<id>") and
    `section` carry the grouping the dotted names were for.
14. **`title` is `name`, `defaultShortcut` is `hotkeys`** (the existing field names, kept for plugins). The plan's
    other fields are new optional fields on `Command`: `aliases`, `keywords`, `section`, `context`, `when`,
    `run(ctx, args)`, `requiresUnlocked`, `confirm`, `source`. Commands without `when`/`run` behave as before.
15. **Shortcut contexts are `global`, `editor` and `docket`.** "Pane focused" from the plan is not a separate
    context yet: pane commands act on the active pane, which is always the focused one. Revisit in Phase 5.
16. **Menus pass arguments to commands**: the file menu runs `app:rename-file` etc. with `{ file }`, the tab
    menu runs `app:close-tab`/`app:split-*` with `{ leaf }`, the explorer buttons run `app:new-note`/`app:new-folder`
    with `{ folder }`. Plugin items added through the `file-menu` event are unchanged (they are the plugins'
    own commands' business).
17. **`app.isLocked()` exists and always returns false** until the locking phase, so `requiresUnlocked` is
    already enforced and search can already ask.
18. **The command palette keeps Mod+P until the Docket ships (Phase 2)**, then the Docket takes Mod+P and the
    palette becomes the `>` prefix.
19. **Logs never carry error messages from file operations**, since Node puts the path in them: `errorSummary(e)`
    logs only the error's name and code. The two path-logging places from the inventory are fixed, and the
    main process logs only the scheme of a blocked request.
