# Docketeer for iPhone and iPad: implementation plan

This plan is written for a coding agent such as Claude Code. Work through it in order and check off tasks
(`- [x]`) in this file as you finish them.

**Goal.** Build one universal iOS app from this repository:

- **iPhone:** the owner's second device, after macOS. It is for reading, search, quick capture, tasks and AGLC4
  citation checks, and comfortable for real writing: footnotes, citing and exports (decisions.md §8).
- **iPad:** a distant third. It gets what the iPhone has, in the regular layout; the rest of iPad parity waits.

Both run the same code. The layout depends on the window's width, not on the device.

**Not in scope:** Android, sync built into Docketeer, and plugins loaded from the homebase.

---

## 0. Rules for the agent

Read this section before every phase.

1. **Offline is absolute.** Docketeer must never reach the network (see `PLAN.md` → *Offline guarantees*). Don't
   add any dependency, SDK, Swift package or Capacitor plugin that uses the network. Don't use `URLSession`,
   `NWConnection`, `URLRequest` or web sockets in Swift. Don't add analytics or crash reporting. iCloud Drive
   and Syncthing move files at the OS level, outside Docketeer.
2. **The desktop app must not change behaviour.** `npm test` and `npm run smoke` must stay green on Linux after
   every commit. Changes to `HostBridge` (`packages/api/src/host.ts`) are **additive and optional**, and you
   update the Electron host (`packages/app/src/main/preload.ts`, `main.ts`) in the same commit.
3. **`host.ts` is the contract.** The renderer, `@quire/api` and the plugins talk to the system only through
   `window.quire`. Keep it that way. Don't import platform code into the renderer.
4. **Match the house style.** Use tabs, TypeScript strict, and Australian/British spelling in UI text and docs
   ("colour", "licence"). Keep the short, plain doc comments used across the codebase.
5. **Small commits.** Make one commit per task, with a message saying what changed and why. Don't push tags,
   and don't touch `release.yml` until Phase 4.
6. **Stop and ask** when:
   - a phase's exit check needs a person, such as trying it on a device;
   - a decision isn't settled here;
   - something here turns out to be wrong.
   Write what you found in `docs/mobile/decisions.md` and summarise it for the user.
7. **macOS is needed for the native parts.** If you are running on Linux, do the TypeScript tasks only. Say
   which native tasks are left, and don't try to fake Xcode output.
8. **Security-sensitive work needs a sign-off.** This covers locking, keys, path checks and the scheme handler.
   Write the design first, then get the user's sign-off before you implement it.

---

## 1. What exists today

