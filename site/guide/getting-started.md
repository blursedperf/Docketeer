# Getting started

This page takes you from a fresh install to writing, finding and linking notes without touching the mouse. It takes
about ten minutes.

::: tip Keys on this site
**⌘** is the Command key on a Mac. On Linux, read **⌘** as **Ctrl**, except in **⌘D**, which is **Super+D** (the
Windows key). Every shortcut can be changed in Settings → Hotkeys, and the Docket always shows the current ones:
type `?` in it.
:::

## 1. Choose a homebase

A **homebase** is the folder your notes live in: plain Markdown (`.md`) files you can open in any other app, back up
or sync however you like. The first time Caselore opens, it asks for one:

- **Open a folder as a homebase**: use a folder of Markdown notes you already have.
- **Create a new homebase**: make an empty folder, starting with the panels you choose:
  - **Legal**: Subjects, Authorities, Outline, Cite, Homebase and Layout, for law notes with AGLC4 citations.
  - **Generic**: Files and Folders, Homebase and Layout; the others can be shown later.
- **Try the example homebase**: sample law notes (an essay on native title, a case brief, a lecture recording and
  a reading), copied into *Caselore example* in your Documents. The best way to look around.

![The hint shown when Caselore first opens a homebase: Super+D for everything](/screenshots/00-first-run-hint.png){.shot}

You can have as many homebases as you like, one per subject or one for everything. **⌘⇧O** switches between
them, as does the homebase's name at the bottom left.

## 2. Open the Docket

Press **⌘D**. The **Docket** drops from the top of the window with the cursor in its search box. Press **Esc** and
it goes, leaving your cursor where it was. Almost everything in Caselore is in here.

![The Docket open over a note, searching for Mabo](/screenshots/23-docket-search.png){.shot}

Type a few letters and results appear, grouped into notes, headings, authorities and commands:

| Keys | What they do |
|---|---|
| **↑ ↓** | Move through the results |
| **Enter** | Open it here |
| **⌘Enter** / **⌥Enter** | Open it to the right / below |
| **Shift+Enter** | Insert a link to it at your cursor |
| **→** | More actions for it: open beside, insert a link, lock, and what plugins add |
| **Esc** | Back one step, then close |

Words in `"quotes"` must appear as written, and `-word` leaves out notes containing it:
`negligence -contract`, `"duty of care"`.

### Prefixes

Start with one of these to search for one kind of thing:

| Type | To |
|---|---|
| `>` | Run a command: `>split`, `>export` |
| `+` | Make a note: `+Smith v Jones brief`, then Enter |
| `#` | Find folders and tags |
| `/` | Jump to a heading in this note |
| `@` | Find an authority you have cited |
| `~` | Search inside your outlines, with the points around each match |
| `?` | See every shortcut |

### Panels

Under the search box are the **panels**: Authorities, Outline, Subjects, Cite, Homebase, Layout, Study and Tasks
(depending on the homebase). **⌘1** to **⌘9** jump to one, or press **←** and **→** with nothing typed. **↑ ↓** and
**Enter** work in a panel as they do in the results.

**⌘⇧D** pins the Docket open above your note, for when you want a panel in view while you write.

## 3. Write

Notes are Markdown, shown as you write it: headings, lists, bold and links take shape as you type, and the marks
show again when the cursor is on them.

Type **`/`** at the start of a line for blocks: headings, lists, tables, tasks, a footnote, today's date, or a whole
**case brief** or **IRAC answer** scaffold.

- **Link** to another note with `[[` and its name (or Shift+Enter in the Docket).
- **Cite** with a footnote: **⌘⌥F** (Super+Alt+F on Linux) inserts one, and as you type a case name the AGLC4 plugin suggests the rest.
- **Tag** with `#tag`, and add properties (subject, due date, deck …) at the top of the note.

![An essay in live preview, with its properties at the top and the printed pages beside it](/screenshots/01-main-crisp-light.png){.shot}

## 4. Arrange your screen

Notes tile into panes from the keyboard: **⌘\\** splits to the right, **⌘⇧\\** splits down, **⌘⌥ arrows** move
between panes, and **⌘⇧Enter** zooms one pane to fill the window. The **Layout** panel has ready-made layouts
(Single, Brief + Source, Revision, Exam) and saves your own.

## 5. Make it look right

The **gear** at the bottom left, beside the homebase's name, opens Settings. Under **Appearance**: sixteen colour
palettes in light and dark, an accent colour, fonts, the **density** (Compact, Comfortable or Spacious) and the icon
set.

![Settings, Appearance](/screenshots/10-settings-appearance.png){.shot}

## Next

- [The Docket](./docket) in depth: actions, every panel, and making panels of your own.
- For law school: [AGLC4 citations](./aglc4), [flashcards](./study), [searching outlines](./outlines) and
  [tasks](./tasks).
- [Keyboard shortcuts](./shortcuts), all on one page.
- Questions or ideas: [open an issue on GitHub](https://github.com/blursedperf/Docketeer/issues).
