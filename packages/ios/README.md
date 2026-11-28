# Docketeer for iPhone and iPad

The iOS app is a thin native shell (Swift, one `WKWebView`) around the same renderer the desktop app uses. The
plan and its progress are in [docs/mobile/PLAN.md](../../docs/mobile/PLAN.md); decisions are in
[docs/mobile/decisions.md](../../docs/mobile/decisions.md).

| Path | What it is |
|---|---|
| `web/boot.ts` | The page's first script: installs `window.quire`, then loads `/renderer.js` |
| `web/start.ts` | The boot order (host info, the homebase, the bridge, then the renderer) |
| `web/host.ts` | `window.quire` over `webkit.messageHandlers.quire`, native events, base64 for bytes |
| `build.mjs` | Builds the page into `Docketeer/Resources/app/` (git-ignored) for Safari 17 |
| `Docketeer/Docketeer.xcodeproj` | The Xcode project (universal iPhone and iPad, iOS 17 and later; no Swift packages) |
| `Docketeer/App/` | App and scene, `PageViewController` (the one `WKWebView`), the Debug-only console relay |
| `Docketeer/Scheme/` | `AppFiles` (what each `quire://app/` URL answers) and `QuireSchemeHandler` |
| `Docketeer/Bridge/` | `Channels` (the answer for each channel) and `Bridge` (the message handler, events to the page) |
| `Docketeer/Homebase/` | `HomebaseFS` (the homebase on disk, every `fs:*` call) and `Homebases` (folder bookmarks, the recent list, the example) |
| `Docketeer/Lockdown/` | The offline content rule list, and the navigation and UI delegate |
| `DocketeerTests/` | XCTests: paths, routes and headers; channels; the homebase on disk; bookmarks and the recent list |

```bash
npm run build                 # from the repository root: the plugins and the desktop app
npm run build -w @quire/ios   # the iOS page, into packages/ios/Docketeer/Resources/app/
npm test -w @quire/ios        # unit tests for web/, then the iOS build
npm run build:xcode -w @quire/ios   # macOS: the page, then the app for the simulator (Docketeer/build/)
npm run test:xcode -w @quire/ios    # macOS: the XCTests on a simulator (DOCKETEER_SIMULATOR, default "iPhone 17"),
                                    # the page's smoke checks in WebKit among them, in an iPad-sized window and
                                    # an iPhone-sized one (about 3 min)
npm run shots:ios -w @quire/ios     # macOS: the iPhone's screenshots, compared with test/visual/ios/
                                    # (after a change on purpose: node ../../scripts/shots-diff.mjs
                                    #  Docketeer/build/shots --platform ios --update)
```

The app icon is rendered from `docs/design/app-icon-source.png`, with the desktop icon, by `scripts/app-icon.swift`:
full-bleed and opaque here (iOS rounds the corners itself; App Store icons must have no alpha). From the repo root:

```bash
swift scripts/app-icon.swift docs/design/app-icon-source.png \
  packages/ios/Docketeer/App/Assets.xcassets/AppIcon.appiconset/icon-1024.png packages/app/build/icon.png
```

To try it, open `Docketeer/Docketeer.xcodeproj` in Xcode after `npm run build -w @quire/ios`, pick a simulator and
run. For a device, pick a signing team first. In Debug builds the page's console errors reach the system log as
`[page] …`, and Safari's Web Inspector can attach (Develop menu).

## What the shell serves and answers

**`quire://app/`**, from `Resources/app/`: `index.html` (with `renderer/csp.txt` as its
`Content-Security-Policy` header) and everything else under `renderer/`; `plugins/<id>/<file>` from `plugins/`;
`vault/<path>` from the open homebase (pictures, PDFs, media and captions only), with byte ranges (206, 416) and
HEAD, sent in pieces so a recording is never held in memory whole.

**Messages** arrive as `{ channel, args }`; the reply is the answer, or an error for a channel it does not know.
Bytes are base64 strings.

| Channel | Arguments | Answer |
|---|---|---|
| `host:info` | | `{ platform: 'ios', appVersion, formFactor: 'phone' \| 'tablet', vault: { path, name } \| null }` |
| `fs:*` | as desktop (`packages/app/src/main/main.ts`) | as desktop; `fs:readBinary` answers base64, `fs:writeBinary` takes it |
| `app:recent` | | `[{ path, name, time, missing?, current? }]`; `path` is where the folder is, in words ("iCloud Drive/Law") |
| `app:chooseVault` | `create`, `layout`, the Generic panels as JSON (or null) | true once a folder is picked and opened (the page reloads), false if cancelled |
| `app:openVault` / `app:forgetVault` | `path` from the recent list | true if it opened (the page reloads) / nothing |
| `app:openExample` | | where the example is: copied into the app's Documents once, then opened |
| `app:getConfig` / `app:setConfig` | — / `patch` | the settings object (kept in `UserDefaults`) / nothing |
| `spell:dictionary` | `lang` (`en-AU`, `en-GB`, `en-US` only) | `{ aff, dic }` from `dictionaries/<lang>/index.*`, or null |
| `app:notices` | | the text of `THIRD_PARTY_NOTICES.txt` |
| `plugins:list` | | `[{ manifest, source: 'builtin', hasStyles }]` for each folder in `plugins/` |
| `pdf:asset` | `kind` (`standard_fonts` or `cmaps`), `name` | base64 of `pdfjs/<kind>/<name>` |
| `clipboard:readText` / `clipboard:writeText` | — / `text` | `UIPasteboard` text / nothing |
| `app:quit-ready` | `token` | nothing (the page has saved; end the background task) |

**Events**: native calls `window.__quireNative.emit(name, payload)` for `fs:events` (`[{ path, stat }]`),
`app:system-lock`, and `app:before-quit` (payload: a token the page sends back with `app:quit-ready`).

In Debug builds, the launch argument `-openExample` opens the example homebase at start, for simulator runs.
