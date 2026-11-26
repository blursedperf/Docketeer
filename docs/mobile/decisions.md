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
