# Changelog

## Unreleased

- **Quire is now Docketeer**, because another app already uses the name Quire. It has a new icon. The first time
  Docketeer starts, it brings across Quire's recent homebases and app-wide settings, and an example homebase
  already in "Quire example" in your Documents keeps opening. Homebases are unchanged: their settings stay in
  `.quire/`, and locked notes, themes and plugins work as before. On Arch and Debian/Ubuntu the `docketeer`
  package replaces `quire`; on macOS, delete the old Quire.app.

## v0.20.0

- **Export to PDF**: a note on white A4 pages as it reads in reading view (its properties, headings, lists and tasks,
  tables, pictures, embedded notes and footnotes), numbered at the foot, saved beside the note as "Note.pdf"; if one
  is there already, Quire asks whether to replace it or save a new one. Offered in a tab's right-click menu, the
  editor's, a note's actions and right-click menu in the Docket, and as the command *Export to PDF*. An open note is
  exported as it is now; a locked one only after a warning that the PDF is not encrypted. The page is printed by a
  hidden window that runs no scripts and loads nothing from outside Quire.
- **AGLC4: Export to PDF with AGLC4 footnotes**, beside the Word and HTML exports (in the same menus, and a command):
  the HTML export's page, with its footnotes and bibliography, printed to PDF and kept in the version history like
  the others.

## v0.19.1

- **Tasks are checked off in the Tasks panel**: click a task's box, or press Space on its row; the Docket stays open
  and the next task is selected, so a list can be worked through from the keyboard. Space or a click again (in
  *Done* or *All*) reopens one.
- **Opening a task puts the caret at the end of its line**, ready to add to it, instead of at its start. (For
  plugins: a note's ephemeral state takes `ch` with `line`.)

## v0.19.0

- **A calculator in the / menu**: type arithmetic after the slash (`/12*3.5+4`, `/(1200-300)/3`, `/15% of 80`,
  `/2^10`, `/sqrt(2)`) and the menu offers the answer first (`= 46`, which inserts 46), then the working with its
  answer (`12 × 3.5 + 4 = 46`). It knows + − × ÷ (and * / x), powers, brackets, percentages, thousands separators,
  sqrt, abs, round, floor, ceil, ln, log, pi and e. Worked out by Quire's own parser: nothing typed is run as code.
- **Right-click in the Docket**: a row or a search result has a menu of what → offers for it: a note's Open, Open to
  the right, Open below, rename, move, copy a link …; an authority's next place, cite or merge; a task's check off,
  due dates and priorities. The Docket stays open while the menu is.
- **Fuller tab menus**: right-clicking a tab now also offers *Close the other tabs*, *Close tabs to the right*
  (pinned tabs stay), *Pin*, *Duplicate tab*, *Split left* and *Split up*, and *Move to the pane right / below /
  left / above*, as well as its note's actions. Right-clicking the empty part of a tab bar offers a new tab,
  reopening a closed one, splitting, stacking, and the pane's own: zoom, same sizes, turn the split, every tab in one
  pane, close the other panes, close this pane.
- **Stacked tabs fill the pane**: when closing tabs leaves fewer than fill the pane, the ones left grow to share its
  width, so a single stacked tab takes the whole pane, instead of keeping their reading width with empty space beside.
- **More tiling commands**, each of which can be given a hotkey in Settings → Hotkeys: *Split left*, *Split up*,
  *Swap this pane with the one left/right/above/below*, *Go to the next/previous pane*, *Go to pane 1–9*, *Turn the
  split* (side by side ↔ one above the other), *Close this pane*, *Close the other panes*, *Close the other tabs in
  this pane* and *Put every tab in one pane*. Each saved layout is now a command too (*Layout: name (saved)*), so a
  layout can have a key of its own.

## v0.18.0

- **Renaming any file updates the links to it**: renaming a recording, picture or PDF (from the Docket, the Outline's
  links, a tab or the title) now rewrites `![[clip.mp4]]`, `![[media/clip.mp4|400]]` and `![](media/My%20clip.mp4)`
  in every note, as it already did for notes. Moving a file or a folder updates links written as paths, relative
  ones included, and each link keeps the form it was written in (name or path, ".md" or not, alias, size, heading).
- **Enter finishes a link**: with the cursor just before a link's `]]` (or between the two brackets), Enter steps out
  of the link instead of breaking the line, also after an alias (`[[Note|text]]`) where no suggestions are shown.
- **Selected text has one highlight**: the browser's own selection was painted over the editor's, so selected text
  showed two overlapping highlights.
- **Live preview keeps the cursor's line formatted**: only what the cursor touches shows its Markdown (one **bold**
  word, one link, one highlight, a list marker), and the rest of the line stays formatted. A heading's `#` and a
  quote's `>` still show on the cursor's line.
- **Lists in live preview look as they do in reading view**: each level indented the same amount, bullets by level
  (•, ◦, ▪), numbers and task boxes in the space before the text, and wrapped lines starting under the text rather than
  under the marker. A marker shows as written while the cursor is on it, in the same place, so the text does not move.
  Reading view's markers take the accent colour.
- **A hidden embed is easy to get back to**: a picture or player has a button (on hover) that shows its `![[…]]` with
  the cursor in it, and a right-click menu: open, open in a new tab or to the right, rename the file, copy, show the
  text, remove the embed.
