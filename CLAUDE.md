# Docketeer (formerly Quire): notes for coding agents

A local-first, offline Markdown notes app for law students: a folder of plain `.md` files (a *homebase*), a
CodeMirror 6 editor with live preview, the **Docket** (a keyboard-first tray of search and panels), tiling panes,
and a plugin API shaped like Obsidian's. GitHub: **blursedperf/Docketeer** (renamed from blursedperf/quire;
GitHub redirects the old URL). Default branch: **`master`**. History is kept linear.

Read `PLAN.md` for the design and its *Offline guarantees*; read **`docs/mobile/PLAN.md`** before any iOS work.

## Layout

| Path | What |
|---|---|
| `packages/api` | `@quire/api`: the plugin API and the renderer's runtime (vault, metadata cache, workspace, editor, live preview, Docket registry). `src/host.ts` is the contract with the platform (`window.quire`). |
| `packages/app` | Electron app: `src/main` (main process, preload bridge, `quire://app/` protocol, network lockdown), `src/renderer` (core UI, Docket, panels, `smoke.ts` end-to-end checks and screenshots), `build.mjs` |
| `packages/ios` | iOS shell, in progress (see *Mobile port* below) |
| `plugins/aglc4` | Built-in plugin: AGLC4 citations (footnotes, checks, Word/HTML/PDF export) |
| `plugins/task-docket` | Built-in plugin: the Tasks panel in the Docket |
| `plugins/whole-tree-search` | Built-in plugin: `~` in the Docket searches outlines (`src/parser.ts` is the Obsidian plugin's, as it was) |
| `scripts/offline-audit.mjs` | Fails the build on any network API in shipped code |
| `test/visual/linux/` | Screenshot references compared by CI |

Internal names keep "quire" on purpose (`@quire/api`, `quire://`, `window.quire`, the `.quire/` folder in each
homebase, `quire.json`, the locked-note format): see `docs/mobile/decisions.md` §1. Don't rename them.

## Commands

```bash
npm ci
npm test          # typecheck, CSS token lint, unit tests (api, app, both plugins), build, offline audit
npm run smoke     # builds, then runs the Electron app headless through every end-to-end check (~1 min)
npm run shots     # screenshots; set QUIRE_SMOKE_OUT=<dir> to choose where they go
node scripts/shots-diff.mjs <dir> --platform linux   # compare with test/visual/linux/
```

- `npm test` and `npm run smoke` must both be green before any commit you call done.
- **The smoke run shares the app's real settings file** (`~/.config/Docketeer/quire.json` on Linux,
  `~/Library/Application Support/Docketeer/quire.json` on macOS). It is guarded: test runs never write it, and
  the run reports `settingsUntouched: false` if it changed. Never write that file from tests.
- The smoke run has a 120-second guard (`packages/app/src/main/main.ts`); it takes about 60 s on a fast machine.
- In smoke checks, closing a tab (`leaf.detach()`) is asynchronous: wait (`await sleep(80)`) before counting.
  Reopen `Welcome.md` before deleting a note that is open, or later checks break.

## House style

- Tabs, TypeScript strict, Australian/British spelling in UI text and docs ("colour", "licence").
- Short, plain doc comments that say what something is for; names a user would recognise in UI text.
- `CHANGELOG.md`: an `## Unreleased` section at the top; one bold lead per change, written for users (what it does,
  where to find it), then a short "For plugins:" note when the API changed.
- One commit per change, with a message saying what changed. End commit messages with the
  `Co-Authored-By:` line your harness gives you.
- **Offline is absolute.** No network APIs, analytics, crash reporting or dependencies that reach the network.
  New code paths must pass `scripts/offline-audit.mjs`; extend it when you add a new kind of code.

## Releasing (desktop)

1. Work on a feature branch. Push it and run CI on it: `gh workflow run ci.yml --ref <branch>` (CI only runs by
   itself on `master` and pull requests).
