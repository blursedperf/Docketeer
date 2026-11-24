# Changelog

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
