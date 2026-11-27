# Docketeer

A Markdown notes app in the spirit of Obsidian that runs **entirely offline**: a vault is a folder of
plain `.md` files (a **homebase**), and the app cannot reach the network — every request is blocked by the app itself,
whatever a plugin tries. Plugins add commands, views, CodeMirror 6 editor extensions, settings and more.

You can create a generic homebase or an Australian law student friendly homebase at the moment.

Four plugins ship built in: **AGLC4 Citations** (`plugins/aglc4`), a port of
[obsidian-aglc4](https://github.com/blursedperf/obsidian-aglc4) 1.16.0; **Task Docket** (`plugins/task-docket`),
a port of [obsidian-task-docket](https://github.com/blursedperf/obsidian-task-docket) 1.1.0 that shows every task in
the homebase in a Tasks panel in the Docket; and **Whole-Tree Search** (`plugins/whole-tree-search`), a port of
[obsidian-whole-tree-search](https://github.com/blursedperf/obsidian-whole-tree-search) 1.2.3: type `~` in the Docket
to find words in your outlines, each match with the heading above it, its parents and what is nested under it; and
**Pomodoro Flashcards** (`plugins/pomodoro-flashcards`), a port of
[obsidian-pomodoro-flashcards](https://github.com/blursedperf/obsidian-pomodoro-flashcards) 1.0.12: flashcards
written in your notes and your case briefs, studied with spaced repetition beside a focus timer, with a Study panel
in the Docket.

I love Obsidian but I'm always using my laptop and the side bar solution takes up too much realestate and I wanted a keyboard first solution that would allowing me to barely have to take my hands of the keyboard while creating and placing notes, editing, searching etc. Everything is reached from the keyboard through **the Docket**, a tray that drops from the top of the window
(**Super+D**: ⌘D on macOS, Ctrl+P on Windows): search across notes, commands, and panels for authorities, the outline, units
(subjects and topics), citations, the homebase and the layout. Panels can be hidden, reordered, and built from
commands, file trees, note lists and sections ([docs/docket/panels.md](docs/docket/panels.md)). Notes tile into panes from the keyboard. See
[docs/docket/shortcuts.md](docs/docket/shortcuts.md) and [docs/docket/walkthrough.md](docs/docket/walkthrough.md). At the moment you can start with a generic homebase

To look around first, choose *Try the example homebase* on the welcome screen (or *Switch homebase* → *Open the
example homebase*): sample law notes with a case brief, a lecture recording and a reading, copied into "Docketeer
example" in your Documents. Its source is in [packages/app/example](packages/app/example).

See [PLAN.md](PLAN.md) for the architecture, the plugin API and the roadmap.

## Install

Download from the [releases](../../releases): a `.dmg` for macOS (Apple Silicon or Intel), an AppImage
for any Linux, a `.pacman` package for Arch/Omarchy or a `.deb` for Debian/Ubuntu. The macOS app is not
notarised: after copying it to Applications, run `xattr -dr com.apple.quarantine /Applications/Docketeer.app`
once.

## Run from source

```bash
npm install
npm start            # build and open Docketeer (choose a folder as a homebase)
```

Pass `--homebase=/path/to/folder` after `npm start --` to open a folder directly.

## Develop

```bash
npm run build        # plugins, then the app (packages/app/dist)
npm test             # typecheck, API tests, AGLC4 tests (565), build, offline audit
npm run smoke        # boot the app offscreen on a throwaway homebase and drive it end to end
npm run shots        # screenshots of every surface in several palettes, densities and icon sets
npm run shots:diff -- <dir>   # compare them with test/visual/<platform>/ (--update to accept)
npm run audit        # offline audit only
npm run dist         # installers for this OS in packages/app/release
```

Releases are built by `.github/workflows/release.yml` when a `v*` tag is pushed: tests and the smoke
test first, then packages on Linux x64, Linux arm64 and macOS, then a GitHub release with checksums and
build attestations.

`npm run smoke` prints a JSON report (23 checks: vault indexing, editing, links, rename, the AGLC4
plugin's underlines, fixes, Word/HTML export, footnote pane, page preview, settings, and that requests
from both the page and the main process are refused) and saves a screenshot. Set `QUIRE_SMOKE_OUT` to
choose where.

| Path | What |
|---|---|
| `packages/api` | `@quire/api`: the plugin API (vault, metadata, workspace, editor, UI) — the app's renderer runtime |
| `packages/app` | Electron shell: `src/main` (main process, preload), `src/renderer` (core UI, theme, smoke test) |
| `plugins/aglc4` | AGLC4 Citations |
| `plugins/task-docket` | Task Docket: the Tasks panel |
| `plugins/whole-tree-search` | Whole-Tree Search: `~` in the Docket searches outlines |
| `plugins/pomodoro-flashcards` | Pomodoro Flashcards: flashcards, spaced repetition, a focus timer and the Study panel |
| `scripts/offline-audit.mjs` | fails the build if anything shipped could reach the network or run generated code |

## Themes

Settings → Appearance has 16 palettes (from DoomEsque), an accent colour, fonts, density and the icon
set (Phosphor by default). Themes and CSS snippets are files in `<homebase>/.quire/`; see
[docs/theming.md](docs/theming.md). Design notes: [icon sets](docs/design/icons.md),
[polish plan](docs/design/polish-plan.md).

## Writing a plugin

A plugin is a folder in `<homebase>/.quire/plugins/<id>/` with `manifest.json`, `main.js` and optionally
`styles.css`. `main.js` is an **ES module** whose default export extends `Plugin`:

```ts
import { Notice, Plugin } from '@quire/api';

export default class Hello extends Plugin {
	async onload() {
		this.addCommand({ id: 'hello', name: 'Say hello', callback: () => new Notice('Hello') });
	}
}
```

Bundle with esbuild (`format: 'esm'`), marking `@quire/api`, `@codemirror/*` and `@lezer/*` external:
the app supplies its own instances at run time through an import map. `plugins/aglc4/esbuild.config.mjs`
is a working example. The API follows the shape of Obsidian's for the parts it covers, so most plugins
port by changing `from 'obsidian'` to `from '@quire/api'`. Docketeer calls the folder of notes a *homebase*;
the API keeps the name `app.vault` (with `app.homebase` as an alias) so existing plugins work unchanged.
