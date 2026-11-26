# Docketeer for iPhone and iPad

The iOS app is a thin native shell (Swift, one `WKWebView`) around the same renderer the desktop app uses. The
plan and its progress are in [docs/mobile/PLAN.md](../../docs/mobile/PLAN.md); decisions are in
[docs/mobile/decisions.md](../../docs/mobile/decisions.md).

| Path | What it is |
|---|---|
| `web/boot.ts` | The page's first script: installs `window.quire`, then loads `/renderer.js` |
| `web/start.ts` | The boot order (host info, the homebase, the bridge, then the renderer) |
| `web/host.ts` | `window.quire` over `webkit.messageHandlers.quire`, native events, base64 for bytes |
| `web/memory-fs.ts` | Phase 0: the example homebase in memory, with the desktop host's file rules |
| `build.mjs` | Builds the page into `Docketeer/Resources/app/` (git-ignored) for Safari 17 |
| `Docketeer/` | The Xcode project (arrives with the Swift shell; macOS only) |

```bash
npm run build                 # from the repository root: the plugins and the desktop app
npm run build -w @quire/ios   # the iOS page, into packages/ios/Docketeer/Resources/app/
npm test -w @quire/ios        # unit tests for web/, then the iOS build
```

## What the shell serves and answers

**`quire://app/`**, from `Resources/app/`: `index.html` (with `renderer/csp.txt` as its
`Content-Security-Policy` header) and everything else under `renderer/`; `plugins/<id>/<file>` from `plugins/`; in
Phase 0, `vault/<path>` from `example-homebase/`.

**Messages** arrive as `{ channel, args }`; the reply is the answer, or an error for a channel it does not know.
Bytes are base64 strings. Phase 0 needs:

| Channel | Arguments | Answer |
|---|---|---|
| `host:info` | | `{ platform: 'ios', appVersion, formFactor: 'phone' \| 'tablet', vault: { path, name } }` |
| `example:files` | | `[{ path, base64 }]`: every file in `example-homebase/`, paths with `/` |
| `app:getConfig` / `app:setConfig` | — / `patch` | the settings object (kept in `UserDefaults`) / nothing |
| `spell:dictionary` | `lang` (`en-AU`, `en-GB`, `en-US` only) | `{ aff, dic }` from `dictionaries/<lang>/index.*`, or null |
| `app:notices` | | the text of `THIRD_PARTY_NOTICES.txt` |
| `plugins:list` | | `[{ manifest, source: 'builtin', hasStyles }]` for each folder in `plugins/` |
| `pdf:asset` | `kind` (`standard_fonts` or `cmaps`), `name` | base64 of `pdfjs/<kind>/<name>` |
| `clipboard:readText` / `clipboard:writeText` | — / `text` | `UIPasteboard` text / nothing |
| `app:quit-ready` | `token` | nothing (the page has saved; end the background task) |

**Events**: native calls `window.__quireNative.emit(name, payload)` for `fs:events` (`[{ path, stat }]`),
`app:system-lock`, and `app:before-quit` (payload: a token the page sends back with `app:quit-ready`).

From Phase 1 the homebase moves to native: the `fs:*` channels, with the same names and behaviour as the desktop
IPC in `packages/app/src/main/main.ts` (`fs:readBinary` answers base64, `fs:writeBinary` takes it).
