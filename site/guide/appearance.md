# Appearance

Open Settings with the **gear** at the bottom left, beside the homebase's name. Everything about how Docketeer looks
is under **Appearance**.

![Settings, Appearance](/screenshots/10-settings-appearance.png){.shot}

## Palettes

Sixteen colour palettes, one chosen for dark mode and one for light, and **Mode** picks light, dark, or whatever your
computer uses.

- **Dark**: Crisp Dark (the default), Doom One, Doom Vibrant, Dracula, Tokyo Night, Gruvbox, Cyberpunk, Retro Terminal,
  Suit and Tie.
- **Light**: Crisp Light (the default), Doom One Light, Nord Light, Gruvbox Light, Solarized Light, Tomorrow Day,
  Suit and Tie Light.

<div class="shots">

![Tokyo Night](/screenshots/02-palette-tokyo-night.png){.shot}
![Solarized Light](/screenshots/03-palette-solarized-light.png){.shot}

</div>

**Accent colour** replaces the palette's accent (links, the active tab, buttons). Whatever you choose, Docketeer
checks every pairing of text and background against the WCAG AA contrast standard and nudges any that fall short, so
text stays readable.

## Fonts and size

Choose the interface, text and monospace fonts from those installed on your computer, and the note text size.
Docketeer comes with its own fonts, so it looks right without any.

## Density

**Compact**, **Comfortable** or **Spacious**: how much room rows, buttons and padding take, everywhere in the app.
A touch screen has a density of its own (Spacious unless you choose).

<div class="shots">

![Compact](/screenshots/04-density-compact.png){.shot}
![Spacious](/screenshots/04-density-spacious.png){.shot}

</div>

## Icons

**Phosphor** (thin, light, regular or bold) or **Lucide**.

## Your own themes and snippets

Themes and CSS snippets are files in your homebase:

```
<homebase>/.quire/themes/<name>/theme.css
<homebase>/.quire/snippets/<name>.css
```

**Create theme** writes a starter `theme.css` with every colour explained, and selects it; after editing, press
**Reload themes and snippets**. Snippets are small stylesheets you switch on and off one by one.

Like the rest of Docketeer, themes stay offline: a theme or snippet that tries to load anything from outside the app
(a web font, `@import`, a remote picture) is refused, with the reason shown in Settings.

The full list of colours and sizes a theme can change is in the
[theming guide](https://github.com/blursedperf/Docketeer/blob/master/docs/theming.md).
