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

## Phase 2

20. **Feature flag**: Settings → Appearance → Docket → "Use the Docket (preview)" (`docket` in `.quire/app.json`,
    off by default). Off, nothing of the Docket is built and Mod+P opens the command palette as before. On,
    Mod+P opens the Docket and the palette's default shortcut is removed (its commands are the `>` prefix).
21. **Esc in steps**: actions → results; panel or tabs → input; text in the input → cleared (back to the panel);
    empty input → closes. This is the plan's "back one level", with clearing the query counted as a level.
22. **Pinned mode and focus**: pinned stays docked. Esc (or choosing a result) gives the keyboard back to the
    editor without hiding it; Mod+P then moves the keyboard into it, and Mod+P from inside hides it.
    Peek closes when chosen from, on Esc, or when focus leaves it (a click elsewhere); dialogs it opens (a
    delete confirmation) do not close it.
23. **Shortcut changes from the plan**, following Checkpoint 0: open/close is Mod+P; peek/pinned is
    Mod+Shift+P (which also opens it). The handle's hint shows whatever key is set.
24. **Mod+1 … Mod+9** are commands with the `docket` context, so they only act while the Docket has the
    keyboard and never clash with anything in the editor.
25. **Panel content is Phase 4.** Phase 2 ships the six panels in their final order; Outline already works
    (headings, arrows, Enter to jump, Mod+Enter / Alt+Enter to open in a split). The others describe what
    they will hold and list today's commands for the same job, so no panel is a dead end. Authorities shows
    the case name it was opened on.
26. **Search is Phase 2 grade**: fuzzy matching on note names and paths, headings of the open note, commands
    (by name, alias, keyword, section; recently used first), folders and tags, shortcuts. Full text, the
    index, ranking by use and "show all" are Phase 3. The Docket drops any result whose note is locked,
    whatever provider returned it.
27. **Context-aware opening** reads the line at the cursor: a footnote definition or inline footnote opens Cite;
    a case name ("X v Y", with leading words such as "In" or "See" dropped) opens Authorities with it
    selected. Detection is deliberately simple until the Authorities parser (Phase 4).
28. **Budget check**: the smoke test opens the Docket five times and requires each open under 50 ms (with the
    small test homebase; the 10,000-note fixture comes in Phase 3).

## Phase 3

29. **The index lives in memory only** (`SearchIndex`, `packages/api/src/search-index.ts`): an inverted index of
    words for full text, plus names and headings. Nothing with note text is written to disk, so the rule
    "stored with the same encryption as the notes" never arises. It is built from the notes' text, which
    the vault already holds in memory, in batches after the window appears (about 0.7 s for 10,000 notes),
    and follows every create, change, rename and delete. Locked notes are never added (`app.isLocked`).
30. **Full text matches every word as a prefix** (the last word is usually half typed). Results show the line
    of the first match with the words marked. Ranking: a cheap score for every match (use, same folder or
    unit, name matching), then the costly checks (whole phrase present, match near the top) for the best
    300 only, which keeps keystrokes inside the budget when thousands of notes match.
31. **Use is recorded in `.quire/usage.json`**: note paths and command ids with a count and the last time,
    no note text. Frecency halves every week. This is on disk like `workspace.json` (which already lists
    open notes); the locking phase must decide whether locked notes' paths may appear there.
32. **Context**: notes in the same folder as the open note rank higher than notes in the same unit (top
    folder), which rank higher than the rest, per decision 7 (units are folders).
33. **Groups**: Notes (names), Headings (all notes), Commands, In notes (full text), Settings; `/` still
    searches only the open note's headings. The unprefixed search shows up to five of each group, with a
    "Show all N" row; choosing it lists that group alone (up to 200) and Esc returns. Providers may return
    only their best results with `totals`, so counts are right without building every result.
34. **Settings search** draws each settings page off screen once per session, when the Docket first opens,
    and matches names (descriptions only for close matches).
35. **Benchmark**: `scripts/fixture.mjs` generates a deterministic homebase (10,000 notes, 22 MB, subject
    and topic folders). `npm test` includes an index benchmark (90% of keystrokes under 16 ms); `npm run
    bench` runs the app on the fixture and checks all three budgets. CI runs it and reports, without failing
    the build, since shared machines vary.
