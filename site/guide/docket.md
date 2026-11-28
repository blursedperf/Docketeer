# The Docket

The Docket is the heart of Docketeer: one tray, dropped from the top of the window, that holds search, commands and
every panel. There are no sidebars to manage. Press **⌘D**, do what you came for, press **Esc**, and you are back in
your note with the cursor where you left it.

![The Docket open over an essay](/screenshots/23-docket-search.png){.shot}

## Opening and closing

| Keys | |
|---|---|
| **⌘D** (Super+D on Linux) | Open the Docket, or close it |
| **⌘⇧D** (Super+Shift+D) | Switch between **peek** (over the note, gone when you are done) and **pinned** (docked above the note) |
| **⌘⌥↓ / ⌘⌥↑** | Make it taller or shorter (or drag its lower edge) |
| **Esc** | Back one step: actions, then results, then clear the search, then close |

Where it opens depends on where you are: with the cursor on a case name it opens on that authority, in a footnote on
the Cite panel, and otherwise on the panel you used last. Its mode, height and last panel are remembered.

Pinned, **Esc** gives the keyboard back to your note but leaves the Docket in view, so a panel (the outline, say)
can stay beside your writing. **⌘D** takes the keyboard again.

You can change the Docket key under **Settings → Hotkeys**.

## Searching

Type and results appear at once, grouped: notes by name (ranked by what you use and where you are), the text inside
notes (with the matching line), headings in every note, authorities, commands and settings. Each group shows its
best few, with **Show all**.

- `"duty of care"`: these words, together and in this order.
- `negligence -contract`: leave out notes containing a word (or `-"some words"`).
- No note with that name? **Create note “…”** makes one, and → chooses the folder it goes in.

| Keys | |
|---|---|
| **↑ ↓** | Move through results (↑ at the top goes back to the search box) |
| **Enter** | Open here |
| **⌘Enter** / **⌥Enter** | Open to the right / below |
| **Shift+Enter** | Insert a link to it at your cursor |
| **→** or **⌘.** | Its actions |
| **Tab / Shift+Tab** | Between the search box, the results or panel, and the panel tabs |

### Prefixes

| Type | |
|---|---|
| `>` | Commands, each with its key: `>split`, `>export` |
| `+` | A new note: `+Smith v Jones brief`, Enter (→ to choose where it goes) |
| `#` | Folders and tags |
| `/` | Headings in the note you are in |
| `@` | Authorities |
| `~` | [Outlines](./outlines): your words with the points around them |
| `?` | The cheat sheet: every shortcut, as you have set them; Enter runs one |

## Actions

Press **→** on any result or row (or right-click it) for what can be done with it. For a note: open it to the right
or below, see the notes linking to it and the mentions not yet linked (→ on one turns it into a link), pin, rename,
move, copy, archive, lock or delete it, and whatever plugins add, such as *Export to Word*. An authority offers its
next place, every note citing it, and citing it again; a task offers checking it off and new due dates.

**←** or **Esc** comes back.

## Panels

The tabs under the search box are panels. **⌘1** to **⌘9** jump to one; with nothing typed, **←** and **→** step
through them. Inside a panel, **↑ ↓** move and **Enter** acts, as with results.

| Panel | What it holds |
|---|---|
| **Authorities** | The cases, legislation and secondary sources cited in the note, how often each appears, with a jurisdiction filter. Enter goes to the next place it is cited. See [AGLC4](./aglc4). |
| **Outline** | The note's headings. Enter jumps to one; **⌥↑ ↓** moves a section, **⌥← →** changes its level. A case brief lists Facts, Issues, Held, Ratio and Obiter and adds any that are missing. |
| **Subjects** | Your subjects and topics (folders you mark) with their notes, and your pinned and recent notes. See [Homebases](./homebases). |
| **Cite** | Build an AGLC4 citation from a form and insert it as a footnote. |
| **Homebase** | The whole homebase as a tree of files and folders, and what can be done with it. |
| **Layout** | Ready-made and saved pane layouts. See [Panes](./panes). |
| **Study** | The focus timer and your flashcard decks. See [Study](./study). |
| **Tasks** | Every task in the homebase, by when it is due. See [Tasks](./tasks). |

### Your own panels

Panels can be hidden, put in another order, and made from scratch. Run **Arrange the Docket's panels** (also in the
Homebase panel) to show or hide each one and move it earlier or later. **New Docket panel…** makes a panel of your
own from any mix of:

- **Commands**: the ones you use most, each with its key;
- **A file tree**: a folder and everything in it;
- **A note list**: notes in a folder, with a tag, recent, pinned, or matching a search;
- **A built-in section**: what another panel shows, such as the Outline.

Everything is chosen from lists, so it all works from the keyboard. With a mouse you can drag tabs, panels and
elements into a new order instead.

## Drag and drop

Drag a file or folder in a file tree onto a folder to move it there (links to it are updated). Drag a note, PDF or
recording from the Docket into a note to link or embed it.
