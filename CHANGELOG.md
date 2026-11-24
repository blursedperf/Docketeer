# Changelog

## Unreleased

- **Search.** A search pane (Ctrl/Cmd+Shift+F, or the search tab in the left sidebar) finds text in every
  note: all the words, `"exact phrases"`, `-excluded` words, `path:` and `tag:` filters, match case. Results
  show each matching line; click to go there.
- **Backlinks and outgoing links.** The right sidebar shows which notes link to the open note, with the
  line each link is on, and notes that mention it without a link (one click makes it a link); and where the
  open note links to, including links to notes not written yet.
- **Tags and outline.** Every tag with its count, nested by `/` (click to search for it); the open note's
  headings, with the one the cursor is under marked.
- **Link completion.** Type `[[` for notes and files by name, then `#` for headings.
- Suggestions open when you type, not when a plugin or a command changes the text.
- **Hotkeys.** Settings → Hotkeys lists every command: add a hotkey by pressing it, remove one, or go back
  to the default. Clashes are flagged. Saved per homebase in `.quire/hotkeys.json`.
- **Vim mode.** Settings → Editor → Vim key bindings (codemirror-vim, MIT): modes, motions, operators,
  `:w` to save, `:q` to close the tab, `:wq`. The modeline badge shows NORMAL, INSERT, VISUAL.
- Auto-pair brackets now applies to open notes straight away.
- **Attachments.** Paste a picture (a screenshot, say) or drop files into a note: they are saved in the
  attachments folder (Settings → Files and links; the homebase's `attachments/` by default, or beside the
  note) and embedded (`![[picture.png]]`) or linked. A note dragged from the file tree becomes a link.
- **Embeds.** Pictures show under their `![[…]]` (or `![](…)`) line in the editor, at a width with
  `![[picture.png|300]]`. In the reading view `![[Note]]` and `![[Note#Heading]]` show the note or section
  in a framed box; other files show as a card. API: `fileManager.getAvailablePathForAttachment`.
- **Live preview**, on by default: Markdown is shown formatted while you write — headings without `#`,
  bold and italics without their marks, links as their text (click to open), bullets, task boxes you can
  tick, quotes and rules. The lines holding the cursor or a selection, and `%% comments %%`, show the
  Markdown as written. Footnotes are left as written. Turn it off in Settings → Editor, or with "Toggle
  live preview / source mode".
- **Spellcheck, offline.** Misspelled words are marked as you write; right-click for suggestions, "Add to
  dictionary" (saved in `.quire/dictionary.txt`) or "Ignore". English (Australia) by default, or British or
  US English (Settings → Editor → Spelling). Code, links, web addresses, frontmatter and — unless turned on
  — footnotes are not checked. The dictionaries ship with Quire; the browser's own spellchecker, which
  downloads dictionaries, stays off.
- **Editor menu.** Right-click in a note for spelling, cut, copy, paste and select all; plugins can add
  items through the `editor-menu` event.
- **Licences.** Settings → About → Licences shows the licences of every library, icon set and dictionary
  Quire includes.

## v0.3.0

- **Settings search.** A search box above the settings pages finds settings on every page, plugins'
  included; the results are the settings themselves, ready to change.
- **Contrast guard.** Every text colour is checked against the surface it is shown on (WCAG AA) whatever
  the palette or accent, and adjusted only where it falls short (modeline badge and key labels in some
  light palettes).
- **Ribbon.** App actions and plugin actions are separate groups.
- **Screenshot checks.** `npm run shots` is repeatable, `npm run shots:diff` compares with reference
  images, and a CI workflow runs tests, the smoke test and the comparison on every push.

## v0.2.0

- **Homebase.** The folder of notes is now called a homebase everywhere in the app (welcome screen,
  commands, settings, dialogs). `--homebase=<folder>` opens one directly. The plugin API keeps
  `app.vault`, with `app.homebase` as an alias.
- **Theming.** Settings → Appearance: 16 palettes for dark and light mode (from DoomEsque), accent colour,
  interface/text/monospace fonts, text size, density (compact, comfortable, spacious), icon set and
  weight, installed CSS themes (`.quire/themes/`) with a starter template, and CSS snippets
  (`.quire/snippets/`). Themes and snippets that would load anything from outside the app are refused.
  Plugin API: `app.customCss`, `Plugin.registerPalette`, `ColorComponent` / `Setting.addColorPicker`.
- **Icons.** Phosphor (MIT) replaces Lucide as the default icon set, in four weights; Lucide stays as an
  option and as the fallback. Plugins still use Lucide names. See docs/design/icons.md.
- **Design.** A polish plan for spacing and alignment (docs/design/polish-plan.md), and `npm run shots`
  to capture every surface for review.
- **Polish.** The stylesheet is rebuilt on design tokens (4px spacing grid, four UI text sizes, fixed row,
  control and band heights), enforced by a lint in `npm test`. Tab strips and header lines line up across
  all three columns; file and folder names share a column; one row style for menus, palette and
  switcher; settings controls in one column with a title bar; a focus ring everywhere; notices at the
  bottom right; the modeline badge shows the mode. An empty tab is reused instead of left behind.

## v0.1.0

First release of Quire: Markdown notes in plain files, entirely offline, extensible with plugins.

- **Offline by construction.** Every network request from the app or a plugin is cancelled by the app
  itself; the page's security policy blocks connections and `eval`; no updates, telemetry or crash
  reports. An offline audit runs on every build.
- **Notes.** Vaults are ordinary folders. File explorer, tabs and splits, Markdown editor with
  `[[links]]`, footnotes and frontmatter, reading view, command palette, quick switcher, link updates on
  rename.
- **Plugins.** An API in the shape of the Obsidian API subset plugins use, so plugins port by changing
  their import to `@quire/api`. Vault plugins go in `<vault>/.quire/plugins/`.
- **AGLC4 Citations** built in (port of obsidian-aglc4 1.16.0): live checking with fixes, next-element
  suggestions, footnote pane, Word and HTML export with real footnotes, page preview, Word import,
  version history and paragraph guides.
- **DoomEsque look**: doom-crisp dark and light palettes, modeline, Treemacs file tree, Org-style headings.

Known limitations: spellcheck is off (Electron's dictionaries are downloaded from the web); the macOS
build is not notarised (see the release notes to open it).
