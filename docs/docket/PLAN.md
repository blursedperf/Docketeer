# Plan: The Docket + Tiled Tabs

A plan for Claude Code. Work through it phase by phase.

## Context

This is a Markdown note app for Australian law students. Later it will grow into a private note app for
lawyers. Its core values are offline-first, security and keyboard-first.

The app currently uses sidebars, which look and feel too much like Obsidian. They will be replaced by the
Docket, a tray that drops down from the top of the window. Every command, search, panel and plugin action will
be reachable from the keyboard inside the Docket. The editor will also gain tiling: tabs can be split into
panes and rearranged entirely from the keyboard.

## How to work through this plan

- Read this whole file before writing any code.
- Do Phase 0 first, and don't skip it. The rest of the plan uses generic names. Map them onto the real
  codebase, its framework and its existing conventions.
- Work one phase at a time. Commit at the end of each phase with a clear message.
- At each 🛑 Checkpoint, stop. Summarise what you did, what's left and any decisions you made, then wait for review.
- Don't remove or break the existing sidebars until Phase 6. Until then, the Docket is built behind a feature flag.
- Don't add new runtime dependencies without asking. Prefer what's already in the project.
- When this plan conflicts with something real in the codebase, follow the codebase and note the deviation in
  `docs/docket/decisions.md`.

## Non-negotiable constraints

- **Offline.** No new network calls of any kind: no telemetry, no CDN fonts, no remote lookups. Add a test that
  fails if new code calls fetch, XMLHttpRequest, WebSocket or similar outside an explicit allow-list.
- **Security.** Never write note contents, search queries or file paths to logs. Locked or encrypted notes must
  not appear in search results, the Authorities index or previews until they're unlocked. Any search index that
  contains note text is either in memory only, or stored with the same encryption as the notes.
- **Keyboard-first.** Every action in this plan must be doable without a mouse. Mouse support is a bonus, never
  the only way.
- **Accessibility.** Use correct ARIA roles, manage focus properly, keep everything usable with a screen reader
  and honour reduced-motion settings.
- **Performance budgets.** With 10,000 notes: the Docket opens in under 50 ms; filtering on each keystroke takes
  under 16 ms; opening a pane split takes under 100 ms.

## Phase 0: Discovery

Goal: understand what exists before changing it.

- Identify the stack: framework, state management, editor component, test runner, build tooling and target platforms.
- Inventory every sidebar feature: each function, its current shortcut (if any) and where the code lives.
- Inventory all existing commands, keyboard shortcuts, search features and the plugin API.
- Write `docs/docket/inventory.md` with a parity table: existing feature | where it lives now | new home
  (Docket panel or command) | planned improvement.
- Find out how notes are organised on disk (folders, frontmatter or tags) so the Units panel can be mapped onto it.

🛑 Checkpoint 0: present the inventory and parity table, and list any open questions.

## Phase 1: Command registry and keybindings

Goal: one place that records every action in the app.

Command registry. Each command has: `id` (namespaced, e.g. `core.note.new` or `plugin.<pluginId>.<name>`);
`title`, `aliases[]`, `keywords[]` (fuzzy search); `section` (grouping: Notes, Cite, Layout, Vault…);
`defaultShortcut` (optional); `when(ctx)` (available now?); `run(ctx, args)`; `requiresUnlocked`; `confirm`
(ask before running: deletes, exports); `source` (core or plugin:<id>).

Move all existing commands, menu items and sidebar buttons onto the registry. Menus and buttons should call
registry commands instead of their own handlers.

Keybinding manager: a single keymap (`Mod` = Cmd on macOS, Ctrl elsewhere); conflict detection between commands
and with common OS and browser shortcuts; user remapping stored locally; context-dependent shortcuts (editor,
Docket open, pane focused).

Plugin API: `registerCommand`, `registerDocketPanel`, `registerSearchProvider`, `registerResultAction`.
Everything a plugin registers is namespaced and removed automatically when the plugin is unloaded.

Tests: the registry, `when` checks, conflict detection, remapping and plugin unload cleanup.

## Phase 2: The Docket shell

Goal: the tray itself, with keyboard control.

Behaviour:
- Drops down from the top of the window; opened/closed with Mod+K (changeable).
- Two modes: **Peek** (default; overlays the editor, focus stays inside until dismissed) and **Pinned** (docked,
  pushes the editor down). Mod+Shift+K switches; the last choice is remembered.
- Height defaults to 35% of the window, resizable between 20% and 60% with the keyboard (Mod+Alt+↑/↓ while the
  Docket is focused) or by dragging; remembered.
- On open the cursor is in the input line. Esc closes it and returns focus to the exact cursor position and
  selection the user had before.
- A thin handle at the top of the window, with a "⌘K" hint, opens it with the mouse.

Input prefixes: (none) search everything (notes, headings, commands, authorities); `>` commands; `@`
authorities; `#` units, topics and tags; `/` headings in the current note; `?` shortcut help.

Panels: Mod+1 to Mod+6 switch panels (order from Phase 4). Tab / Shift+Tab move between the input line, the
results list and the panel actions.

Navigation: ↑/↓ move through results; Enter opens in the current pane; Mod+Enter opens in a new pane to the
right; Alt+Enter opens in a new pane below; Shift+Enter inserts as a link or citation at the cursor; → or Mod+.
shows more actions for the selected result; Esc goes back one level or closes the Docket.

Context-aware opening: cursor on a case name → Authorities with that case selected; cursor in a footnote →
Cite; otherwise the last-used panel.

