# Quire — plan

A local-first Markdown notes app in the spirit of Obsidian: a folder of plain `.md` files (a *vault*),
a fast editor, links between notes, and a plugin API. It runs entirely offline, and that is
enforced, not just intended. The first plugin is a port of `obsidian-aglc4` (AGLC4 Citations).

## Goals

1. **Plain files.** A vault is an ordinary folder. Notes are Markdown; app state lives in `<vault>/.quire/`.
   Nothing is locked in a database.
2. **Offline by construction.** The app cannot reach the network, even if a plugin tries (see *Offline
   guarantees*).
3. **Extensible.** Plugins add commands, views, editor extensions (CodeMirror 6), settings, status-bar
   items, ribbon icons and context-menu items, and can read and write the vault.
4. **Low porting cost.** The plugin API deliberately follows the shape of the API subset that existing
   plugins use (`Plugin`, `Vault`, `Workspace`, `MarkdownView`, `ItemView`, `Modal`, `SuggestModal`,
   `EditorSuggest`, `Setting`, `Notice`, …), so a plugin ports by changing its import to `@quire/api`
   plus a few touch points, not by being rewritten.

## Architecture

```
quire/
  packages/api/      @quire/api — the plugin API: runtime classes + types (shared by app and plugins)
  packages/app/      Electron app: main process, preload bridge, renderer (the UI)
  plugins/aglc4/     first plugin: AGLC4 citations (port of obsidian-aglc4)
```

**Shell: Electron.** The whole stack, including the existing plugin, is TypeScript + CodeMirror 6, and
Electron runs on Linux, macOS and Windows with no system webview differences. (Tauri would cut the
download size, but it needs a Rust toolchain and gives a different webview on each OS; it is worth revisiting
once the API is stable, because the renderer does not depend on Electron.)

| Process | Responsibility |
|---|---|
| **main** | windows, vault folder access (scoped to the vault root), file watching, native dialogs, trash, network block, `quire://` protocol |
| **preload** | a narrow `contextBridge` API: `fs.*` for vault-relative paths, `dialog.*`, `app.*`. No Node in the renderer. |
| **renderer** | the app UI and the plugin runtime. Owns the single copy of CodeMirror and `@quire/api`. |

### Plugin loading

- A plugin is a folder: `manifest.json`, `main.js` (an **ES module** whose default export is a `Plugin`
  subclass) and an optional `styles.css`. Built-in plugins ship in the app; others go in
  `<vault>/.quire/plugins/<id>/`.
- `main.js` is loaded with `import()` from `quire://plugin/<id>/main.js`. Bare imports (`@quire/api`,
  `@codemirror/state`, `@codemirror/view`, …) resolve through an **import map** to small shim modules
  that re-export the renderer's own instances, so plugins and the app share one CodeMirror. This needs
  no `eval`, so the Content-Security-Policy can forbid it.
- Enabled plugins are listed in `<vault>/.quire/plugins.json`; plugin data in `.quire/plugins/<id>/data.json`.
- Lifecycle: `onload()` → registrations are tracked by `Component` → `onunload()` and automatic cleanup
  when disabled, so a plugin can be turned on and off without a restart.

### Plugin API surface (v0)

| Area | API |
|---|---|
| Lifecycle | `Plugin` (`onload`, `onunload`, `loadData`, `saveData`), `Component`, `Events`/`EventRef` |
| Vault | `Vault` (`read`, `cachedRead`, `readBinary`, `create`, `createBinary`, `createFolder`, `modify`, `modifyBinary`, `process`, `delete`, `rename`, `getAbstractFileByPath`, `getMarkdownFiles`, events `create`/`modify`/`delete`/`rename`), `DataAdapter`, `TFile`, `TFolder` |
| Metadata | `MetadataCache` (`getFileCache` → frontmatter, headings, links, footnotes; `changed` event), `FileManager.processFrontMatter` |
| Workspace | `Workspace` (`getActiveFile`, `getActiveViewOfType`, `getLeaf`, `getRightLeaf`, `createLeafBySplit`, `getLeavesOfType`, `revealLeaf`, `iterateAllLeaves`, `setActiveLeaf`, `onLayoutReady`, events `active-leaf-change`, `file-open`, `editor-change`, `file-menu`, `resize`), `WorkspaceLeaf`, `View`, `ItemView`, `MarkdownView`, `Editor` (with `.cm`), `editorInfoField` |
| UI | `addCommand` (`callback`, `checkCallback`, `editorCallback`, `editorCheckCallback`, hotkeys), `addRibbonIcon`, `addStatusBarItem`, `addSettingTab`/`PluginSettingTab`, `Setting` + controls, `Modal`, `SuggestModal`, `EditorSuggest`, `Menu`, `Notice`, `setIcon` (Lucide, bundled) |
| Editor | `registerEditorExtension` (any CodeMirror 6 extension), `registerEditorSuggest` |
| Helpers | `debounce`, `normalizePath`, `Platform`, DOM helpers (`createEl`, `createDiv`, `el.empty()`, `addClass`, `setText`, `setCssStyles`, …) |
| Theme | CSS variables (`--text-muted`, `--background-modifier-border`, `--interactive-accent`, …) so plugin styles work in light and dark themes |

