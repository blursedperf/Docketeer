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