Display: the shortcut next to every command in the results.

Accessibility: dialog, combobox and listbox ARIA roles; result counts announced; no animation with reduced motion.

🛑 Checkpoint 2: provide a demo build or screenshots, plus the keyboard-only walkthrough.

## Phase 3: Unified search

- Providers: notes (titles and full text), headings, commands, authorities, units and tags, settings, plugin providers.
- Ranking combines fuzzy matching, recency and frequency of use, and context (items from the current unit rank higher).
- Results grouped by type, a few items per group, with "show all" for each.
- The index is local and updated as notes change, and follows the security rules above.
- A benchmark using a generated 10,000-note fixture.

## Phase 4: Docket panels

Each panel replaces one or more sidebar features and improves on them. Everything in the Phase 0 parity table
must end up in a panel or a command.

- **Authorities (Mod+1):** detect authorities in the current note: case names (X v Y), medium neutral citations
  (e.g. [2020] HCA 5), law report citations (e.g. (1992) 175 CLR 1), legislation (Act name, year and
  jurisdiction, plus section references such as s 18). Group into Cases, Legislation and Secondary sources, with
  counts. Enter jumps to the next place the authority appears; a secondary action shows every note citing it.
  Unsure parses shown as "unconfirmed", to confirm or merge. Jurisdiction filter (Cth, NSW, Vic, Qld, WA, SA,
  Tas, ACT, NT).
- **Outline (Mod+2):** headings, plus case brief fields (Facts, Issues, Held, Ratio, Obiter) when the note is a
  case brief. Alt+↑/↓ move a section; Alt+←/→ promote or demote a heading.
- **Units (Mod+3):** subjects, then topics, then notes, plus recent and pinned notes. Create, rename, move and
  archive notes from the keyboard. Data model ready for subjects/topics to become clients/matters later.
- **Cite (Mod+4):** an AGLC citation builder in its own formatter module that can support more than one edition,
  starting with AGLC4. Footnotes, Ibid and cross-references (above n, n X) handled automatically.
  Fixture-based unit tests with original fixtures marked `// VERIFY against AGLC`; no text copied from the guide.
- **Vault (Mod+5):** lock status, lock now, lock/unlock a single note or notebook; encryption status; export
  with a confirmation step and an option to redact.
- **Layout (Mod+6):** layout presets and open panes, and switching between them (Phase 5).

Plugins can add panels, which take the next free number or none.

🛑 Checkpoint 4: present the parity table with every row ticked off or explained.

## Phase 5: Tiling tabs

Layout model: a tree of splits (horizontal or vertical, adjustable ratios); each leaf is a pane holding an
ordered list of tabs. Layout logic as pure, well-tested functions, separate from the UI.

Operations (all registry commands, so they appear in the Docket):

| Default shortcut | Action |
|---|---|
| Mod+\ | Split right |
| Mod+Shift+\ | Split down |
| Mod+Alt+←/→/↑/↓ | Move focus to the neighbouring pane |
| Mod+Alt+Shift+←/→/↑/↓ | Move the current tab to the neighbouring pane, creating one if needed |
| Mod+Ctrl+←/→/↑/↓ | Resize the current pane |
| Mod+Shift+= | Make all panes equal size |
| Mod+Shift+Enter | Zoom the current pane to full size and back |
| Mod+W | Close the tab; empty panes close automatically |
| Mod+Shift+T | Reopen the last closed tab |
| Ctrl+Tab / Ctrl+Shift+Tab | Next or previous tab in the pane |

Presets (Layout panel), plus user-saved layouts: Single; Brief + Source (case brief beside the judgment or
reading); Revision (outline, notes and Authorities); Exam (exam outline left, scratch notes right).

The same note open in two panes stays in sync, with one cursor per pane. The layout is saved locally per
workspace and restored on launch. Dragging tabs to dock them is optional, only after everything works from the keyboard.

## Phase 6: Retire the sidebars

- Turn the Docket on by default.
- Keep a temporary "Classic sidebars (deprecated)" setting only if asked for at Checkpoint 4.
- Remove the old sidebar code and shortcuts once parity is confirmed; map old shortcuts to new commands where sensible.

🛑 Checkpoint 6: get approval before deleting the sidebar code.

## Phase 7: Polish and QA

- A `?` cheat sheet in the Docket, generated from the keymap.
- A first-run hint ("Press ⌘K for everything"), dismissable and never shown again.
- Keyboard-only end-to-end tests: create a case brief; cite it in an essay with AGLC footnotes; split the screen
  to show the brief beside the essay; find every note citing a given case; lock the vault.
- Performance budgets checked with the 10,000-note fixture.
- Security checks: the no-network test passes, logs contain no note contents, locked notes are excluded from
  search and Authorities.
- Accessibility check with a screen reader and keyboard only.

## Definition of done

- Every row in the parity table is covered, and the sidebars are removed.
- Every command, search result, panel action and plugin action can be reached from the Docket using only the keyboard.
- Tiling works entirely from the keyboard and persists between sessions.
- All tests pass, including the no-network, performance and accessibility checks.
- `docs/docket/` contains the inventory, a decisions log and a user-facing shortcuts reference.

## Questions to settle at Checkpoint 0

- What's the default Docket shortcut: Mod+K, or a double-tap of a modifier key?
- Should Peek or Pinned be the default mode?
- Are units and topics stored as folders, frontmatter or tags?
- Is the "Classic sidebars" fallback needed for existing users?
- Which panels should plugins be allowed to add, and should plugins be able to search locked content once it's unlocked?
