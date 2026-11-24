# Changelog

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