- **A fuller right-click menu in the editor**: on a link, Open link (or Create note), Open in new tab, Open to the right,
  Rename, Copy link; on a selection, Bold, Italics, Highlight, Strikethrough, Inline code and Make a link; Insert link
  with nothing selected; and Undo and Redo. Menus no longer end in a separator.
- **Properties are edited in place** (live preview): each property is a row with its name and a field for its value,
  chosen by the value: chips for a list, a checkbox, a number, a date picker, or text. Names and values are suggested
  from the homebase's other notes as you type (tags include the ones written in notes), ↑↓ and Enter choose one, and
  a new property gets the kind of field its name has elsewhere. "+ Add property" (or **Mod+;**, *Add a property*,
  which also starts a note's first property) adds a row; × removes one; editing a name renames it. Changes go straight
  into the YAML with its comments and order kept, and "Edit as YAML" shows it as written.
- **Hover preview**: resting the mouse on a link to a note, in the editor or in reading view, shows the note (or the
  section or block the link points to) in a popup beside it. Holding Ctrl (⌘) shows it at once. The popup can be
  scrolled and its links followed; it goes when the mouse leaves it, on Escape or on a click elsewhere. *Settings →
  Editor → Hover preview*: on a pause, only with Ctrl/⌘, or off. Plugins hear of it through the "hover-link" event.
- **Quick templates**: every note in the templates folder (*Settings → Editor → Templates folder*, "Templates" by
  default) is a template, offered in the / menu and by *Insert template…*; *New note from template…* makes a note
  from one, and *Save as template…* turns the selection (or the note) into one. `{{title}}`, `{{date}}`, `{{time}}`
  (or a format: `{{date:D MMMM YYYY}}`) are filled in, `{{cursor}}` is where the cursor goes, and a template's
  properties join the note's own.
- **Task Docket, a second built-in plugin**: every checkbox task in the homebase in a **Tasks** panel in the Docket,
  grouped by when it is due (overdue, today, tomorrow, the next 7 days, later) and sorted by urgency; or by
  priority, note or tag. Enter opens a task in its note; → checks it off, makes it due today, tomorrow or in a
  week, sets a date or a priority. Due dates and priorities are read in the Tasks plugin's emoji and Dataview's
  fields; typing @ on a task line suggests them (@tomorrow, @fri 9am, @high). The status bar counts what is overdue
  and due today. In homebases made before this version it is turned on once; *Settings → Plugins* turns it off.
- For plugins: a Docket panel's `render` gets `ui` (rows, sections and action lists like the Docket's own),
  `app.docket.showPanel(id)` and `refreshPanel(id)`; the metadata cache has `listItems` (tasks among them) and
  `getPropertyKeys()` / `getPropertyValues(key)`; `InputSuggest` puts suggestions under any text field.

## v0.17.3

- **Stacked tabs can be closed one by one**: stacking hides the tab strip, and its close buttons went with it. Each
  tab's spine now has its own ×, shown on hover and on the current tab, and a middle-click on a spine closes it too,
  as on a tab. Renaming a note no longer clears its spine.

## v0.17.2

- **The "+" rows say only what they make**: *New note*, *New topic* and *New folder*, not "New note in Constitutional
  Law and Human Rights Week 3", which crowded the list when folders have long names. Their indent shows the
  folder they belong to, and screen readers and the row's tooltip still say it in full.

## v0.17.1

- **Panels start at the top**: opening the Docket on a panel, choosing a panel or clearing the search shows it from
  its first row, and ↓ goes to that row. Before, a panel could open scrolled to where another one was left.
- **Moving through short sections is smooth**: the selected row keeps a margin of one row above and below it, so it
  stays at the same place on screen while the list moves under it, by exactly what lies between two rows (a title
  and its gap included). Before, the room kept below it depended on whether the next row was in the same section,
  so the list lurched at sections of a title and one or two rows.
- The mouse's row only lightens, and a panel's "current" row (the active pane in Layout, the authority at the
  cursor) is marked by its name in the accent colour, so neither looks like the keyboard's row.
- A panel drawn again after a change (a folder opened, a note renamed) keeps its scroll and its row, without the
  browser scrolling the row to an edge.

## v0.17.0

- **Tables stay tables while you type in them** (live preview). Click a cell, or arrow into the table from the line
  above or below, and edit it in place: the cell shows its Markdown while it has the cursor, and every keystroke goes
  into the note with the columns lined up. Tab / Shift+Tab and the arrow keys move between cells, Enter goes down a
  row (adding one at the foot), Escape leaves the table, and undo works from a cell. The table commands (Alt+Enter …)
  act on the cell you are in. Source mode still shows the Markdown.
- **Empty table cells keep their shape**: every cell is at least 5em wide and a row tall, and an empty one shows a
  faint dash, so new rows and columns read as a grid instead of a squashed line. Short words no longer break inside
  a narrow cell.
- **Moving through the Docket is even** (see docs/research/docket-rows.md): every row is one height, with its
  detail on the same line; full-text matches keep their matching line, every row of that group the same two-line
  height. Group and section titles stay at the top of the list while their rows scroll, so you can always see which
  group you are in. The list keeps a row of context above and below the selection and never scrolls the rest of
  the window. Moving onto a group's first row brings its title into view, rather than lurching past it.