| Path | What it is | Relevance |
|---|---|---|
| `packages/api/src/host.ts` | `HostBridge`, `HostFs`, `getHost()` (reads `globalThis.quire`) | The interface the iOS host implements |
| `packages/app/src/main/preload.ts` | The desktop bridge: `window.quire` over Electron IPC (~25 calls) | Reference for every method's behaviour |
| `packages/app/src/main/main.ts` | Main process: IPC handlers, the `quire://app/` protocol, `lockDown()` network block, CSP header | Port its responsibilities to Swift |
| `packages/app/src/main/vault-files.ts` | Serves homebase files over `quire://app/vault/` with Range support; `vaultType()` allow-list | Port to Swift |
| `packages/app/src/main/homebase-layout.ts`, `example.ts`, `fonts.ts` | New-homebase layout, example homebase, system fonts | Port (fonts: bundled only) |
| `packages/app/build.mjs` | Builds `dist/renderer/` (renderer.js, modules/ shims, import map, index.html, csp.txt, pdf/, fonts/), bundles plugins and the example | Reuse; add an iOS target |
| `packages/app/src/renderer/main.ts` | Renderer entry; calls `getHost()` synchronously at start | Needs `window.quire` installed **before** it loads |
| `packages/api/src/util.ts` → `Platform` | Hard-coded desktop flags (`isMobile: false`, `isIosApp: false`, …); `isMacOS` from the UA | Must come from the host on iOS (an iPhone's UA also matches `/Mac OS X/`) |
| `packages/api/src/workspace.ts:1359`, `app.ts:715` | Save and load `.quire/workspace.json` (pane layout) | Needs a separate file per device |
| `packages/app/src/renderer/tiling.ts`, `docket/` | Panes and the Docket | Compact layout on iPhone |
| `packages/api/src/lock/` | Locked notes (Web Crypto) | Works in WKWebView; locking on background is new |
| `plugins/aglc4`, `plugins/task-docket` | Built-in plugins | Bundled. AGLC4 exports write into the homebase with `vault.createBinary` |
| `scripts/offline-audit.mjs` | Fails the build on network code | Extend to Swift and Xcode files |
| `packages/app/src/renderer/smoke.ts` | End-to-end checks | Split into renderer checks and host checks; run on the simulator |

Everything the renderer loads comes from **`quire://app/`**:

- `index.html` (served with the CSP header)
- `renderer.js`
- `modules/*.js` (import-map shims)
- `plugins/<id>/{main.js,styles.css,manifest.json}`
- `vault/<path>` (pictures, PDFs and media from the homebase)
- `pdf/` (engine, CMaps, standard fonts, wasm)
- `fonts/`

The iOS shell must serve this same URL space.

---

## 2. Architecture decisions

### 2.1 Shell: a thin native WKWebView shell (decide in Phase 0)

The earlier plan proposed Capacitor. The code points to something simpler:

- The renderer needs a **single custom-scheme handler** that serves `quire://app/*`, including the homebase
  and plugins.
- The bridge is about 25 calls.

A plain Swift app gives full control of both, with no third-party dependencies and an easier offline audit.
It would have:

- one `WKWebView`;
- a `WKURLSchemeHandler` for `quire`;
- a `WKScriptMessageHandlerWithReply` for the bridge.

Capacitor serves its own scheme from its own handler, which makes `/vault/` and `/plugins/` awkward to serve.

- **Default:** a thin native shell (`DocketeerShell`), written in Swift with SwiftUI or UIKit for the app shell.
- **Alternative:** Capacitor, only if Phase 0 shows a concrete benefit.
- Record the choice and the reason in `docs/mobile/decisions.md`.

### 2.2 Layout of the code

```
packages/ios/
  package.json            workspace "@quire/ios": scripts build, test (vitest for web/), build:xcode (macOS only)
  build.mjs               runs packages/app's renderer build with an iOS target, copies output into Docketeer/Resources/app/
  web/
    boot.ts               entry: asks native for host info, installs window.quire, then import('/renderer.js')
    host.ts               HostBridge over webkit.messageHandlers.quire (request/reply), event subscriptions
    host.test.ts          unit tests with a fake native side
  Docketeer/              Xcode project (universal iPhone + iPad)
    App/                  app lifecycle, scene, window, WKWebView setup
    Bridge/               message handler: dispatch by channel name, mirrors preload.ts
    Scheme/               QuireSchemeHandler: quire://app/* (bundle, plugins, vault with Range, CSP header)
    Homebase/             HomebaseFS (all HostFs calls), bookmarks, NSFileCoordinator, change watching, conflicts
    Lockdown/             WKContentRuleList, navigation and UI delegates
    Resources/app/        build output (git-ignored)
  DocketeerTests/             XCTest: path safety, atomic writes, rename, tree, Range, conflicts
```

Add `packages/ios` to the root `workspaces`. Root `npm test` must still pass on Linux, so iOS's own test
script runs the `web/` unit tests only. Xcode steps live behind `npm run build:xcode`, which exits with a
clear message off macOS.

### 2.3 Boot order

`getHost()` must find `window.quire` the moment `renderer.js` runs, and the desktop preload fills it
synchronously (`sendSync('host:info')`). On iOS:

1. `index.html` loads `/boot.js` before the renderer. This is an iOS-only `index.html`, generated by the build
   with the same CSP. `boot.js` is `'self'`, so the CSP already allows it.
2. `boot.ts` awaits `native('host:info')`, which returns platform, appVersion, vault, flags and form factor.
3. `boot.ts` sets `globalThis.quire` to the full bridge, then calls `await import('/renderer.js')`.

### 2.4 Bridge protocol

- **JavaScript to native:** `webkit.messageHandlers.quire.postMessage({ channel, args })` returns a promise
  (`WKScriptMessageHandlerWithReply`). Channel names are the same as the desktop IPC (`fs:read`,
  `app:recent`, …), so `preload.ts` is the reference.
- **Binary data:** base64 in both directions for `readBinary` and `writeBinary`. Large media is never sent over
  the bridge: the renderer already loads it from `quire://app/vault/`.
- **Native to JavaScript events** (`fs:events`, `app:system-lock`, `app:before-quit`): native calls
  `evaluateJavaScript("window.__quireNative.emit(name, payload)")`. `boot.ts` defines that function, and it
  only calls handlers that were registered.
- Every native handler validates its arguments' types and refuses unknown channels.

### 2.5 Platform and form factor

- Add an optional `formFactor?: 'desktop' | 'tablet' | 'phone'` to `HostBridge`. Desktop leaves it out, which
  means `'desktop'`.
- On start, the renderer sets these `Platform` fields from the host instead of the hard-coded values:
  `isMobile`, `isIosApp`, `isPhone`, `isTablet`, `isDesktopApp`, `isMobileApp`.
- `isMacOS` stays `true` on iOS, so `Mod` means ⌘, as on macOS.
- **Layout mode is a separate question from the device.** A helper `layoutMode(): 'compact' | 'regular'`
  returns compact when the window is narrower than ~700 CSS px. It sets `body.is-compact` and updates when the
  window is resized. `body.is-touch` comes from `(pointer: coarse)`. An iPad in Slide Over gets the compact
  layout.

### 2.6 Sync (iCloud Drive or Syncthing) and conflicts

- The homebase is a folder the user picks with the system folder picker. It can be in iCloud Drive, in a
  folder synced by an iOS Syncthing client, or "On My iPad". Access persists through a security-scoped
  bookmark.
- Every read and write goes through `NSFileCoordinator`. Writes are atomic: write a temporary file, then
  replace.
- **iCloud placeholders** (files not downloaded yet): `tree()` reports them with a new optional
  `pending?: true` on `HostEntry`. Native starts the download. When a file finishes downloading, an
  `fs:events` entry is sent for it. The search index skips pending files until then.
- **Watching for changes:**
  - In iCloud Drive: an `NSMetadataQuery` on the homebase.
  - Everywhere: a rescan by mtime when the app returns to the foreground.
  - Both send the existing `fs:events` shape.
- **Conflicts:** iCloud keeps conflicting versions with `NSFileVersion` (unresolved conflict versions), and
  Syncthing writes `*.sync-conflict-*` files. Add an optional `fs.conflicts()` and a Docket notice or panel
  where the user picks "keep this" or "keep that".
- **No silent overwrites:** native remembers the mtime it last served for each path. A write whose file
  changed on disk since then is refused with error code `conflict`. The renderer then saves the editor's text
  as `<name> (conflict <date>).md` and shows a notice.
- **Per-device layout:** save the pane layout to `workspace.ipad.json` or `workspace.iphone.json` when
  `formFactor` is tablet or phone. On first open, fall back to reading `workspace.json`. Settings, units,
  hotkeys and panels stay shared.

### 2.7 Offline enforcement on iOS

iOS apps always have network access, so enforcement is in layers:

- A `WKContentRuleList` blocks every `http(s)`, `ws(s)` and `ftp` load, and blocked loads are logged.
- The scheme handler serves only `quire://app/`.
- The same CSP as desktop, served as a header on `index.html`.
- `WKNavigationDelegate` refuses any navigation that isn't to `quire://app/`, and `WKUIDelegate` refuses new
  windows.
- The `data:`/`blob:` rules match desktop.
- Every permission request is refused.
- No `NSAppTransportSecurity` exceptions.
- The audit fails the build on network APIs in Swift (see Phase 1).

### 2.8 The new name: Docketeer

The app is being renamed from **Quire** to **Docketeer**, because another app already uses the name Quire. Do
the rename as the **first task of Phase 0**, in its own commits, before any iOS work.

**Rename now (everything a user sees):**

- `productName`, the window title, the welcome screen, About and notices;
- `README.md`, `PLAN.md` and `docs/`;
- `electron-builder.json` (product name, `appId`, artifact names) and the release names;
- the example homebase folder ("Quire example" becomes "Docketeer example");
- the iOS display name and bundle id;
- `"name"` in the root `package.json` (`docketeer-workspace`).

**Icons:**

- `docs/design/docketeer-icon.svg` (desktop, rounded) replaces `packages/app/build/icon.svg`. Regenerate
  `icon.png` from it at 1024 px.
- `docs/design/docketeer-icon-ios.svg` (full-bleed square with no transparency; iOS applies its own mask)
  becomes the 1024 px App Store icon in the Xcode asset catalogue.

**Keep for now (internal names a user never sees):** `@quire/api`, the `quire://` scheme, `window.quire`
and the `.quire/` folder in every homebase. Renaming `.quire/` would cut every existing homebase off from its
settings, units, hotkeys and layout. Record this in `docs/mobile/decisions.md`. If the user later wants these
renamed, that needs a migration: read `.quire/` when `.docketeer/` is missing and move it, and give plugins an
alias for `@quire/api`.

**Migration that is needed now:** Electron names its user-data folder after the app. After the rename, the
app-level config, recent homebases and the example homebase's location move to a new folder. On first launch,
if the Docketeer user-data folder is empty and a Quire one exists, copy its config across. Add a test for this.
Also check for the "Quire example" folder in Documents and keep using it if it exists.

**Left to the user:** renaming the GitHub repository (GitHub redirects the old URL) and the old release
artifacts.

---

## 3. Phases

The time per phase is a rough estimate. Each phase ends with an **exit check**, and a phase starts only when
the previous exit check has passed. Phases 0, 2 and 3 need a person to try the app on real devices.

### Phase 0: Rename and spike (1 to 2 weeks)

- [x] Rename to Docketeer and replace the icons (§2.8). `npm test` and `npm run smoke` must stay green, and
      the screenshot baselines are updated for the new name.

The question this phase answers: does CodeMirror 6 live preview feel right on an iPhone keyboard and an iPad
with a Magic Keyboard?

- [x] Create the `packages/ios` workspace (§2.2). Add it to root `workspaces`. Make sure root `npm test` is
      still green on Linux.
- [x] `packages/ios/build.mjs`: run the existing renderer build with an iOS target. This means
      `target: 'safari17'` instead of `chrome130`, the iOS `index.html` with `/boot.js` (§2.3), and output
      to `Docketeer/Resources/app/`. Refactor `packages/app/build.mjs` into a reusable function rather than
      copying it.
- [x] Swift shell: one scene, one `WKWebView`, and `QuireSchemeHandler` serving bundled files for
      `quire://app/*` with the CSP header on `index.html`. Start the page at `quire://app/index.html`.
- [x] `web/boot.ts` and `web/host.ts`, with an **in-memory `HostFs`** seeded from the bundled example
      homebase. Add enough of `app.*` to open it (`recentVaults`, `getConfig`/`setConfig` in
      `UserDefaults`, `dictionary`, `notices`). The Swift shell answers the channels listed in
      `packages/ios/README.md`.
- [x] Lockdown basics: the content rule list and the navigation delegate (§2.7).
- [x] Run on the iPhone and iPad simulators. Fix the crashes.
- [x] Write `docs/mobile/spike.md`. Cover:
      - typing, selection handles, autocorrect, dictation, IME composition, undo;
      - live preview on the cursor's line;
      - `[[` suggestions;
      - Magic Keyboard shortcuts, including whether ⌘D reaches the page;
      - performance opening the example homebase.
      Include screenshots.
- [x] Record the shell choice (§2.1) in `docs/mobile/decisions.md`.

**Exit check:** the app boots on both simulators. **The user tries it on a real iPhone and iPad** and confirms
that editing feels right, or decides what changes. Stop here and report.

*Passed on 2026-11-27: editing feels right on the owner's iPhone and iPad (`spike.md`).*

### Phase 1: Host and iCloud (3 to 4 weeks)

- [x] `HomebaseFS` (Swift) implements every `HostFs` method with the same behaviour as desktop (with its
      XCTests; the page uses it once the folder picker below is in):
      - Paths are relative with forward slashes.
      - Resolve against the root, and refuse `..`, NUL and symlinks that point outside the root.
      - `tree()` skips names starting with `.`.
      - `list()` includes hidden names.
      - `write()` is atomic and creates missing parent folders.
      - `trash()` uses `FileManager.trashItem`. Where that isn't available, it moves the file to
        `<homebase>/.trash/` and returns `true`.
- [x] Coordinated reads and writes, iCloud placeholders, and the `pending` flag (§2.6). Update `host.ts`,
      the Electron host (no-op) and the search index.
- [x] Folder picker and security-scoped bookmarks, with `chooseVault(create, layout)`, `openVault`,
      `recentVaults` (with `missing` and `current`) and `forgetVault`. `openExample` copies the example into
      the app's Documents folder. Port the new-homebase layout from `homebase-layout.ts`.
- [x] Change watching (`NSMetadataQuery`, plus a rescan on returning to the foreground) sends `fs:events`.
      Also a file presenter and a 20-second rescan while open (decisions.md §5); to check on a device with iCloud.
- [x] Conflicts: `fs.conflicts()`, the `conflict` write error, saving a conflict copy, and the Docket UI
      (§2.6). iCloud's own conflict versions are to be checked on a device (the simulator has no iCloud).
- [x] `quire://app/vault/<path>` with the `vaultType()` allow-list and HTTP Range (206) responses, ported from
      `vault-files.ts`. Seeking in a real recording is to be tried on a device.
- [x] `quire://app/plugins/<id>/<file>`: built-in plugins only. `plugins.list()` returns the built-ins, and
      the loader skips manifests with `isDesktopOnly: true` on iOS.
- [x] Assets:
      - `dictionary`, `notices` and `pdfAsset` read from the bundle.
      - `fonts()` returns the bundled fonts only.
      - `showItemInFolder` opens the Files app at that folder where possible; otherwise it does nothing.
- [x] Lifecycle:
      - ~~`onBeforeQuit` runs when the scene resigns active or goes to the background~~ — wrong: it unloads the
        plugins. A new `onBackground` saves instead (decisions.md); native waits for the promise using a
        background task.
      - `onSystemLock` fires when the app goes to the background.
      - Clipboard uses `UIPasteboard`.
- [x] Per-device workspace file (§2.6), with a vitest test in `packages/api/test`. (`formFactor` is on
      `HostBridge` now; the `Platform` flags are the next task.)
- [x] `Platform` and `formFactor` come from the host (§2.5), with a test.
- [x] **XCTest suite** (`DocketeerTests/`) mirroring `packages/app/test/vault-files.test.ts`:
      - path escapes, hidden files, atomic write, rename and copy;
      - Range responses;
      - conflict detection;
      - bookmark round trip.
- [x] **Offline audit:** extend `scripts/offline-audit.mjs` to fail on:
      - `URLSession`, `URLRequest`, `NWConnection`, `CFNetwork`, `WebSocket`, `SFSafariViewController` or
        `openURL` with http(s) in `packages/ios/**/*.swift`;
      - `NSAllowsArbitraryLoads` or any ATS exception in `Info.plist`;
      - any Swift package or CocoaPod not on an allow-list (which starts empty);
      - a `server.url` in a Capacitor config, if Capacitor was chosen.
      Add fixtures that prove each rule fires.
- [x] Split `smoke.ts` into renderer checks and host checks. Add an iOS host-check set, and run it in the
      simulator from `xcodebuild test`. The run must report blocked requests = 0 and console errors = 0.

**Exit check:** XCTests and the simulator smoke run pass. The user edits a note on the laptop and on the iPhone
(their second device, decisions.md §8) in both directions, through iCloud Drive (the owner does not use Syncthing, §6), and forces a conflict once. Nothing is lost.
Stop and report.

### Phase 2: iPhone, with full editing (3 to 4 weeks)

The owner's devices, in order: macOS, then iPhone, with the iPad a distant third (decisions.md §8). So the iPhone
comes before the iPad, and it is more than a companion: reading, search, capture, tasks and citation checks, and
comfortable for real writing, with footnotes, AGLC4 citing and exports. Tiling and the desktop-only editors stay
hidden. Items the iPad also needs (export with Share, the PDF viewer, settings) are done here, once.

- [x] Compact layout (`body.is-compact`):
      - one pane, with tiling turned off and the current pane kept;
      - a back gesture to the previous note;
      - open tabs behind a "show open tabs" button instead of the tab bar (the owner's suggestion after
        trying Phase 0 on an iPhone, `spike.md`);
      - Phone, and an iPad in Slide Over, both use it.
- [x] The Docket as a sheet (it is too wide for the iPhone now, `spike.md`), **from the bottom** (decisions.md §9):
      - A full-width Docket button at the bottom, away from the Dynamic Island and in reach of a thumb.
      - The search field gets focus and the keyboard opens; the sheet stays above the keyboard.
      - Panels become tabs in the order set in `panels-model.ts`, scrolling within the sheet.
      - Dismiss by swiping down on its top or pressing Escape.
- [x] Toolbar above the keyboard, positioned with `visualViewport`:
      - `[[` link, bold, task, heading, footnote, AGLC4 cite, slash menu (`slash.ts`), undo, and a button to
        hide the keyboard;
      - each button runs an existing command id.
- [x] Touch: long-press opens the menus a right-click opens on desktop. Context menus are in `markdown-view.ts`,
      `workspace.ts`, `embeds-editor.ts`, `docket/docket.ts`, `docket/panels/common.ts` and `pdf/view.ts`.
      Done in one place (`long-press.ts`): a still hold sends `contextmenu`; in note text only on a link, an
      embed or a misspelt word, so the system's cursor and selection hold stays.
- [ ] Export: AGLC4 Word, HTML and Markdown exports still write into the homebase. Add an optional
      `app.shareFile?(path)` to `HostBridge` that opens the share sheet on iOS, and offer "Share…" after an
      export. Desktop leaves it out and keeps its current behaviour. Export to PDF on iOS: `printToPdf` with
      WebKit's own PDF output (`WKWebView.createPDF`), a page that runs no scripts, as desktop.
- [ ] PDF viewer: pdf.js loads its engine, CMaps, standard fonts and wasm from the bundle, and opens a
      PDF from the homebase.
- [ ] Hide these in compact mode: tiling commands, the hotkey editor, vim mode, custom-panel editing and AGLC4
      page preview.
- [ ] Settings: hide desktop-only items, such as title bar colours and relaunch.
- [x] Safe areas: `viewport-fit=cover` and `env(safe-area-inset-*)` in `app.css`.
- [ ] On touch, density defaults to "spacious" when no density has been saved.
- [ ] Locking: lock when the app goes to the background (when locking is enabled). **Face ID / Touch ID
      unlock is design only:**
      - Write the design in `docs/docket/locking.md`: wrap the homebase key in the Keychain with
        `.biometryCurrentSet`, and add a fallback to the passphrase.
      - Stop for the user's sign-off before implementing it.
- [ ] The simulator smoke run on an iPhone-sized window as well as the iPad-sized one.
- [ ] Screenshots: iPhone viewports, portrait and with the keyboard up, with baselines in `test/visual/ios/`.

**Exit check:** all suites are green. **The user uses it daily on their iPhone for a week.** Stop and report.

### Phase 3: iPad, later and trimmed

The iPad is a distant third (decisions.md §8): what is shared with the iPhone came in Phase 2, and the rest waits
until the owner asks for it.

- [ ] Pointer and trackpad: hover preview and context menus work.
- [ ] Keyboard:
      - Every keymap works with a hardware keyboard.
      - Register a `UIKeyCommand` for each Docket-level command and forward it to the command id, so iPadOS
        shows it in the ⌘-hold overlay and doesn't take the key itself.
      - ⌘. as Escape (a `UIKeyCommand` that sends the page an Escape key): many iPad keyboards, such as the
        owner's Logitech one, have no Escape key (`spike.md`).
- [ ] Multitasking: Split View, Slide Over and Stage Manager resize cleanly between the compact and regular
      layouts.
- [ ] Docket drag-to-rearrange (`docket/drag.ts`, `drag-paths.ts`) works with touch and with the pointer.
- [ ] AGLC4 page preview:
      - Bundle a metric-compatible serif for Times New Roman (Tinos or Liberation Serif).
      - Check its licence and add it to `THIRD_PARTY_NOTICES`.
      - Run the fidelity tests (`plugins/aglc4/test/fidelity`) against it and record any differences.
- [ ] Screenshots: iPad viewports (portrait, landscape and half-screen Split View).

**Exit check:** all suites are green. The user tries it on their iPad. Stop and report.

### Phase 4: Release (1 to 2 weeks)

- [ ] Prepare the app icon (from `packages/app/build/icon.svg`), the launch screen, the display name and the
      bundle id. Ask the user for the bundle id.
- [ ] `Info.plist`:
      - `UIFileSharingEnabled` and `LSSupportsOpeningDocumentsInPlace`, so the app's Documents folder shows
        in the Files app;
      - no network usage keys;
      - supported orientations for iPhone and iPad;
      - multiple scenes only if the user wants several windows (open question).
- [ ] Privacy manifest `PrivacyInfo.xcprivacy`: declare the required-reason APIs actually used, such as file
      timestamps and `UserDefaults`. Set tracking to none and data collected to none.
- [ ] `ci.yml`: add a `macos` job that builds the app, runs XCTests and runs the simulator smoke test.
- [ ] `release.yml`: add a `macos` job after `test`:
      - it builds and signs a universal archive and uploads it to TestFlight;
      - it uses an App Store Connect API key from repository secrets;
      - document each secret in `docs/mobile/release.md`;
      - App Store submission stays manual.
- [ ] Docs: an iOS section in `README.md` (install from TestFlight or the App Store, choosing a homebase in
      iCloud Drive or Syncthing), a `CHANGELOG.md` entry, and an update to `PLAN.md` → *Phases*.

**Exit check:** a TestFlight build installs on the user's iPhone and iPad. Then stop. The steps the user does
are listed below.

---

## 4. Steps only the user can do

- Set up an Apple Developer account (paid). The same account would also allow notarising the macOS build.
- Create the App Store Connect app record and bundle id, and an API key for CI, stored as repository secrets.
- Test on real devices at the end of Phases 0 to 3.
- Fill in the App Store privacy label ("Data Not Collected"), the listing, screenshots and the review
  submission.

## 5. Definition of done (every task)

- `npm test` is green on Linux, and Electron `npm run smoke` is unchanged.
- New behaviour has tests: vitest for TypeScript, XCTest for Swift.
- The offline audit covers any new code path.
- Docs are updated where behaviour changed, and the task is checked off in this file.

## 6. Open questions (ask; don't guess)

- [x] The minimum iOS version is **17** (confirmed 2026-11-27).
- [ ] Face ID / Touch ID unlock in v1?
- [ ] Several windows on iPad (one homebase per window), or later?
- [x] Sync: the owner uses **iCloud Drive**, not Syncthing (2026-11-27). Phase 1 is tested with iCloud Drive;
      Syncthing's conflict files are still recognised, but no Syncthing client is tested.
- [x] Bundle id **`io.github.blursedperf.docketeer`**, the same as the desktop app (2026-11-27). The App Store
      name is still to settle in Phase 4.
