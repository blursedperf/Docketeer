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
