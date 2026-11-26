# Docketeer for iPhone and iPad: decisions

Decisions made while working through [PLAN.md](PLAN.md), with the reason for each.

## 1. The rename keeps the internal names (Phase 0)

Everything a user sees says Docketeer: the window title, the welcome screen, settings, notices, the docs, the
installers (`Docketeer-<version>-…`, the `docketeer` package and executable, app id
`io.github.blursedperf.docketeer`) and the example homebase ("Docketeer example").

These keep the old name, because changing them would break what already exists:

- **`.quire/` in every homebase.** Renaming it would cut existing homebases off from their settings, units,
  hotkeys and layout.
- **`@quire/api`.** Plugins import it by that name.
- **The `quire://` scheme and `window.quire`.** Internal; nothing outside the app uses them.
- **The locked-note format** (`quire-locked: 1`, `quire-encrypted v1`, the `quire-note-v1` associated data).
  Changing these would make notes locked before the rename unreadable. Only the readable sentence at the top
  of a locked note now says Docketeer.
- **`quire.json`**, the app-wide settings file, and the `QUIRE_SMOKE_OUT` variable.

Renaming these later needs a migration: read `.quire/` when `.docketeer/` is missing and move it, and give
plugins an alias for `@quire/api`.

**Moving across from Quire.** Electron names the user-data folder after the app, so it is now
`Docketeer` (`~/.config/Docketeer`, `~/Library/Application Support/Docketeer`). On launch, when it has no
`quire.json` and the old `Quire` folder has one, that file is copied across (`src/main/user-data.ts`). The old
folder is left alone. Test runs skip this, so they never write the user's settings. A "Quire example" folder
already in Documents keeps being opened as the example.

**Packages.** The Arch and Debian packages are now `docketeer`, and declare that they replace and conflict with
`quire`, so installing one removes the other. On macOS the new app has a new bundle id, so the old Quire.app
stays until it is deleted.

## 2. The web side of the shell (Phase 0)

- **One build, two hosts.** `packages/app/build.mjs` now exports `buildApp()`. The desktop build is unchanged
  (its output was compared file by file). iOS builds with `target: 'safari17'`, without the Electron files and
  the Electron licence, and with `boot.js` in `index.html` in place of `renderer.js`. The CSP is the same.
- **The boot order is in `start.ts`, apart from `boot.ts`**, so it can be tested without a WebView. `boot.ts`
  shows an error on the page if starting fails, as the renderer does.
- **The example homebase is sent to the page once** (`example:files`, about 0.9 MB as base64) and held in memory.
  *(Phase 0 only: from Phase 1 the homebase is a folder on disk, and the example is copied into the app's
  Documents folder; `example:files` and the in-memory homebase are gone.)*
  The CSP's `connect-src 'none'` rules out fetching it from `quire://app/`. Media still loads from
  `quire://app/vault/`, which the shell serves from the bundled example in Phase 0, so files added in memory
  (an AGLC4 Word export, say) cannot be opened as media until Phase 1.
- **Not in the host yet:** `formFactor` and the `Platform` flags (Phase 1 task), `openExample`, picking
  and opening homebases, and `printToPdf`. Settings → Fonts lists only the shipped fonts.
- **Checked off Linux:** the iOS build boots the real renderer in a throwaway Electron harness with a fake native
  side, at tablet and phone sizes, with no console errors. That is Chromium, not WebKit: the simulators in
  Phase 0 are the real test.

## 3. The Swift shell: scheme handler, bridge and lockdown (Phase 0)

PLAN §0 rule 8: the scheme handler is security-sensitive, so this was written before the code, and the owner
signed it off on 2026-11-26. It mirrors
`registerProtocol()` and `lockDown()` in `packages/app/src/main/main.ts`.

**`QuireSchemeHandler`** (`WKURLSchemeHandler` for `quire`):

