# Docket: Phase 0 inventory

What Caselore has today (0.4.0, commit `47e36a5`/`479e2cc`), and where each piece goes once the Docket and
tiled tabs replace the sidebars. Written for Checkpoint 0 of `docs/docket/PLAN.md`.

## 1. Stack

| Area | What it is | Where |
|---|---|---|
| Shell | Electron 45 (main + sandboxed preload + renderer), `quire://` protocol, network blocked in the main process | `packages/app/src/main/` |
| UI framework | None: plain DOM through an Obsidian-shaped API (`createEl`, `Component`, `Modal`, `Setting`…) | `packages/api/src/` |
| State | Classes with event emitters (`Vault`, `MetadataCache`, `Workspace`, `CustomCss`, `Spellchecker`); config in `.quire/app.json` | `packages/api/src/app.ts` |
| Editor | CodeMirror 6 (lang-markdown + GFM, live preview, vim via `@replit/codemirror-vim`) | `markdown-view.ts`, `cm-setup.ts`, `live-preview.ts` |
| Layout | Tree of `WorkspaceSplit` → `WorkspaceTabs` → `WorkspaceLeaf`, with left/right sidedocks; saved to `.quire/workspace.json` | `packages/api/src/workspace.ts` |
| Plugins | ES modules loaded from `quire://app/plugins/<id>/main.js`; import map shares the app's API and CodeMirror | `app.ts` (`PluginManager`), `plugin.ts` |
| Tests | Vitest (API 19, AGLC4 565); Electron offscreen smoke test (55 checks); screenshot comparison (32 screens) in CI; offline audit; design-token CSS lint | `packages/api/test`, `plugins/aglc4/test`, `packages/app/src/renderer/smoke.ts`, `scripts/` |
| Build | esbuild; electron-builder (AppImage, deb, pacman, dmg, zip); GitHub Actions CI and release | `packages/app/build.mjs`, `.github/workflows/` |
| Platforms | Linux x64/arm64, macOS arm64/x64 (ad-hoc signed, not notarised) | |

## 2. Notes on disk

- A **homebase** (the plan says "vault") is a plain folder of `.md` files; any folder depth.
- **Frontmatter** (YAML) is parsed into the metadata cache; the AGLC4 plugin reads `aglc`, `aglc-headings`,
  `aglc-prompts` and similar properties.
- **Tags**: `#tag` and `#nested/tag` in text, and `tags:` in frontmatter.
- **Links**: `[[wikilinks]]`, `![[embeds]]`, Markdown links; resolved by name or path.
- **Attachments**: `attachments/` by default (setting).
- **App state**: `.quire/` (app.json, workspace.json, hotkeys.json, dictionary.txt, plugins.json, plugin data,
  themes, snippets); AGLC4 history in `.aglc-history/`.
- **No concept of subjects, topics or units yet**, and **no locking or encryption** of any kind.

## 3. Sidebars and chrome

### Left sidebar
| View | Functions | Shortcut | Code |
|---|---|---|---|
| **Files** (`file-explorer`) | Tree of folders and files; open (click), open in new tab (Ctrl-click, middle-click); new note, new folder, collapse all; context menu: new note/folder, open in new tab, open to the right, make a copy, rename, delete (to trash), show in system file manager, plus plugin items (`file-menu` event: AGLC4 version history, export Word/HTML, import .docx); drag to move; drag into editor to link | none (only `app:reveal-file` command) | `packages/app/src/renderer/explorer.ts` |
| **Search** (`search`) | Full-text search: words, "phrases", -exclusions, `path:`, `tag:`, match case; grouped results with highlighted lines; open at match | Mod+Shift+F | `renderer/panes/search.ts` |
| **Tags** (`tag`) | Every tag with counts, nested by `/`, sort by count/name; click searches `tag:` | none (`app:show-tags`) | `renderer/panes/tags.ts` |

### Right sidebar
| View | Functions | Shortcut | Code |
|---|---|---|---|
| **Backlinks** (`backlink`) | Linked mentions with the line of each link; unlinked mentions with a "Link" button | none (`app:show-backlinks`) | `renderer/panes/backlinks.ts` |
| **Outgoing links** (`outgoing-link`) | Links from the open note; unresolved links (click creates the note) | none | `renderer/panes/outgoing.ts` |
| **Outline** (`outline`) | Headings of the open note by level; click jumps; current heading marked | none | `renderer/panes/outline.ts` |
| **Pages** (AGLC4 `aglc4-page-preview`) | A4 page preview with footnotes, zoom in/out, fit width, refresh | none (`aglc-citations:page-preview`) | `plugins/aglc4/src/layout/view.ts` |
| **Version history** (AGLC4 `aglc4-version-history`) | Versions of the open note, diff, restore, name a version, copy, earlier exported files | none (`aglc-citations:show-version-history`) | `plugins/aglc4/src/history/view.ts` |

