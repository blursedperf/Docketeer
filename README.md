# Quire

A Markdown notes app in the spirit of Obsidian that runs **entirely offline**: a vault is a folder of
plain `.md` files (a **homebase**), and the app cannot reach the network — every request is blocked by the app itself,
whatever a plugin tries. Plugins add commands, views, CodeMirror 6 editor extensions, settings and more.

The first plugin, **AGLC4 Citations** (`plugins/aglc4`), is a port of
[obsidian-aglc4](https://github.com/blursedperf/obsidian-aglc4) 1.16.0 and ships built in.

See [PLAN.md](PLAN.md) for the architecture, the plugin API and the roadmap.

## Install

Download from the [releases](../../releases): a `.dmg` for macOS (Apple Silicon or Intel), an AppImage
for any Linux, a `.pacman` package for Arch/Omarchy or a `.deb` for Debian/Ubuntu. The macOS app is not
notarised: after copying it to Applications, run `xattr -dr com.apple.quarantine /Applications/Quire.app`
once.

## Run from source

```bash
npm install
npm start            # build and open Quire (choose a folder as a homebase)
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
port by changing `from 'obsidian'` to `from '@quire/api'`. Quire calls the folder of notes a *homebase*;
the API keeps the name `app.vault` (with `app.homebase` as an alias) so existing plugins work unchanged.
