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