## Offline guarantees

1. **Network blocked in the main process.** Every `http(s)`, `ws(s)` and `ftp` request from any
   renderer is cancelled by `session.webRequest`. Only `quire://`, `file:`-free `data:` and `blob:` load.
2. **Content-Security-Policy** on the page: `connect-src 'none'`, scripts only from `quire:`, no `unsafe-eval`.
3. **No navigation, no new windows, no permissions:** `will-navigate` is prevented, `window.open` is
   denied, and every permission request (camera, geolocation, notifications…) is refused.
4. **No auto-update, telemetry or crash upload.** Nothing is configured, and the audit fails if any is added.
5. **Offline audit** (`npm run audit`) scans the app source, the built bundles and every plugin for
   `fetch`, `XMLHttpRequest`, `WebSocket`, `eval`, `new Function`, `openExternal`, remote URLs in CSS and
   so on (the same rules as the AGLC4 plugin's audit). It is part of `npm test`.
6. **Smoke test with the network off:** `npm run smoke` boots the app offscreen against a test vault, loads
   the plugins, runs commands and checks that no request was attempted.

## Phases

### Phase 1 — Core app (MVP) ✅ done
- Open a folder as a vault; recent vaults; reopen the last one on start.
- File explorer: tree, new note/folder, rename, delete (to the system trash), context menu with plugin items.
- Workspace: tabs, splits (side by side and above/below), right sidebar for plugin views.
- Editor: CodeMirror 6, Markdown/GFM highlighting, headings sized, footnotes and `[[wikilinks]]` styled,
  Ctrl/Cmd-click to follow a link, autosave, external changes reloaded.
- Reading view (Ctrl/Cmd+E): Markdown rendered with footnotes and wikilinks, sanitised.
- Command palette (Ctrl/Cmd+P), quick switcher (Ctrl/Cmd+O), settings (appearance, editor, plugins, plugin tabs).
- Metadata cache (frontmatter, headings, links, footnotes) and `processFrontMatter`.
- Plugin runtime with the v0 API above; built-in plugins enabled per vault.
- Light and dark themes: the default look follows DoomEsque (doom-crisp-dark / doom-crisp-light palettes,
  modeline status bar, flat tabs with a top accent bar, Treemacs file tree, rainbow Org-style headings, M-x prompt).
- Offline enforcement, offline audit and smoke test.

### Phase 2 — AGLC4 plugin ✅ done
- Port `obsidian-aglc4` 1.16.0 to `plugins/aglc4`:
  - **Unchanged:** `aglc/*`, `footnotes`, `export/*`, `import/*`, `layout/{paginate,metrics,headings,preview}`,
    `history/{store,diff}`, `prompts/{engine,sets}`, `scope`, `example`, `editor/{context,snippet}`.
  - **Import swap only** (`obsidian` → `@quire/api`): `editor/{extension,guide,suggest}`, `history/{manager,view}`,
    `layout/view`, `prompts/ui`, `settings`, `main`.
  - Settings use the classic `display()` form; the declarative form is not in API v0.
- Carry over its test suite (vitest) and offline audit; all must pass.
- Feature parity checklist: live underlining with hover fixes, insert-a-kind-of-source with Tab
  placeholders, next-element popup and ghost hint, footnote pane, tidy/renumber and `(n X)` sync, Word and
  HTML export, page preview, Word import, version history, paragraph prompts, assignment scoping, example essay.

### Status (2026-11-24)

Phases 1 and 2 are built and verified:

- `npm test`: typecheck of all three packages, 13 API tests, the plugin's full suite (565 tests, unchanged
  from the original apart from the import alias), production build, offline audit of source, bundles and plugins.
- `npm run smoke`: 23 end-to-end checks pass offscreen. The page's `fetch` is refused by the CSP; the
  main process's request is cancelled by the session's network block.
- Port size: 9 of the plugin's source files differ from the original, and in each the only change is the
  import line (`obsidian` → `@quire/api`). API changes the port
  needed: `appendText`, private-name clashes in base classes (now `_`-prefixed), and a refresh of editor
  extensions when a pane becomes active. The plugin relies on that refresh for its status bar after "open in new tab".
  Since 0.12: `history/view.ts` and `styles.css` also differ, for keyboard navigation of the version history
  (a re-sync from the original must keep those changes).