- **Fixed**: the focus ring of a full-width text box in a dialog (Rename, New note, Unlock …) was cut off at the left
  and right, so only its top and bottom showed. The dialog now leaves room for it; nothing moves.

## v0.16.2

- **Units is now called Subjects**: the Docket panel, its help, the "Mark as subject" and "Remove from Subjects"
  actions, *Pin to Subjects*, *Show this note in Subjects*, the cheat sheet and the docs. Nothing to redo: the same
  folders stay marked (they are still kept in `.quire/units.json`), and searching "Units" still finds the commands.
- **"+ New topic" under each opened subject**, after "+ New note": Enter asks for the name, then makes the folder
  and marks it as a topic (T on any row still does the same).

## v0.16.1

- **The Docket key is now Super+D** (⌘D on macOS), and switching it between peek and pinned is Super+Shift+D.
  Windows keeps Ctrl+P and Ctrl+Shift+P, because Windows uses Win+D to show the desktop and never passes it to apps.
  A key you chose under *Settings › Hotkeys* stays as it is.
- **Insert footnote (AGLC4) has a key: Super+Alt+F** (⌘⌥F on macOS).
- Shortcuts call the Super key *Super* on Linux and *Win* on Windows, and list modifiers in the usual order
  (Super+Alt+F, Ctrl+Alt+Shift+K). The empty-tab links, the Docket mode setting, the README, the example homebase and
  the AGLC4 guide show the keys as they are.
- The empty Docket search shows `+` (create a note) among the prefixes.
- **More kinds of source in the Cite panel** (Docket › Cite), each formatted to AGLC4, with Ibid and "(n X)" worked
  out as before:
  - **Government report**: a department, inquiry or royal commission (*Final Report, vol 1*, and the date).
  - **Productivity Commission report**: inquiry and draft reports.
  - **Law reform commission report or paper**, with paragraph pinpoints ([5.12]).
  - **Web page**: the page's title, the site, the date and the URL.
  - **Treaty**: opened for signature, the treaty series, entry into force, and article pinpoints.

## v0.16.0

- **Quire ships its own fonts**, so it looks the same on every computer: **Inter** for the interface and notes,
  **JetBrains Mono** for code and the chrome (tabs, file tree, status bar), and **Source Serif 4** as a serif for note
  text (*Appearance › Text font*). Latin and Latin Extended (accents, macrons), regular to bold and italic: 588 KB in
  all, loaded from the app, offline. The system's own fonts remain a choice in each font dropdown.
- **Chambers Dark and Chambers Light**: muted, formal palettes. Warm charcoal or ivory paper, ink blue, oxblood, brass
  and sage, every pairing meeting WCAG AA.
- **Title bar hidden by default**: the window buttons sit in Quire's top bar (the Docket bar), which moves the
  window, as in Obsidian. *Appearance › Window › Title bar* switches back to the system's, with a Restart button.
- **Dropdowns draw their own arrow**, in the theme's colour and set in from the right edge (the system arrow sat
  against it).

## v0.15.2

Buttons, spacing and settings (see docs/research/ui-review.md):

- **Fonts are chosen from a list.** Interface, text and monospace font are dropdowns of the fonts installed on this
  computer (read from the font folders, offline), monospaced fonts first for the monospace font, with a line of sample
  text in the chosen font. *Other…* still lets you type a name.
- **Dialog buttons** are laid out one way everywhere: at the right, spaced, the main action last. Delete and Export
  had them touching at the left.
- **Deleting asks with a red *Move to trash*** rather than a blue *Continue*; removing a lock says *Remove lock*.
- *After idle time* (Security) is a styled number box with "minutes" after it, and the passphrase boxes in the
  lock dialogs match the other fields.
- Settings controls end at the same place on every page, whether it scrolls or not.
- Shorter *Default location for new notes* options, so none are cut off.
- Ordinary settings buttons are no longer in the accent colour; the snippets buttons sit in a named row at the right.
- Text-box rows (*Your dictionary*, AGLC4 *Folders*) put their name at the top beside the box.
- The PDF toolbar stays on one line in a narrow pane.

## v0.15.1

0.15.0 was tagged but not published (its release build failed a test); 0.15.1 is everything listed under 0.15.0,
and:

- **Fixed**: *Every note citing this* (Authorities) missed a note whose citation was typed but not yet saved (notes
  save half a second after typing stops). Notes open in an editor are now searched as they are on screen.

## v0.15.0

- **Back and Forward.** Each pane remembers what it showed: when a note is replaced by another (a link followed, a
  note chosen), **Back** brings it back, with the cursor where it was, and **Forward** returns. ← and → at the left
  of the header band, **Alt+←** and **Alt+→** (**⌘[** and **⌘]** on a Mac, where ⌥← moves by word), and the mouse's
  back and forward buttons. Notes deleted since are skipped.
- **The Docket opens notes in a new tab.** A note chosen in the Docket no longer replaces the one you are in: it opens
  in a new tab, or goes to the tab already showing it (an empty tab is reused). Settings → Files and links → *Open
  notes from the Docket in a new tab* turns this off.
