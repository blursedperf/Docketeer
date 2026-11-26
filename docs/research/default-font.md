# A default font for Docketeer

*Done in 0.16.0: recommendations 1–4 below.*

## Now

Docketeer ships no fonts. Each setting falls back to what the computer has:

| Setting | Default stack | What students actually get |
|---|---|---|
| Interface (menus, settings, note text by default) | `system-ui, -apple-system, "Segoe UI", "Inter", "Cantarell", "Noto Sans"` | Segoe UI on Windows, SF Pro on macOS, whatever the desktop uses on Linux |
| Text (notes) | the interface font | the same |
| Monospace (tabs, file tree, status bar, Docket, code) | `"JetBrains Mono", "Iosevka", "Fira Code", "Source Code Pro", "Cascadia Code", ui-monospace` | JetBrains Mono only if installed (rare): Cascadia Mono/Consolas on Windows, SF Mono/Menlo on macOS |

The monospace font matters more than usual: Docketeer's chrome (tabs, the file tree, the status bar, the Docket bar and
headings in dialogs) is set in it. The screenshots and the design assume JetBrains Mono, so on a typical Windows
laptop Docketeer looks noticeably different from how it was designed, and the three systems all differ.

## Options

All of these are SIL Open Font License 1.1 (free to bundle; the licence text goes in THIRD_PARTY_NOTICES), variable
(one file per style for every weight), and small as WOFF2 cut to Latin + Latin Extended (accents in case names,
macrons in Māori and Pacific names, European parties):

| Font | Role | Size (Latin + Latin Ext., upright) | Character |
|---|---|---|---|
| **JetBrains Mono** | monospace / chrome | 56 KB | the font the design already assumes; clear, slightly technical |
| **Inter** | interface | 132 KB | the most legible UI sans at small sizes; neutral |
| **IBM Plex Sans** | interface | 80 KB | more formal, slightly corporate; has matching Plex Serif and Plex Mono |
| **Source Serif 4** | note text (optional) | 96 KB | a reading serif with optical sizes; suits essays and the Chambers palettes |

Italics roughly double each figure. Even all four with italics come to well under 1 MB, against an app of 32 MB.
They load from `quire://app` (the CSP already allows `font-src 'self' quire://app`), so they stay offline.

## Recommendation

1. **Bundle JetBrains Mono** as the monospace default. It's the font the interface was designed in. It fixes
   the biggest difference between systems for 56 KB.
2. **Bundle Inter** and make it the interface default (instead of `system-ui`), so menus, settings and notes look the
   same on every computer. Keep *System default* in the dropdown for those who prefer their platform's font.
3. **Bundle Source Serif 4 as an option, not the default**, for note text: *Text font → Source Serif 4* gives a formal,
   printed-page look for writing essays, and pairs with the Chambers palettes. Sans stays the default because
   students skim notes more than they read them.
4. In the font dropdowns, a **Bundled with Docketeer** group comes first, so these work on every computer even when the
   installed list is short.

Exports (Word) are not affected. They keep naming the font the student or their faculty template sets, usually
Times New Roman or Arial for submitted work.
