# Theming Caselore

Everything about how Caselore looks is under **Settings → Appearance**, and all of it can be extended with
files in your homebase. Like the rest of Caselore, themes work offline: a theme or snippet that tries to
load anything from outside the app (a web font, `@import`, a remote image) is refused.

## In the app

| Setting | What it does |
|---|---|
| **Mode** | Light, dark, or follow the system. |
| **Dark palette / Light palette** | The colours for each mode. 16 built in, from the DoomEsque theme: Crisp Dark (default), Doom One, Doom Vibrant, Dracula, Tokyo Night, Gruvbox, Cyberpunk, Retro Terminal, Suit and Tie; Crisp Light (default), Doom One Light, Nord Light, Gruvbox Light, Solarized Light, Tomorrow Day, Suit and Tie Light. |
| **Accent colour** | Replace the palette's accent (links, the active tab, selection, buttons, the modeline bar). The reset button returns to the palette's own. |
| **Interface / text / monospace font** | Any font installed on the computer. |
| **Text size**, **Density** | Note text size; compact, comfortable or spacious spacing. |
| **Icon set** and weight | Phosphor (thin, light, regular, bold) or Lucide. |
| **CSS theme** | An installed theme, loaded on top of the palettes. |
| **CSS snippets** | Small stylesheets, each switched on or off. |

## Files

```
<homebase>/.quire/
  themes/<name>/theme.css        a theme (manifest.json beside it is optional: name, version, author)
  snippets/<name>.css            a snippet
```

**Create theme** in Appearance writes a starter `theme.css` with the tokens explained, and selects it.
After editing a file, press **Reload themes and snippets**.

## Tokens

Every colour in the app comes from the `--doom-*` tokens, set per mode on `body.theme-dark` and
`body.theme-light`. A theme can change a few of them and leave the rest to the palette:

```css
body.theme-dark {
	--doom-bg: #0f1115;          /* editor background */
	--doom-bg-alt: #0a0c0f;      /* the Docket, dialogs and menus */
	--doom-blue: #7aa2f7;        /* accent */
	--doom-blue-rgb: 122, 162, 247;
	--doom-blue-text: #7aa2f7;   /* accent as text: keep 4.5:1 against --doom-bg */
}
```

| Group | Tokens |
|---|---|
| Surfaces | `--doom-bg`, `--doom-bg-alt`, `--doom-base0` … `--doom-base8`, `--doom-modeline-bg` |
| Text | `--doom-fg`, `--doom-fg-alt`, `--doom-text-muted`, `--doom-text-faint`, `--doom-comment` |
| Accents | `--doom-red`, `-orange`, `-yellow`, `-green`, `-teal`, `-blue`, `-cyan`, `-violet`, `-magenta`, each with `-rgb` and `-text` (contrast-checked text colour) and some with `-fill` |
| Lines | `--doom-hairline`, `--doom-border-subtle`, `--doom-border-strong` |
| Headings | `--h1-color` … `--h6-color` |
| Modeline | `--doom-modeline-bar`, `--doom-modeline-badge-bg`, `--doom-modeline-badge-fg` |
| Spacing and sizes | `--space-1` … `--space-8`, `--text-xs` … `--text-lg`, `--header-band`, `--subheader-band`, `--row-h`, `--control-h`, `--status-h`, `--icon-sm` … `--icon-lg`, `--control-width` (see the top of `app.css`) |

The full list for each built-in palette is in `packages/api/src/themes/palettes.ts`. The standard
variables plugins use (`--background-primary`, `--text-muted`, `--interactive-accent`, `--color-red` …)
are derived from these, so plugin styles follow any theme.

Body classes a theme can target: `theme-dark` / `theme-light`, `density-compact` / `-comfortable` /
`-spacious`, `has-css-theme`, `is-readable-line-width`; `data-palette-dark`, `data-palette-light` and
`data-icon-set` attributes on `<body>`.

## Contrast

Whatever the palette or accent, Caselore checks every pairing of text colour and surface the interface uses
(listed in `packages/api/src/themes/contrast.ts`) against WCAG AA: 7:1 for note text, 4.5:1 for other
text. A colour that falls short is moved toward black or white until it passes; palettes that already
pass are used exactly as designed. CSS themes and snippets are loaded after this and are not adjusted.

## What a theme cannot do

Caselore refuses a theme or snippet that contains `@import`, a `url()` that is not a `data:` URI, a web
address, or script in CSS. The app's Content-Security-Policy would block such loads anyway; refusing the
file says why in Settings instead of failing silently. Fonts must be installed on the computer.

## For plugins

```ts
// Add a palette while the plugin is on.
this.registerPalette({ id: 'my-dark', name: 'My Dark', mode: 'dark', vars: { 'doom-bg': '#101010', /* … */ } });

// React to appearance changes.
this.registerEvent(this.app.customCss.on('css-change', () => this.redraw()));

// Icons: always Lucide names; they are drawn in the user's chosen set.
setIcon(el, 'history');
```
