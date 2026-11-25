# Shortcuts

The live list, generated from the keymap with your changes, is in the Docket: type `?`.
Mod is Ctrl on Linux and Windows, ⌘ on macOS. All can be changed in Settings → Hotkeys.

## Docket (with the Docket setting on)

| Keys | Action |
|---|---|
| Super+D (⌘D on macOS, Ctrl+P on Windows) | Open or close the Docket (change it under Settings → Hotkeys → Docket key; it applies to every homebase) |
| Super+Shift+D (⌘⇧D, Ctrl+Shift+P on Windows) | Switch between peek and pinned |
| Mod+1 … Mod+9 | Show a panel (while the Docket has the keyboard) |
| Mod+Alt+↓ / ↑ | Taller / shorter |
| ↑ ↓ | Move through results and panel rows; ↑ at the top goes back to the search |
| ← → (nothing typed) | Previous / next panel |
| Enter / Mod+Enter / Alt+Enter | Open here / to the right / below |
| Shift+Enter | Insert as a link at the cursor |
| → or Mod+. | More actions for the result |
| Tab / Shift+Tab | Input, results or panel, panel tabs |
| Esc | Back one step, or close |

## Prefixes

`>` commands · `#` folders and tags · `/` headings in this note · `?` shortcuts · `@` authorities (Phase 4) ·
`+` new note (`+Smith v Jones brief`, Enter; → to choose where it goes)

## Tiling (Phase 5)

| Keys | Action |
|---|---|
| Mod+\ | Split right |
| Mod+Shift+\ | Split down |
| Mod+Alt+← → ↑ ↓ | Go to the pane in that direction |
| Mod+Alt+Shift+← → ↑ ↓ | Move the tab to the pane in that direction (a new pane if there is none) |
| macOS: ⌘⌃← → / ↓ ↑ · elsewhere: Mod+Alt+[ ] / = - | Pane narrower / wider / taller / shorter |
| Mod+Shift+= | All panes the same size |
| Mod+Shift+Enter | Zoom the pane to fill the window, and back |
| Mod+W | Close the tab (an empty pane closes) |
| Mod+Shift+T | Reopen the last closed tab |
| Ctrl+Tab / Ctrl+Shift+Tab | Next / previous tab in the pane |

Layouts: Layout panel (Mod+6) or `>layout`: Single, Brief + Source, Revision, Exam, and layouts you save.

## Slash commands

Type `/` at the start of a line or after a space, then a few letters to filter (`/tab`, `/h2`, `/brief`), and
Enter. It does not open inside a word (`and/or`), after `/ ` or in code.

| Item | Inserts |
|---|---|
| Heading 1–3, Bulleted list, Numbered list, Task, Quote | Turns the line into that kind of line, keeping its text |
| Table, Table two columns | A table on lines of its own, with "Column 1" selected to type over |
| Code block, Divider | On lines of their own |
| Link to a note, Embed a recording, PDF or picture | `[[` or `![[`, with name completion |
| Footnote | The AGLC4 plugin's footnote (or a plain `[^n]`) |
| Highlight, Comment, Today's date | At the cursor |
| Timestamp in the recording | When a recording is playing (as Alt+T) |
| Case brief, IRAC answer | The headings of the scaffold, the cursor under the first |

## Recordings

These act on the recording in use: the one last played or clicked, embedded in a note or in its own tab. They
work while you type. On macOS, Alt is ⌥ (Option).

| Keys | Action |
|---|---|
| Alt+T | Insert a timestamp link at the cursor (`[[Week 3.mp4#t=12:34\|12:34]]`) |
| Alt+K | Play or pause |
| Alt+J / Alt+L | Back / forward 5 seconds |
| Alt+, / Alt+. | Slower / faster (0.5× to 3×) |

## PDFs

| Keys | Action |
|---|---|
| Alt+Q | Quote the text selected in a PDF into the note, with a link to its page (`> … ([[Smith v Jones.pdf#page=12\|p 112]])`) |

Right-click a PDF page for *Quote in note*, *Copy* and *Copy link to this page*. The toolbar has the page (type a printed
page label such as `iv` or `112`, or a page number), zoom and *Fit the width*.

## Homebases

| Keys | Action |
|---|---|
| Mod+Shift+O | Switch homebase: recent homebases, open a folder, create one, or the example homebase |

The homebase's name at the left of the status bar opens the same list.

## Locking

| Keys | Action |
|---|---|
| Mod+L | Lock now |

Lock a note or folder from its actions (→ in the Docket), or with "Lock note" / "Lock folder". Unlock by
opening a locked note, from the status bar lock, or with "Unlock".

## In Subjects

In **Homebase › Files**, N and F on a row make a new note or folder there, and opened folders end with *+ New note* and *+ New folder*.

Subjects lists the folders marked as subjects and topics, with their notes; an opened subject ends with "+ New note" and "+ New topic". Mark a folder with → on it, here
or in **Homebase › Files**, which lists every file and folder in the homebase. Marks are kept in
`.quire/units.json`; the folders themselves are not changed.

| Keys | Action |
|---|---|
| N / T | New note / new topic in the selected folder |
| F2 | Rename the selected note or folder |
| Delete (⌘⌫ on macOS) | Delete the selected note or folder (asks first; a folder says how many notes it holds) |