- **Stacked tabs.** *Toggle stacked tabs* (a command, and *Stack tabs* in a tab's right-click menu) lays a pane's
  tabs side by side at a reading width, scrolling sideways; each has a spine with its title, and tabs fold into
  spines at the edges as you scroll. Click a spine to bring its tab into view. Kept with the layout.
- **Tables while you write.** In live preview a table is drawn as a table (with its bold, italics and links) until you
  click into it; clicking a cell puts the cursor in that cell of the Markdown. Hover it for **+** at the right edge (a
  column) and the foot (a row). Editing a table, **Tab** and **Shift+Tab** go to the next and previous cell and line
  the columns up; Tab in the last cell adds a row. **Alt+Enter** adds a row below, **Alt+Shift+Enter** a column to
  the right; *Table:* commands add rows above and columns to the left, delete rows and columns, and line the columns
  up, and they are in the right-click menu in a table. Tab outside a table indents as before.
- **"+" in the Docket makes a note.** Type `+` and a name (`+Smith v Jones brief`), Enter: the note is made in the
  usual place and opened; → chooses another place. If a note of that name exists, it is offered first.
- **AGLC4's page preview and version history open beside the note**, in the pane to the right or a new one, as PDFs
  and recordings do, instead of over it. (Plugins' "right sidebar" views all open this way now.)
- **Fixed**: after splitting right and closing the new pane, the pane left filled only half the window. Panes now
  always share the whole window; a tab dragged onto a pane's edge takes half that pane, as splitting does.

## v0.14.0

- **Drag and drop in the Docket.** Drag a file or folder in Homebase › Files, Units, or a panel's file tree onto a
  folder (or onto a folder's *+ New* rows, or the top's) to move it there; links to it follow. A folder will not go
  inside itself. Drag a note, PDF or recording from the Docket into a note to link or embed it. Drag a Docket tab
  onto another tab to reorder the panels, and in panel editing, drag a panel onto another in *Arrange the Docket's
  panels*, or an element onto another in a panel's list of what it shows.
- **Legal or Generic, for a new homebase.** Creating a homebase now asks which panels it starts with: **Legal**, as
  Quire comes, or **Generic**: *Files and Folders* (the whole homebase as a tree), Homebase and Layout, with the law
  panels hidden (they can be shown again). On the welcome screen, and in *Switch homebase* › *Create a new homebase*.
- **Plugin API**: a search result can be dragged into another order (`reorder` on `SearchResult`).

## v0.13.0

- **Your own Docket panels.** Build panels from **commands** (any command, a plugin's too, with its key), **file
  trees** (any folder, or the whole homebase), **note lists** (in a folder, with a tag, recent, pinned, or matching
  words) and **built-in sections** (Units, Outline, Authorities, Layout …), in any order, each under its own heading.
  *New Docket panel…* asks for a name and shows what it holds, with ways to add each kind; *Customise this panel…* at
  the end of one changes it. All from lists in the Docket, so from the keyboard.
- **Arrange the panels.** *Arrange the Docket's panels* (a command, and in Homebase) lists every panel, yours and the
  built-in ones: hide one (Authorities and Cite, say, for notes that are not legal), or move it earlier or later; the
  Mod+number keys follow. *Show every panel in its usual order* undoes it.
- Panels and their arrangement are kept in `.quire/panels.json`, which can also be edited by hand
  ([docs/docket/panels.md](docs/docket/panels.md)).
- **Plugin API**: `app.docket.allPanels()`, `setArrangement()` and `arrangePanels()`; `orderedPanels()` leaves out hidden
  panels.

## v0.12.1

- **New notes and folders from Homebase › Files.** Each opened folder, and the top of the homebase, ends with
  *+ New note* and *+ New folder*; on any row, **N** makes a new note and **F** a new folder there (in a folder's
  row, that folder; on a file, beside it). Both are also in a folder's actions (→). The note gets the usual name
  dialog with the place already chosen, and opens; a new folder shows, opened, in the tree. Folders made here are
  not marked as units: mark them with → when they should be.

## v0.12.0

- **Units shows what you mark.** Only folders marked as a **subject (unit)** or **topic** appear in Units, with
  their notes; attachments, readings folders and scratch folders no longer crowd it. Mark a folder with → on it
  (*Mark as subject (unit)*, *Mark as topic*, *Remove from Units*), in Units or in Homebase › Files. New subjects
  and topics made in Units are marked as they are made, and marks follow a folder that is renamed or moved. For a
  homebase with nothing marked yet, Units offers to mark the folders as it showed them before (top folders as
  subjects, the folders inside them as topics) in one go. Marks are kept in `.quire/units.json`; the folders are
  not changed. The example homebase comes marked.
- **Homebase › Files: the whole homebase as a tree.** Every folder and file, folders first, with an icon for each
  kind (note, PDF, recording, picture) and each folder's mark and file count. Enter opens a file (Ctrl+Enter to the
  right) or opens and closes a folder; → for its actions, F2 renames and Delete deletes. It opens the way to the
  note you are in.
- **Version history from the keyboard.** In the AGLC4 plugin's version history, ↑ and ↓ (and Home, End, Page Up,
  Page Down) choose a version and show its changes at once; Enter goes to its actions (Restore, Restore as a copy,
  Name, Show full text) and Esc comes back. The list has the keyboard as soon as the tab opens, and choosing a
  version no longer reloads the whole list.

## v0.11.0

- **Slash commands.** Type `/` at the start of a line or after a space for a menu of things to insert: headings,
  bulleted and numbered lists, tasks, quotes, tables, code blocks, dividers, links and embeds, footnotes (through the
  AGLC4 plugin when it is on), highlights, comments, today's date, a timestamp in the recording, and two law
  scaffolds: a case brief (Facts, Issues, Held, Ratio, Obiter) and an IRAC answer. Type to filter (`/tab`, `/h2`,
  `/brief`). Headings, lists and quotes turn the current line into one, keeping its text; a table or scaffold goes on
  lines of its own, and a new table has "Column 1" selected so you can type its name. The menu stays out of prose
  (`and/or`, `this / that`) and code.

## v0.10.0

- **Properties as a table while you write.** A note's properties (the YAML at the top) show as the same small
  table as in reading view, instead of `---` and raw YAML. Click the table, or move into it from the text below,
  to edit the YAML; move away and the table is back. YAML with a mistake in it stays as written so it can be fixed.
- **The header says where the note is.** Since the note's name is the title above its text, the band above it
  now shows its subject and topic (*Torts › Negligence*); click one to see it in Units. A note at the top of the
  homebase shows the homebase's name. With *Note name as title* off, the band shows the name as before.
- **Writing and reading look alike.** Bold and italics inside lists now have the same colours as elsewhere (they
  were plain in the editor), and top-level headings have the same rule under them in both views.
- **Citations no longer look like links.** In the editor, `[1932]`, pinpoints such as `[78]` and `[2002] HCA 14`
  were drawn as links, because Markdown can read any `[text]` as one. Only links with an address, or with a
  reference defined in the note, look like links now.
- **A full stop stays with its link.** A full stop or comma straight after a link or bold text could wrap onto
  a line of its own.
- **Recordings and pictures sit right under the text.** A line holding only `![[…]]` no longer leaves an empty
  line above the player or picture; it comes back when you move onto it to edit it. An embed of a file that is
  not in the homebase now stays visible as written, so it can be fixed, instead of disappearing.
- **"café", "naïve", "rôle" are not marked as misspelt** when the dictionary has the plain spelling.
- **Names are not marked as misspelt.** Words in your notes' names ("Donoghue v Stevenson" teaches Donoghue and
  Stevenson) and in the authorities you cite in a note (*Wyong Shire Council v Shirt*) are accepted, with their
  possessives (Donoghue's). And a new setting, **Skip names** (Settings → Editor → Spelling, on by default), leaves
  capitalised words in the middle of a sentence alone: judges, parties, places. Words that start a sentence are
  still checked.

## v0.9.0

- **Change the Docket key.** Settings → Hotkeys starts with *Docket key*: click *Change…* and press the keys. It is
  the same in every homebase (it is kept with Quire's own settings, not in the homebase), and the handle at the top
  and the first-run hint show the new key at once. Keys that would type text, or that the system keeps for itself,
  are refused; a key another command uses is shown as a clash. The arrow puts back Ctrl+P (⌘P). The Docket command
  *Change the Docket key* opens the setting.
- **Switch homebases quickly.** *Switch homebase…* (Mod+Shift+O), or the homebase's name now at the left of the
  status bar, lists your recent homebases in the Docket, then *Open a folder*, *Create a new homebase* and *Open
  the example homebase*. A homebase whose folder has gone is marked *Not found*; opening it says so and takes it off
  the list. *Remove a homebase from this list* takes entries off without touching their folders. The welcome screen
  does the same, with × on each recent homebase.
- **An example homebase.** *Try the example homebase* (on the welcome screen, or in the switcher) copies a set of
  sample law notes into "Quire example" in your Documents and opens it: a topic summary, a case brief, a lecture
  note with a recording and timestamps, a reading with page links and quotes, and an exam checklist. Opening it
  again opens the same folder, with your changes. Its recording and reading are samples made for it.
- **Fixed**: recording a hotkey with ⌥ on macOS stored the symbol ⌥ types (˚ for ⌥K) instead of the key.
- Spellcheck no longer marks "homebase" or key names such as "Ctrl".
- **Plugin API**: `commands.setAppHotkeys` and `isAppCustomised` (hotkeys for every homebase), the
  `hotkeys-changed` event, and `physicalKey(event)`.

## v0.8.0

- **PDFs open in Quire.** Judgments, readings and slides open in a tab: pages appear as you scroll, with text you
  can select and copy, zoom and *Fit the width*, and a page box that takes the printed page (`iv`, `112`) as well
  as the page number. The tab remembers the page and zoom.
  - **Page links**: `[[Smith v Jones.pdf#page=12]]` opens the PDF beside the note at that page, or turns an open
    one to it.
  - **Quote with the page**: select text in a PDF and press Alt+Q (or right-click → *Quote in note*). It goes into
    the note you were writing as a quotation with a link back to its page, named by the printed page, for
    example `> The duty of care is owed … ([[Smith v Jones.pdf#page=12|p 112]])`. Words broken across lines
    are joined.
  - **Offline like the rest**: the PDF is read from the homebase and handed to the viewer as bytes; fonts come
    with the app; PDF scripts and forms do not run, and links inside a PDF are not followed. The viewer loads
    only when a PDF is first opened. The offline audit checks that it stays set up this way.
  - Not yet: PDFs protected by a password, search inside a PDF, and following links inside a PDF.
- **Lecture recordings in your notes.** Embed a recording with `![[Week 3.mp4]]` (or drop the file in) and it
  plays below the line, in the editor and in reading view, and keeps playing while you type. Video, and audio
  such as M4A, MP3 and WAV, are supported. Add `#t=12:34` to start there, or `|480` for a width.
  - **Timestamps.** Alt+T inserts a link to the moment you are at, like `[[Week 3.mp4#t=12:34|12:34]]`.
    Clicking it jumps the player there. If the recording is not on screen it opens in a tab beside the note,
    so the note stays in view.
  - **Keys that work while you type**: Alt+K play or pause, Alt+J / Alt+L back or forward 5 seconds,
    Alt+, / Alt+. slower or faster. They act on the recording you last played or clicked.
  - **Captions**: a `.vtt` file with the same name beside a video is shown as its captions.
  - Opening a recording on its own shows it in a tab, which remembers where you were.
  - Links to a recording that is not in the homebase say so instead of making an empty note.
- **Fixed**: on macOS, shortcuts with ⌥ and a letter never matched, because ⌥ types a symbol (⌥K is ˚).
- Leaving reading view stops what it was playing; closing a note releases its editor.
- **Recordings stream from disk.** Video and audio in the homebase are read as they are needed rather
  than all at once, so a long lecture recording opens at once and can be skipped through. Notes, HTML and
  scripts are never served as files.
- **Plugin API**: `app.media` (the players on screen and the one in use), `MediaView`, `createPlayer`,
  `timestampLink` and the timestamp helpers; `workspace.openBeside` opens a source beside the note.

## v0.7.1

- **The note's name is its title.** Each note shows its name as a title above its text. Click it (or press ↑
  on the first line), type a new name and press Enter, ↓ or click away: the note is renamed and links to it
  follow. Esc puts the old name back. Names with / \ or : and names already used in the folder are refused.
  The title is not part of the note's text, so your own headings stay as they are. Reading view shows it
  too; Settings → Editor → "Note name as title" turns it off.

## v0.7.0

- **Arrow keys in the Docket**: ↑ from the first result or panel row goes back to the search; with nothing
  typed, ← and → move to the previous or next panel.
- **Delete and rename from the Docket**: in Units, Delete (⌘⌫ on macOS) deletes the selected note or folder,
  and F2 renames it. Deleting a folder says how many notes it holds and asks first; the keyboard then goes to
  the next row. Locked notes are only deleted with the homebase unlocked.
- **The Docket keeps up**: notes and folders you create, rename, move or delete while it is open show at once.
- The `?` cheat sheet lists the new keys, and the keys for Units.

## v0.6.0

- **Locking.** Lock a note, or a folder (a subject or topic), and it is encrypted on disk: other apps see
  only "This note is encrypted by Quire". Set it up once (Settings → Security, or "Set up locking"): a
  passphrase, and a recovery key shown once to keep somewhere safe. One passphrase unlocks every locked note.
  - **Lock now** with Ctrl+L (⌘L) or the lock in the status bar. Open locked notes are saved and closed and
    nothing of them stays in memory. Quire also locks after 15 idle minutes and when the computer sleeps or
    the screen locks (both can be turned off), and always starts locked.
  - While locked, locked notes show only as names with a lock in Units; search, Authorities, links, embeds
    and previews show nothing of them. Opening one asks for the passphrase.
  - Forgot the passphrase? "Use the recovery key…" lets you set a new one.
  - New notes in a locked folder are encrypted too. Remove a lock from a note's or folder's actions.
  - File and folder names, and attachments, are not encrypted. Exporting a locked note warns first.
  - The AGLC4 plugin keeps no version history of locked notes.
- **Drag tabs**: along the tab bar to reorder, onto another pane to move (its edges split it), or to an edge
  of the window for a pane along that whole side. A preview shows where it will land.
- **Search finds subjects and topics** by name; Enter shows them in Units.
- A note found by its name is not listed again under "In notes".
- Typing **>** alone lists recently used commands first, then commands by section.
- Authorities and note text come before commands in search.
- Plugin buttons no longer duplicate the plugin's own commands.
- Clearer labels: "in <note>" for headings, "Torts / Negligence" for places.

## v0.5.1

- **New notes: the name first, and where it goes.** Ctrl+N (⌘N), or "New note" in Units, asks for the name
  and the subject or topic in one dialog (the open note's folder unless you choose another). No more
  "Untitled" notes to rename.
- **Units is easier to follow.** A line at the top explains subjects (your top folders) and topics (folders
  inside them), with the keys. On any row, **N** makes a new note there and **T** a new topic; each opened
  folder ends with "+ New note in …", and "+ New subject" closes the list. Folders show an arrow (open or
  closed) and a note count instead of a label on every row. The attachments folder is no longer listed.
- **Sorting** is still A–Z, now ignoring capitals and with numbers in order ("Week 2" before "Week 10").
- **Create a note from search, where you want it**: "Create note “…”" says which folder it goes in, and →
  lists every other subject and topic. It comes after the other results, so Enter opens the best match.
- **Fixed**: clicking a panel tab, or a row that redraws the panel, closed the Docket in peek mode. Clicking
  outside it still closes it, now also on the status bar.
- **Fixed**: saving the same file twice at the same moment (two settings changed together) could fail and
  lose one of the changes.

## v0.5.0

**The Docket replaces the sidebars.** Everything is now reached from the keyboard through one tray that drops
from the top of the window: **Ctrl+P** (⌘P on macOS). The first time Quire opens, a hint says so.

- **Search everything** from the Docket: notes by name (ranked by what you use and where you are), the text
  inside notes (from three letters, with the matching line and words marked), headings in every note,
  commands, settings and authorities. Each group shows its best few, with "Show all". If no note has the name
  you typed, "Create note" makes it. Prefixes: `>` commands, `#` folders and tags, `/` headings in this note,
  `@` authorities in this note, `?` the cheat sheet of every shortcut.
- **Keys in the Docket**: ↑↓ to move, Enter to open, Ctrl+Enter to the right, Alt+Enter below, Shift+Enter to
  insert a link at the cursor, → (or Ctrl+.) for more actions, Esc to step back. Peek (over the note) or
  pinned (above it): Ctrl+Shift+P. Resize with Ctrl+Alt+↑/↓.
- **Panels**, Ctrl+1 to Ctrl+6:
  - **Authorities**: the cases (with their citations), legislation (with sections) and secondary sources in
    the note, how often each appears, a jurisdiction filter; Enter goes to the next place; → finds every note
    citing it, cites it again, or confirms or merges an unsure find. Opening the Docket with the cursor on a
    case name goes straight to it.
  - **Outline**: jump to a heading; Alt+↑/↓ moves a section, Alt+←/→ changes its level; case briefs list
    Facts, Issues, Held, Ratio and Obiter and add a missing one.
  - **Units**: pinned and recent notes, then subjects and topics (your folders); create, rename, move, pin,
    archive and delete from the keyboard.
  - **Cite**: build an AGLC4 citation (cases, legislation, articles, books) and insert it as a footnote; it
    works out the full citation, Ibid or "(n X)" from the footnotes already there.
  - **Homebase**: what is in it, and export a note to Markdown or HTML after a confirmation, with comments,
    properties or names you list removed or blacked out.
  - **Layout**: presets (Single, Brief + Source, Revision, Exam), saved layouts and the open panes.
- **Actions on any note** (→): open beside, links to and from it, mentions not yet linked (→ turns one into
  a link), pin, rename, move, copy, archive, delete, and every action plugins add (Export to Word …).
- **Tiling from the keyboard**: Ctrl+\ split right, Ctrl+Shift+\ split down, Ctrl+Alt+arrows move between
  panes, Ctrl+Alt+Shift+arrows move the tab, Ctrl+Alt+[ ] - = resize (⌘⌃arrows on macOS), Ctrl+Shift+=
  even sizes, Ctrl+Shift+Enter zoom, Ctrl+Shift+T reopen a closed tab. The same note in two panes stays in
  step as you type.
- **Gone**: the sidebars (Files, Search, Tags, Backlinks, Outgoing links, Outline), the icon strip, the command
  palette and quick switcher. Their shortcuts open the Docket where each feature now lives. The AGLC4 page
  preview and version history open as normal tabs.
- **Faster with big homebases**: opening a note took seconds with thousands of notes (links were resolved
  by scanning every file); now milliseconds. Searching 10,000 notes takes a few milliseconds a keystroke.
- **Fixed**: a wide empty band between side-by-side panes; shortcuts with Shift and punctuation (Ctrl+Shift+\)
  never matched.
- **Privacy**: logs never contain note text, note paths or searches (checked on every build). The search
  index is kept in memory only.
- **Plugin API**: `registerCommand`, `registerDocketPanel`, `registerSearchProvider`, `registerResultAction`;
  commands gain `when`, `run(ctx, args)`, `section`, `aliases`, `keywords`, `context`, `confirm`,
  `requiresUnlocked`. Plugins written for sidebars still load: their views open as tabs and ribbon buttons
  become commands.

## v0.4.0

- **Search.** A search pane (Ctrl/Cmd+Shift+F, or the search tab in the left sidebar) finds text in every
  note: all the words, `"exact phrases"`, `-excluded` words, `path:` and `tag:` filters, match case. Results
  show each matching line; click to go there.
- **Backlinks and outgoing links.** The right sidebar shows which notes link to the open note, with the
  line each link is on, and notes that mention it without a link (one click makes it a link); and where the
  open note links to, including links to notes not written yet.
- **Tags and outline.** Every tag with its count, nested by `/` (click to search for it); the open note's
  headings, with the one the cursor is under marked.
- **Link completion.** Type `[[` for notes and files by name, then `#` for headings.
- Suggestions open when you type, not when a plugin or a command changes the text.
- **Hotkeys.** Settings → Hotkeys lists every command: add a hotkey by pressing it, remove one, or go back
  to the default. Clashes are flagged. Saved per homebase in `.quire/hotkeys.json`.
- **Vim mode.** Settings → Editor → Vim key bindings (codemirror-vim, MIT): modes, motions, operators,
  `:w` to save, `:q` to close the tab, `:wq`. The modeline badge shows NORMAL, INSERT, VISUAL.
- Auto-pair brackets now applies to open notes straight away.
- **Attachments.** Paste a picture (a screenshot, say) or drop files into a note: they are saved in the
  attachments folder (Settings → Files and links; the homebase's `attachments/` by default, or beside the
  note) and embedded (`![[picture.png]]`) or linked. A note dragged from the file tree becomes a link.
- **Embeds.** Pictures show under their `![[…]]` (or `![](…)`) line in the editor, at a width with
  `![[picture.png|300]]`. In the reading view `![[Note]]` and `![[Note#Heading]]` show the note or section
  in a framed box; other files show as a card. API: `fileManager.getAvailablePathForAttachment`.
- **Live preview**, on by default: Markdown is shown formatted while you write — headings without `#`,
  bold and italics without their marks, links as their text (click to open), bullets, task boxes you can
  tick, quotes and rules. The lines holding the cursor or a selection, and `%% comments %%`, show the
  Markdown as written. Footnotes are left as written. Turn it off in Settings → Editor, or with "Toggle
  live preview / source mode".
- **Spellcheck, offline.** Misspelled words are marked as you write; right-click for suggestions, "Add to
  dictionary" (saved in `.quire/dictionary.txt`) or "Ignore". English (Australia) by default, or British or
  US English (Settings → Editor → Spelling). Code, links, web addresses, frontmatter and — unless turned on
  — footnotes are not checked. The dictionaries ship with Quire; the browser's own spellchecker, which
  downloads dictionaries, stays off. **Legal terms** (on by default) accepts Latin legal terms, AGLC
  abbreviations (eg, ie, cf, ibid, sch, reg) and legal words general dictionaries lack (extinguishment,
  justiciable, estoppel …).
- **Editor menu.** Right-click in a note for spelling, cut, copy, paste and select all; plugins can add
  items through the `editor-menu` event.
- **Licences.** Settings → About → Licences shows the licences of every library, icon set and dictionary
  Quire includes.

## v0.3.0

- **Settings search.** A search box above the settings pages finds settings on every page, plugins'
  included; the results are the settings themselves, ready to change.
- **Contrast guard.** Every text colour is checked against the surface it is shown on (WCAG AA) whatever
  the palette or accent, and adjusted only where it falls short (modeline badge and key labels in some
  light palettes).
- **Ribbon.** App actions and plugin actions are separate groups.
- **Screenshot checks.** `npm run shots` is repeatable, `npm run shots:diff` compares with reference
  images, and a CI workflow runs tests, the smoke test and the comparison on every push.

## v0.2.0

- **Homebase.** The folder of notes is now called a homebase everywhere in the app (welcome screen,
  commands, settings, dialogs). `--homebase=<folder>` opens one directly. The plugin API keeps
  `app.vault`, with `app.homebase` as an alias.
- **Theming.** Settings → Appearance: 16 palettes for dark and light mode (from DoomEsque), accent colour,
  interface/text/monospace fonts, text size, density (compact, comfortable, spacious), icon set and
  weight, installed CSS themes (`.quire/themes/`) with a starter template, and CSS snippets
  (`.quire/snippets/`). Themes and snippets that would load anything from outside the app are refused.
  Plugin API: `app.customCss`, `Plugin.registerPalette`, `ColorComponent` / `Setting.addColorPicker`.
- **Icons.** Phosphor (MIT) replaces Lucide as the default icon set, in four weights; Lucide stays as an
  option and as the fallback. Plugins still use Lucide names. See docs/design/icons.md.
- **Design.** A polish plan for spacing and alignment (docs/design/polish-plan.md), and `npm run shots`
  to capture every surface for review.
- **Polish.** The stylesheet is rebuilt on design tokens (4px spacing grid, four UI text sizes, fixed row,
  control and band heights), enforced by a lint in `npm test`. Tab strips and header lines line up across
  all three columns; file and folder names share a column; one row style for menus, palette and
  switcher; settings controls in one column with a title bar; a focus ring everywhere; notices at the
  bottom right; the modeline badge shows the mode. An empty tab is reused instead of left behind.

## v0.1.0

First release of Quire: Markdown notes in plain files, entirely offline, extensible with plugins.

- **Offline by construction.** Every network request from the app or a plugin is cancelled by the app
  itself; the page's security policy blocks connections and `eval`; no updates, telemetry or crash
  reports. An offline audit runs on every build.
- **Notes.** Vaults are ordinary folders. File explorer, tabs and splits, Markdown editor with
  `[[links]]`, footnotes and frontmatter, reading view, command palette, quick switcher, link updates on
  rename.
- **Plugins.** An API in the shape of the Obsidian API subset plugins use, so plugins port by changing
  their import to `@quire/api`. Vault plugins go in `<vault>/.quire/plugins/`.
- **AGLC4 Citations** built in (port of obsidian-aglc4 1.16.0): live checking with fixes, next-element
  suggestions, footnote pane, Word and HTML export with real footnotes, page preview, Word import,
  version history and paragraph guides.
- **DoomEsque look**: doom-crisp dark and light palettes, modeline, Treemacs file tree, Org-style headings.

Known limitations: spellcheck is off (Electron's dictionaries are downloaded from the web); the macOS
build is not notarised (see the release notes to open it).