- Only the host `app`; anything else answers 404.
- The path is split on `/` and each part percent-decoded. A part that is empty, `.`, `..`, or holds NUL, `\` or
  an encoded `/` answers 403.
- Routes, all from the app bundle (`Resources/app/`), read-only:
  - `/` and `/index.html`: `renderer/index.html`, with `renderer/csp.txt` as its `Content-Security-Policy`
    header. The CSP is read once at start; if it is missing or empty, `index.html` is not served (fails closed).
  - `/plugins/<id>/<file>`: `plugins/<id>/<file>`, with `id` matching `^[a-z0-9][a-z0-9_.-]*$` (any case) and
    `file` one of `main.js`, `styles.css`, `manifest.json`. Built-in plugins only: nothing from the homebase.
  - `/vault/<path>`: in Phase 0, `example-homebase/<path>`, only for the types in `vaultType()`
    (`vault-files.ts`), otherwise 403. Whole files only (200); Range (206) comes with Phase 1.
  - Anything else: `renderer/<path>`.
  - No `/print/` route yet (`printToPdf` is not in the iOS host).
- Containment: the joined path is standardised with symlinks resolved and must lie inside the route's root
  (resolved the same way, compared with a trailing `/`); otherwise 403.
- Headers: the content type from the same table as desktop (`application/octet-stream` otherwise),
  `X-Content-Type-Options: nosniff`, `Cache-Control: no-store`. Errors are HTTP answers (403, 404), so the page
  sees them as it does on desktop.
- Files are read off the main thread. A task that WebKit stopped is never answered (answering one crashes).

**Bridge** (`WKScriptMessageHandlerWithReply`, name `quire`, in the page's content world):

- Messages are answered only from the main frame of `quire://app`; others are refused.
- The message must be `{ channel: String, args: [Any] }`. Each channel checks its arguments' types. An unknown
  channel answers an error. The channels are the Phase 0 list in `packages/ios/README.md`.
- `pdf:asset` and `spell:dictionary` take the desktop's checks unchanged (the kind and name pattern; the three
  languages).
- Settings (`app:getConfig`/`app:setConfig`) are one JSON object in `UserDefaults`; `setConfig` merges the keys
  of the patch, like `Object.assign` on desktop.

**Lockdown** (PLAN §2.7):

- A `WKContentRuleList` that blocks every load, then lets through `^quire://app/`, `^data:` and `^blob:`
  (`ignore-previous-rules`). WebKit does not tell the app about loads a rule list blocks, so these are not
  logged; navigations refused by the delegate are.
- `WKNavigationDelegate` allows only `quire://app/`; nothing is handed to other apps (no `openURL`).
- `WKUIDelegate` refuses new windows and denies camera, microphone and motion permission requests.
- Off: Safari's fraudulent-website warning (it asks a server), link previews, data detectors.
- No `NSAppTransportSecurity` exceptions in `Info.plist`, and no Swift packages.
- Web Inspector (`isInspectable`) only in Debug builds.

## 4. A thin native shell, not Capacitor (Phase 0)

PLAN §2.1 left this to Phase 0. The shell is plain Swift with UIKit: one scene, one `WKWebView`, a
`WKURLSchemeHandler` and a `WKScriptMessageHandlerWithReply`, with no Swift packages. Phase 0 found no reason for
Capacitor: the whole shell is about 600 lines, the scheme handler serves `vault/` and `plugins/` from one place,
and there is no third-party code for the offline audit to check.

What else Phase 0 settled:

- **The Xcode project uses synchronised folders** (Xcode 16 and later): `App/`, `Bridge/`, `Homebase/`,
  `Lockdown/`, `Scheme/` and `DocketeerTests/` are included whole, so a new Swift file needs no change to
  `project.pbxproj`. No project generator is needed.
- **Bundle id `io.github.blursedperf.docketeer`**, the same as the desktop app id, until the owner chooses the
  App Store one (PLAN §6). **iOS 17** is the minimum, as assumed in PLAN §6.
- **The offline audit covers Swift** now: network APIs, web addresses, opening URLs, ATS exceptions, Swift
  packages and dependency managers. Its fixtures come with the rest of the Phase 1 audit task.
- **Console errors in Debug builds** go to the system log (`ConsoleRelay`), so simulator runs can be checked
  from the command line. Release builds leave it out.
- **First runs, on the iOS 27.2 simulators (iPhone 17, iPad Pro 11-inch):** the app boots into the example
  homebase on both, with no console errors and no refused navigations. WebKit logs that it could not read
  WebPrivacy's fingerprinting list; that is a list the system keeps, not a request from Docketeer.
- **Phone layout:** the iPhone shows the desktop layout squeezed (two panes, the first-run hint running off the
  side). That is expected until the compact layout in Phase 3.