### Other chrome
| Element | Functions | Code |
|---|---|---|
| Ribbon (left strip) | App: quick switcher, command palette, new note. Plugins: version history, page preview. Bottom: open another homebase, settings | `workspace.ts`, `core.ts` |
| Tab strips | Tabs per pane, new tab (+), close (×, middle-click), context menu (close, split right, split down) | `workspace.ts` |
| Header line | View title and view actions (reading view toggle, explorer buttons, plugin buttons) | `view.ts` |
| Status bar (modeline) | Mode badge (EDIT/READ/vim mode), word/character count, toggle sidebars, AGLC4 problem count (click lists problems) | `core.ts`, AGLC4 `main.ts` |
| Command palette (Mod+P), quick switcher (Mod+O) | Fuzzy lists of commands and files | `core.ts` |
| Settings (Mod+,) | Editor, Files and links, Appearance, Hotkeys, Plugins, About; plugin pages; search | `settings-modal.ts`, `core.ts` |

## 4. Commands and shortcuts

Core (`packages/app/src/renderer/core.ts`), with current defaults (all remappable in Settings → Hotkeys):

| Command id | Name | Shortcut |
|---|---|---|
| app:command-palette | Command palette: Open | Mod+P |
| app:quick-switcher | Quick switcher: Open | Mod+O |
| app:search | Search: Search in all notes | Mod+Shift+F |
| app:open-settings | Open settings | Mod+, |
| app:new-note | Create new note | Mod+N |
| app:new-tab | New tab | Mod+T |
| app:close-tab | Close current tab | Mod+W |
| app:next-tab / app:previous-tab | Next / previous tab | Ctrl+Tab / Ctrl+Shift+Tab |
| app:toggle-reading | Toggle reading view | Mod+E |
| app:save | Save current file | Mod+S |
| app:rename-file | Rename file | F2 |
| editor:toggle-bold / -italics | Bold / italics | Mod+B / Mod+I |
| editor:insert-wikilink | Insert internal link | **Mod+K** (clashes with the plan's Docket key) |
| app:split-right, app:split-down, app:toggle-left-sidebar, app:toggle-right-sidebar, app:toggle-live-preview, app:delete-file, app:move-file, app:reveal-file, app:show-in-folder, app:new-folder, app:open-homebase, app:show-backlinks, app:show-outgoing-links, app:show-outline, app:show-tags, editor:toggle-highlight, editor:toggle-code, editor:toggle-strikethrough | — | none |

AGLC4 plugin (`aglc-citations:*`, 27 commands, no default shortcuts): insert footnote, cite a kind of source,
suggest next element, tidy footnotes, list problems, fix all, choose paragraph prompts, five paragraph-guide
commands, new legal essay, copy prompt set, create example essay, turn on/off for note, version history,
save named version, restore deleted note, insert bibliography, return from footnote, jump footnote/reference,
import Word, page preview, export Word, export HTML.

Editor keys: CodeMirror defaults, search (Mod+F), vim (when on); `[[` link completion; AGLC4 next-element
suggestions; Enter/Escape footnote return (AGLC4).

## 5. Search features and the plugin API

- **Search**: quick switcher (fuzzy file names), command palette (fuzzy command names), search pane
  (full-text, scans every note's cached text per query; **no index**), settings search, `[[` completion.
- **Metadata cache** (in memory only): frontmatter, headings, links, embeds, tags, footnotes; resolved links.
- **Plugin API** (`@quire/api`, Obsidian-shaped): `addCommand` (callback / checkCallback / editorCallback,
  hotkeys), `registerView`, `addRibbonIcon`, `addStatusBarItem`, `addSettingTab`, `registerEditorExtension`,
  `registerEditorSuggest`, `registerMarkdownPostProcessor`, `registerPalette`, events (`file-menu`,
  `editor-menu`, `active-leaf-change`, `file-open`, `editor-change`, `editor-cursor`…). Everything registered is
  undone on unload (`Component`). No `registerDocketPanel`, `registerSearchProvider` or `registerResultAction` yet.

## 6. Parity table

| Existing feature | Where it lives now | New home | Planned improvement |
|---|---|---|---|
| File tree, open, new note/folder | Files sidebar | **Units** panel (Mod+3) + commands | Subjects → topics → notes; recent and pinned; all from the keyboard |
| Rename, move, copy, delete, show in folder | Files context menu, commands | Units panel actions (→ / Mod+.) + `core.note.*` commands | Same actions on any search result |
| Drag to move, drag into editor to link | Files sidebar | Units panel "move to…" action; Shift+Enter "insert link" | Keyboard equivalent for both |
| Plugin file actions (version history, export, import Word) | `file-menu` event in Files | Result actions (`registerResultAction`) | Available from search results, not only the tree |
| Full-text search | Search sidebar | Docket input (no prefix) | Indexed, ranked, grouped by type; locked notes excluded |
| Tags | Tags sidebar | `#` prefix and Units panel | Combined with units and topics |
| Backlinks, unlinked mentions | Right sidebar | Result actions on a note ("Show links to…") + Units/Authorities | Also "every note citing this authority" |
| Outgoing links | Right sidebar | Result action; Outline panel section | — |
| Outline | Right sidebar | **Outline** panel (Mod+2) and `/` prefix | Move sections, promote/demote; case-brief fields |
| Page preview | AGLC4 view (right) | **Cite** panel (Mod+4) action or a pane (it is a view, so it can tile) | Open in a split from the Docket |
| Version history | AGLC4 view (right) | Vault panel (Mod+5) section or a pane | Reachable from the keyboard |
| AGLC4 problems list, fixes | Status bar + command | **Cite** panel | Inline in the panel |
| Cite a kind of source, next element | AGLC4 commands + editor | **Cite** panel | Builder UI; formatter module per edition |
| Bibliography, export Word/HTML | AGLC4 commands | Cite panel + Vault panel (export with confirm/redact) | Confirmation; redaction option |
| Command palette | Modal (Mod+P) | `>` prefix | Shortcuts shown; context-aware |
| Quick switcher | Modal (Mod+O) | Docket input (no prefix) | Ranked by recency/frequency |
| Settings search | Settings dialog | Settings search provider | Settings reachable from the Docket |
| Ribbon buttons | Left strip | Commands (and the Docket handle) | Ribbon removed in Phase 6 |
| Toggle sidebars | Commands, status bar | Retired with the sidebars | — |
| Splits, tabs | Tab strip, context menu, 2 commands | **Layout** panel (Mod+6) + tiling commands | Focus/move/resize/zoom/equalise from the keyboard; presets; reopen closed tab |
| Open another homebase | Ribbon, command | Vault panel + command | — |
| Status bar | Bottom | Stays (not a sidebar) | Unchanged |
| — (new) | — | **Authorities** panel (Mod+1) | Cases, legislation, secondary sources in the note; every note citing one |
| — (new) | — | **Vault** panel: lock status, lock/unlock, encryption | Needs locking and encryption, which do not exist yet |

## 7. Findings that affect the plan

1. **Shortcut clash:** Mod+K is "Insert internal link" today. The plan wants Mod+K for the Docket.
2. **No locking or encryption exists.** The plan's security rules (locked notes hidden from search,
   Authorities and previews; encrypted index) and the Vault panel need a design first: what is encrypted
   (single notes, folders, the whole homebase), key handling, and what "locked" means for files on disk that
   other apps can read. This is the largest piece of new work and should be its own phase.
3. **Logs contain file paths** in two places: `metadata.ts:188` (indexing errors) and `themes/manager.ts:192`
   (theme read errors). The plan forbids this; they will be fixed in Phase 1.
4. **No search index:** the search pane scans every note's text per query. That will not meet "under 16 ms
   per keystroke at 10,000 notes"; Phase 3 needs an in-memory index (allowed by the security rules).
5. **No 10,000-note fixture or benchmark** yet.
6. **The no-network test exists**: `scripts/offline-audit.mjs` fails on `fetch`, `XMLHttpRequest`, `WebSocket`,
   `EventSource`, `sendBeacon`, WebRTC, dynamic `import()` (except the plugin loader, allow-listed) and more,
   across source, bundles and plugins, and the smoke test checks that requests are refused at run time.
   It already has an explicit allow-list.
7. **Authorities and Cite can reuse the AGLC4 plugin:** its parser classifies 17 citation kinds
   (reported, unreported and medium neutral cases, legislation, treaties, journals, books, Hansard…) and its
   bibliography already groups cases, legislation and secondary sources. Detection in body text (not only
   footnotes) and section references (`s 18`) are new. `obsidian-legal-core` has an authority store that is
   not ported.
8. **Tiling exists in part:** splits and tabs work, but there is no keyboard focus movement between panes,
   resizing, zoom, equalise, reopen-closed-tab or presets.
9. **The command interface is Obsidian-shaped** (`callback`/`checkCallback`/`editorCallback`). The plan's
   registry fields (`when`, `run`, `section`, `requiresUnlocked`, `confirm`, `source`) can be added on top
   without breaking plugins (see decisions.md).
10. **"Vault" vs "homebase":** the app calls the folder a homebase; the plan's Vault panel would be the
    Homebase panel (or the plan keeps "Vault" for the lock/encryption panel only — question below).

## 8. Open questions for Checkpoint 0

From the plan:
1. Default Docket shortcut: **Mod+K** (moving "Insert internal link" to another key), or a double-tap of a modifier?
2. Default mode: **Peek** or **Pinned**?
3. Units and topics: **folders**, **frontmatter** (`unit:`, `topic:`), or **tags**? (Recommendation:
   folders for subjects/topics, since notes already live in folders and it maps cleanly to clients/matters
   later, with a frontmatter override.)
4. Is the **"Classic sidebars"** fallback needed? (Only you use Caselore so far.)
5. Which panels may plugins add, and may plugins search locked content once unlocked?

Raised by the inventory:
6. **Locking and encryption**: scope (note, folder, whole homebase), passphrase only or OS keychain, and
   whether to schedule it as its own phase before the Vault panel.
7. **Where Authorities and Cite live**: in core (always there) or provided by the AGLC4 plugin through
   `registerDocketPanel` (keeps the core general for the later lawyers' app; Cite already lives in the plugin)?
8. **Naming**: "Vault" panel, or "Homebase" to match the rest of the app?
9. **macOS signing**: still pending your Apple Developer account (separate from this plan).

## 9. Parity status at Checkpoint 4

Every row of the parity table (§6), and where it is now reachable from the Docket by keyboard alone.
✓ done · ◐ done with a gap noted · → later phase (named).

| Existing feature | Status | In the Docket |
|---|---|---|
| File tree, open, new note/folder | ✓ | Units (Mod+3): subjects → topics → notes; Enter opens, Mod/Alt+Enter splits; "New subject", "New note"; → on a folder: new note / new topic here |
| Rename, move, copy, delete, show in folder | ✓ | → on any note (search results, Units, Links lists) and on folders; also commands (`>rename` …) |
| Drag to move, drag into editor to link | ✓ | "Move to…" action; Shift+Enter inserts `[[link]]` at the cursor |
| Plugin file actions (version history, export, import Word) | ✓ | → on a note lists every plugin `file-menu` item (e.g. "Export to Word with AGLC4 footnotes") |
| Full-text search | ✓ | Docket input: "In notes" group, matched words marked (Phase 3) |
| Tags | ✓ | `#` prefix (tags and folders); Enter opens the tag search |
| Backlinks, unlinked mentions | ✓ | → "Notes linking here" lists each linking line; → "Mentions (not linked)" lists each mention, and → on one turns it into a link (after Checkpoint 4) |
| Outgoing links | ✓ | → "Links from this note"; Outline panel "Links" row; unresolved links create the note on Enter |
| Outline | ✓ | Outline (Mod+2): jump, Alt+↑/↓ move section, Alt+←/→ promote/demote, case-brief fields (add missing) |
| Page preview | ✓ | Cite panel → "Page preview"; opens as a normal tab (Phase 6), Mod+Alt+Shift+→ puts it beside the note |
| Version history | ✓ | Homebase panel → "Version history of this note"; → on a note (plugin action) |
| AGLC4 problems list, fixes | ✓ | Cite panel → "List citation problems", "Fix all fixable problems", "Tidy footnotes" |
| Cite a kind of source, next element | ✓ | Cite panel: builder for cases (reported, MNC), legislation, articles, books, government, Productivity Commission and law reform reports, web pages and treaties; full / Ibid / (n X) chosen automatically. The plugin's as-you-type suggestions stay via "Insert a footnote" |
| Bibliography, export Word/HTML | ✓ | Cite panel → "Insert a bibliography"; plugin exports via → on a note; Homebase → "Export…" (Markdown/HTML, confirm, redaction) |
| Command palette | ✓ | `>` prefix, shortcuts shown (Phase 2) |
| Quick switcher | ✓ | Docket input, ranked by use (Phase 3) |
| Settings search | ✓ | "Settings" group in the Docket (Phase 3) |
| Ribbon buttons | ✓ | Every ribbon button is a command (`>`), plugins' too; the ribbon is gone (Phase 6) |
| Toggle sidebars | ✓ | Gone with the sidebars (Phase 6); the status bar button opens the Docket |
| Splits, tabs | ✓ | Tiling commands (Mod+\, Mod+Alt+arrows, move, resize, equalise, zoom, reopen closed tab: Phase 5); Layout (Mod+6): presets, saved layouts, open panes |
| Open another homebase | ✓ | Homebase panel; command |
| Status bar | ✓ | Unchanged (not a sidebar) |
| Authorities (new) | ✓ | Authorities (Mod+1): cases, legislation (with sections), secondary sources; counts; Enter → next place; → every note citing it, cite it, confirm, merge; jurisdiction filter; `@` prefix |
| Homebase / lock (new) | → Locking phase | Homebase (Mod+5) shows "Not locked"; locking and encryption are their own phase (decision 10) |