36. **Found by the benchmark and fixed**: opening any note took about 10 s with 10,000 notes because the
    Backlinks pane resolved every link in every note, and each resolution scanned the whole file list.
    Links are now resolved through a name map, backlinks start from `resolvedLinks` (now re-resolved when
    a note is created), and unlinked mentions only check the notes the index says contain the name's
    words, a few at a time, stopping when a newer render starts. A split now takes about 11 ms.
37. **Speed-ups after the first CI benchmark** (CI's shared machine put 10 % of keystrokes at 20 ms):
    typing that extends the query only rechecks the previous name and heading matches; names are matched
    without copying them to lowercase again; built icons are reused; the first result is selected without
    forcing a layout; tag counts are cached until a note changes; and full text starts at **three
    characters** (two match nearly every note). Locally: median 5 ms, worst 11.5 ms a keystroke.

## Phase 4

38. **Authorities detection is in core** (`packages/api/src/authorities.ts`), pattern-based and original
    rather than a port of the AGLC4 plugin's grammar (that grammar classifies footnote text as you type; this
    finds names in running text and footnotes). Cases: "X v Y" with any medium neutral or report citation
    after it; legislation: a title ending in Act, Regulations, Rules, Code, Ordinance or Constitution, with year,
    jurisdiction and sections; secondary sources: journal articles and books in footnotes. Short titles
    defined with ('…') count later uses as occurrences. Jurisdiction comes from the court or report series.
    A case or Act found without a citation (or year and jurisdiction) is **unconfirmed**.
39. **Confirm and merge decisions** are kept in `.quire/authorities.json` by authority key (kind and name),
    not by note, so they apply in every note. No note text or paths are stored.
40. **"Every note citing this"** uses the index's candidates (notes containing all words of the name), then
    detects authorities in just those, a hundred at a time so the window stays responsive.
41. **Citation formatting is a core module per edition** (`packages/api/src/cite/`): a `CitationStyle`
    interface and `AGLC4`. Kinds so far: reported case, medium neutral citation, legislation, journal article,
    book. Ibid / "(n X)" / full is decided from the note's footnotes (Ibid when the previous footnote cites only
    this source, following earlier Ibids back; "(n X)" when cited earlier). Legislation's later references use
    the (short) title without "(n X)". All test expectations are marked `// VERIFY against AGLC`; nothing is
    copied from the guide. The AGLC4 plugin keeps its own grammar and as-you-type suggestions; the Cite panel
    lists its tools.
42. **New footnotes** take the next free number, the reference at the cursor and the definition after the
    note's last footnote. The plugin's "Tidy footnotes" renumbers when references are out of order.
43. **Outline edits** move or re-level whole sections (with their subheadings) as one undo step. A note is a
    case brief when `type: case-brief`, a `case-brief` tag, or three of the five field headings.
44. **Units**: pinned notes are `pinnedNotes` in app.json (paths, followed on rename, dropped on delete);
    "Archive note" moves a note to `Archive/<its path>` (`archiveFolder` setting), listed last in Units. The
    words "Subject" and "Topic" live in one place (`UNIT_LABELS`) for clients and matters later.
45. **Export** (Homebase panel) writes Markdown or HTML to `Exports/` in the homebase after a dialog that says
    exactly what will be written, with options to drop comments and properties and to black out listed names
    or phrases (█). Nothing leaves the computer.
46. **Panel items have actions**: → or Mod+. on a row opens its actions in the Docket (Esc or ← returns);
    panels can show a list of results ("Notes citing …", "Links to …") the same way. Note actions everywhere
    include the plugins' `file-menu` items, read through a new `Menu.listItems()`.
47. **Inside panel forms** (Cite), Tab moves between fields and arrows edit text; Esc goes back a step.

## Checkpoint 4 (answers)

48. **Unlinked mentions move to a "Mentions" action** on notes in the Docket: each mention with its line,
    Enter opens it there, → "Turn into a link".
49. **No Classic sidebars.** The sidebars are replaced entirely by the Docket in Phase 6; no fallback setting
    (this replaces decision 8). The AGLC4 plugin's views that live in the right sidebar today, the page
    (Word export) preview and version history, must open in a normal tab instead; done in Phase 6 with the
    sidebar removal.
50. **The AGLC4 fixture formats are confirmed** by the user (the `// VERIFY against AGLC` expectations in
    `test/cite.test.ts` and `test/authorities.test.ts`); the markers stay so later editions get the same check.