## 5. Phase 1: homebases on disk

PLAN §0 rule 8: path checks, folder access and the scheme handler's `vault/` route are security-sensitive, so this
was written before the code, and the owner signed it off on 2026-11-27. It ports `resolvePath()`, `atomicWrite()`, `tree()`, the `fs:*` handlers and
`vault-files.ts` from `packages/app/src/main/`, and adds what iCloud Drive needs. The owner syncs with iCloud
Drive (PLAN §6).

### Reaching the folder

- The homebase is a folder picked with the system picker (`UIDocumentPickerViewController` for folders). The app
  keeps a **security-scoped bookmark** to it in `UserDefaults` (on this device only; it does not sync). Nothing
  else on the device is reachable: the app does not ask for other access.
- Access is started (`startAccessingSecurityScopedResource`) when the homebase opens and stopped when another
  opens. A stale bookmark is renewed from the URL it resolves to; one that no longer resolves makes the homebase
  `missing` in the recent list (the desktop's behaviour for a deleted folder).
- **Recent homebases:** up to 12, each with its bookmark and name. `forgetVault` deletes the bookmark.
  `openExample` copies the bundled example into the app's own Documents folder once and opens it from there.
  `chooseVault(create, layout)` writes the new-homebase layout ported from `homebase-layout.ts`.
- The page never sees a real path: `vault.path` is an id for the recent list (the bookmark's key), and every
  `fs:*` path is relative to the homebase.

### Path checks (every `fs:*` call and `vault/`)

- The argument must be a string without NUL. Leading `/` and `\` are dropped, as on desktop.
- The path is joined to the root and normalised (`.` and `..` resolved by name). If the result is not the root or
  inside it, the call is refused.
- Then, as on desktop, the nearest part of the path that exists is resolved with symlinks followed, and it must
  lie inside the root (resolved the same way). This stops a symlink inside the homebase from leading out of it.
- The root itself cannot be removed, trashed or renamed.
- `tree()` skips names starting with `.` and symlinks; `list()` includes hidden names (as desktop).

### Reading and writing

- Every read and write goes through `NSFileCoordinator`, so iCloud is not halfway through changing a file
  while Docketeer reads or replaces it.
- **Writes are atomic.** The new contents go to a temporary file beside the old one
  (`.<name>.<uuid>.quire-tmp`, hidden, so `tree()` and watching skip it), which then replaces the old file.
  Missing parent folders are created. If anything fails, the temporary file is removed.
- **`trash()`** uses `FileManager.trashItem`. Where the folder has no trash (some iCloud Drive and "On My iPad"
  folders), it moves the item to `<homebase>/.trash/` with a unique name and returns `true`.
- **Nothing is overwritten silently.** Native remembers the modification time it last served or wrote for each
  file. A `write` to a file that changed on disk since then is refused with the error code `conflict`. The
  renderer then saves the editor's text as `<name> (conflict <date>).md` and shows a notice, so neither version
  is lost. This applies to notes and attachments; the settings in `.quire/` stay last-write-wins, as on desktop
  (the pane layout gets a file per device, PLAN §2.6).

### iCloud Drive

- **Files not downloaded yet** are listed by `tree()` with `pending: true` (from the file's iCloud download
  status), and their download is started. The search index skips them until an `fs:events` entry says they
  arrived. Whether iOS 17 and later show them as `.<name>.icloud` stand-ins or as files without their data is
  checked on the device; both are handled.
- **Changes from other devices** are found by an `NSMetadataQuery` on the homebase while the app is open, and by
  a rescan by modification time when it returns to the foreground. Both send the existing `fs:events`.
- **Conflicts iCloud keeps** (`NSFileVersion` unresolved versions) and Syncthing's `*.sync-conflict-*` files are
  listed by a new optional `fs.conflicts()`. The Docket shows a notice and lets you keep one version or the other;
  the other version is removed only when you choose.

### Serving homebase files (`quire://app/vault/`)

- The same allow-list of types as desktop (`vaultType()`); everything else answers 403. Path checks as above.
- **Byte ranges** (206, and 416 when unsatisfiable) ported from `parseRange()` with the same tests, so lecture
  recordings seek. Files are read in pieces from a `FileHandle`, never whole into memory.
- A file not downloaded yet answers 404 and starts its download.

### Additions to `HostBridge` (all optional; desktop unchanged)

`HostEntry.pending?: true`; `fs.conflicts?()`; the `conflict` error code; `formFactor?` (PLAN §2.5). The Electron
host gets no-op versions in the same commit, per PLAN §0 rule 2.

### Tests

XCTests mirroring `packages/app/test/vault-files.test.ts`: escapes (`..`, encoded, absolute, NUL, symlinks
out), hidden files, atomic writes (no temporary file left; parent folders made), rename and copy, refusing the
root, Range answers, conflict detection, a bookmark round trip.

**What the folder picker work settled (Phase 1):**

- **`vault.path` is where the folder is, in words** ("iCloud Drive/Law/Torts", "On My iPad/Docketeer/Docketeer
  example"), because the start screen and the switcher show it. It is also the key of the folder's bookmark, so
  the page still never sees a real path.
- **A new Generic homebase's panels come from the page.** `genericPanels()` lives in the renderer, so the iOS
  bridge sends it as JSON with `app:chooseVault`; native checks it is JSON, under 1 MB, and writes
  `.quire/panels.json` only if the folder has none (as `applyHomebaseLayout()` on desktop).
- **The app's Documents folder shows in Files** (`UIFileSharingEnabled`, `LSSupportsOpeningDocumentsInPlace`),
  so the example homebase can be seen and backed up there. This was a Phase 4 item, brought forward.

**What change watching and the conflict guard settled (Phase 1):**

- **Watching is one rescan with several triggers.** Every signal leads to the same comparison of each file's
  type, size and modification time with the last scan: a file presenter on the folder (iCloud and Files
  coordinate their changes), an `NSMetadataQuery` in the scope for documents outside the app's container, coming
  back to the foreground, and a rescan every 20 seconds while the app is open, in case a change comes with no
  signal. Folders are reported only when they appear or go. Whether the metadata query sees a folder picked from
  iCloud Drive is to be checked on a device; the other triggers do not depend on it.
- **Desktop's rule for unsaved typing does not hold on a host that guards conflicts.** On desktop, a change on
  disk while you have unsaved edits is overwritten by your next save ("typing since the last save wins"). On iOS
  that would bypass the guard, because reloading the note tells native it has seen the new version. So when
  `fs.guardsConflicts` is set, the editor keeps both versions at that moment too. Desktop is unchanged, and a smoke
  check says so.
- **A locked note's conflict copy is locked too** (`VaultCrypt.onCopy`), so your version is never written out
  unencrypted.

**What iCloud downloads settled (Phase 1):**

- **Both kinds of placeholder are handled.** A hidden stand-in (`.Name.md.icloud`) is listed as the file it is
  for; a file that is there without its contents is found by its iCloud download status. Both are `pending`.
- **Only notes download by themselves.** The design said every pending file starts downloading. Notes do, as soon
  as the homebase is listed; pictures, PDFs and recordings download when they are opened (or shown), so a homebase
  with gigabytes of lecture recordings does not fill the device. Until it arrives, such a file answers 404 from
  `quire://app/vault/`.
- **Reading waits.** Opening a note that is still downloading waits up to a minute, then says it is still on its
  way. The search and link index know pending notes by name only, and take them in when the watcher reports them
  (an arrival counts as a change even when the file's time is the same).

**What versions from other devices settled (Phase 1):**

- **Three choices, not two.** The design offered keeping one version or the other. *Keep both* is added: the other
  version is saved beside the note as a conflict copy (the same name as the guard's copies), so choosing never
  has to lose anything. The version not kept is removed only when you choose.
- **Where they show:** a notice when one appears, and *Versions from other devices* at the top of the Homebase
  panel while any are there. A row opens Compare (both texts side by side); its actions settle it directly.
- **How they are found:** iCloud's unresolved `NSFileVersion`s, asked only for files whose "has unresolved
  conflicts" flag is set, and Syncthing's `.sync-conflict-` files beside their note. An id names the note and the
  version (its time); native finds the version again from it, through the usual path checks, and refuses
  anything else. Settings in `.quire/` are not listed (they stay last-write-wins).
- **Tested:** Syncthing completely in XCTests; for iCloud, refusing bad ids, since the simulator cannot make
  conflict versions. The first real iCloud conflict is part of the Phase 1 exit check.
