# Changelog

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
