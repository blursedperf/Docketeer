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

- **The Xcode project is written by hand** (`project.pbxproj` lists each file), so no project generator is
  needed. A new Swift file has to be added to the project as well (Xcode does this when the file is created there).
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