Known gaps, deliberately left for later phases:
- **Spellcheck is off.** Electron downloads Hunspell dictionaries from the web; bundling dictionaries
  is Phase 3.
- Declarative settings (`getSettingDefinitions`) are typed but not rendered; plugins' `display()` is used.
- The AGLC4 user guide in `plugins/aglc4/docs/` still says "Obsidian" in places.
- No packaged installers yet (run from source with `npm start`).

### Status (later on 2026-11-24)

- Done: homebase naming, theming (palettes, accent, fonts, density, icon sets, CSS themes and snippets),
  Phosphor icons. See docs/theming.md and docs/design/.
- Next: the polish plan in docs/design/polish-plan.md (tokens, header bands, explorer grid, rows,
  settings control column).
- The AGLC4 plugin's own text still says "vault" in a few settings (history and export folders); it is
  left as written in the plugin to keep the port to the import line.

### Phase 3 — Everyday parity

Progress:
- [x] Full-text search pane (words, "phrases", -exclusions, `path:`, `tag:`, match case; Ctrl/Cmd+Shift+F).
- [x] Backlinks (linked and unlinked mentions, with "Link" to turn a mention into a link), outgoing links,
      tags (nested, with counts; click to search), outline (follows the cursor).
- [x] `[[` link autocomplete, with `#` for headings.
- [x] Rename a note updates links to it (since 0.1); workspace layout saved and restored (since 0.1).
- [x] Customisable hotkeys (Settings → Hotkeys; per homebase in `.quire/hotkeys.json`); vim mode (Editor
      settings; `:w`, `:q`, `:wq`; the modeline shows the vim mode).
- [x] Attachments and embeds: paste or drop files (Files and links → Folder for attachments); pictures shown
      under their embed in the editor; notes, sections and pictures embedded in the reading view (3 levels deep).
      Footnotes inside an embedded section are not resolved yet.
- [x] Live preview (default; Editor settings or "Toggle live preview / source mode"): formatting marks hidden
      and links, bullets, task boxes, quotes and rules drawn, except on the lines being edited and in %% comments.
      Footnote syntax is left as written for the AGLC4 plugin. Code blocks are shown as written; tables are drawn (since 0.15).
- [x] Offline spellcheck: nspell (MIT) with SCOWL Hunspell dictionaries for English (Australia, default), British
      and US English. Licences reviewed: SCOWL's permissive notices, Ispell's BSD licence and WordNet's notice
      require the notices to ship, so `THIRD_PARTY_NOTICES.txt` (every bundled library and dictionary) is built
      into the app and shown under Settings → About → Licences. Footnotes are not checked unless turned on.

Phase 3 is complete.

Items:
- Full-text search pane; backlinks and outgoing links; tags pane; outline pane.
- `[[` link autocomplete; rename a note updates links to it.
- Live preview (render Markdown inline outside the cursor line).
- Customisable hotkeys; vim mode (the AGLC4 plugin already checks `vault.getConfig('vimMode')`).
- Workspace layout saved and restored per vault.
- Attachments: paste/drop images into `attachments/`; embeds `![[...]]`.

### Phase 4 — Ecosystem
- Install plugins from a local folder or `.zip` (never from the network); per-plugin permission summary
  derived from the audit.
- Port the other local plugins (`legal-core`, `inline-autocomplete`, `task-docket`, `outline-to-draft`,
  `whole-tree-search`, …) — each needs only the API surface it uses; extend API v0 as required.
- Declarative settings (`getSettingDefinitions`) so settings render natively and are searchable.
- Theme API and community-style CSS snippets in `.quire/snippets/`.
- Packaging: AppImage/pacman package (Linux), dmg, NSIS; reproducible builds with build attestations.

## Testing

- `packages/api`: unit tests for vault indexing, path normalisation, frontmatter round-trips, events.
- `plugins/aglc4`: the original suite (citation corpus, footnotes, export golden files, import, history crash
  simulation, prompts, docs coverage).
- `npm run smoke`: Electron offscreen boot → open fixture vault → enable plugin → run AGLC4 commands
  (create example essay, list problems, export to Word) → screenshot → assert no network attempts and no
  console errors.
- `npm run audit`: offline audit over everything that ships.

## Risks

- **API drift from the source plugin.** If `obsidian-aglc4` moves on, the port diverges. Mitigation: the
  unchanged modules are copied verbatim, so a re-sync is a file copy plus re-running the tests; later,
  move them into a shared package that both builds consume.
- **Electron size (~100 MB).** Acceptable for a desktop app; revisit Tauri in Phase 4.
- **Page preview fidelity** depends on fonts installed (Times New Roman); it falls back as the original does.