2. If the **screenshots** job fails because screens changed on purpose, download the run's `screenshots`
   artifact, copy its PNGs (not `quire-smoke.png`) into `test/visual/linux/`, check each changed screen still
   shows what it is for, and commit "Screenshot references: … (from CI run N)". Run CI again until it is green.
   Screens must not depend on the date (use dates relative to today in what they show).
3. Release commit "Release X.Y.Z: <summary>": bump `version` in `package.json`, `packages/api/package.json`,
   `packages/app/package.json`, `packages/ios/package.json`, `package-lock.json` (root and the three packages),
   `apiVersion` in `packages/api/src/index.ts` and both `MARKETING_VERSION`s in
   `packages/ios/Docketeer/Docketeer.xcodeproj/project.pbxproj`; turn `## Unreleased` into `## vX.Y.Z`.
4. Fast-forward `master` to the branch. If `master` moved (the owner sometimes edits files on GitHub), rebase the
   branch onto it and `git push --force-with-lease` first.
5. Tag `vX.Y.Z` (annotated, "Docketeer X.Y.Z: <summary>") and push `master` and the tag. The tag runs
   `.github/workflows/release.yml`: tests, installers for Linux (x64, arm64) and macOS, and the GitHub release.

Latest release: **0.24.2** (a settings gear in the status bar; Whole-Tree Search shows its outlines in full). Ask the owner before pushing tags or releasing.

## Mobile port (iPhone and iPad)

Follow **`docs/mobile/PLAN.md`** in order: it has the rules for agents (§0), the architecture (a thin Swift
`WKWebView` shell, a `quire://` scheme handler, a bridge with the same channel names as `preload.ts`) and the
phases with checkboxes. Record decisions in `docs/mobile/decisions.md`. Stop and ask where the plan says to.

State on 2026-11-27:

- **The owner's devices, in order: macOS, then iPhone; the iPad is a distant third** (`docs/mobile/decisions.md` §8).
  Phase 2 is now the iPhone, with full editing; Phase 3 is the iPad, later and trimmed.
- **Phases 0 and 1 are done** on branch `ios-scaffold` (pushed): the Swift shell (`packages/ios/Docketeer/`), real
  homebases from the folder picker, iCloud (change watching, the conflict guard, downloads, conflict versions),
  streaming media, and the page's smoke checks in WebKit (`npm run test:xcode -w @quire/ios`, about 70 s).
  Phase 1's exit check (syncing with the Mac both ways, a forced conflict) is waiting for the owner, on the iPhone.
- **Phase 2's tasks are done** (the compact layout, the Docket from the bottom, the keyboard toolbar, long-press
  menus, Share… and Export to PDF, pinch zoom, touch density, background locking, an iPhone-sized smoke run and
  iPhone screenshots: `npm run shots:ios -w @quire/ios`, baselines in `test/visual/ios/`). Its exit check is the
  owner using it daily on the iPhone for a week. **Face ID unlock is designed in `docs/docket/locking.md` and
  waits for the owner's sign-off: do not build it before then.**
- `master` is at the 0.22.0 release, with `ios-scaffold` merged into it. Fast-forward `master` when the owner asks.
- Debug builds take `-openExample` (opens the example homebase); temporary `console.warn` lines reach the system
  log through the console relay, which is how layout was measured on the simulators.
- The native tasks need **macOS with Xcode**. On Linux, do the TypeScript tasks only and list what is left.

Setting up on a Mac:

```bash
xcode-select --install            # if `xcodebuild -version` fails; also open Xcode once to install components
gh repo clone blursedperf/Docketeer && cd Docketeer
git checkout ios-scaffold
npm ci && npm test
claude                            # Claude Code, started in the repo folder
```

To run on a device: connect the iPhone or iPad, trust the Mac, turn on Developer Mode (Settings → Privacy &
Security), pick a signing team in the Xcode project, then build to the device.

Open questions for the owner are listed in `docs/mobile/PLAN.md` §6 (minimum iOS version, Face ID unlock,
several iPad windows, the Syncthing client, bundle id).
