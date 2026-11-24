# The Docket: keyboard-only walkthrough (Phase 2)

Turn it on first: Settings → Appearance → Docket → **Use the Docket (preview)**. (Mod is Ctrl on Linux and
Windows, ⌘ on macOS.)

Screenshots from the test tour are in [`phase2/`](phase2/).

1. **Open it.** In a note, press **Mod+P**. The tray drops from the top with the cursor in the input. If the
   cursor in the note was on a case name (say *Mabo v Queensland [No 2]*), it opens on **Authorities** with that
   case shown; in a footnote it opens on **Cite**; otherwise on the panel you used last.
2. **Close it.** Press **Esc**. The note has the keyboard again, with the same cursor and selection as before.
3. **Find a note.** Mod+P, type part of its name. Results are grouped (Notes, Headings, Commands …); **↑/↓**
   move, **Enter** opens it here, **Mod+Enter** opens it to the right, **Alt+Enter** below.
4. **Link to it.** In a note, Mod+P, type the note's name, **Shift+Enter**: `[[Note]]` is inserted at the cursor.
5. **More actions.** With a result selected press **→** (or **Mod+.**): Open, Open to the right, Open below,
   Insert as a link, plus anything plugins add. **←** or **Esc** goes back.
6. **Run a command.** Type **>** then the command (`>split`). Each shows its shortcut; Enter runs it.
7. **Other prefixes.** **#** folders and tags, **/** headings in this note, **?** every shortcut, **@** authorities
   (from Phase 4).
8. **Panels.** **Mod+1 … Mod+6**: Authorities, Outline, Units, Cite, Homebase, Layout. **Tab / Shift+Tab** move
   between the input, the panel (or results) and the panel tabs; in the tabs **←/→** switch panel; in a panel
   **↑/↓** move and **Enter** runs the item (Outline: jump to the heading).
9. **Pin it.** **Mod+Shift+P** switches between peek (over the note, closes when done) and pinned (docked above
   the note). Pinned, Esc hands the keyboard back without hiding it; Mod+P takes it again.
10. **Height.** **Mod+Alt+↓ / ↑** while it has the keyboard (20–60 % of the window), or drag its lower edge.
    Mode, height and the last panel are remembered.
11. **Esc, step by step.** Actions → results → clear the input → close.

Screen readers: the tray is a dialog; the input is a combobox over a listbox of results, with the number of
results announced; panels are tabs. With "reduce motion" on, it appears without animation.

## Tiling (Phase 5)

1. In a note, **Mod+\** splits it to the right; **Mod+Shift+\** splits down.
2. **Mod+Alt+arrows** move the keyboard between panes; **Mod+Alt+Shift+arrows** carry the current tab
   along (into a new pane if there is none that way).
3. Resize the pane: **⌘⌃arrows** on macOS, **Mod+Alt+[ ] = -** elsewhere. **Mod+Shift+=** evens them out.
4. **Mod+Shift+Enter** zooms the pane to fill the window, and back.
5. **Mod+W** closes a tab (an empty pane closes too); **Mod+Shift+T** brings it back.
6. The same note in two panes stays in step as you type, each with its own cursor.
7. With a mouse, drag a tab along its bar to reorder it, onto another pane to move it there (its edges split
   it), or to an edge of the window for a pane along that whole side.
8. **Mod+6** (Layout): presets (Single, Brief + Source, Revision, Exam), your saved layouts, the open panes,
   and the tiling commands with their keys. The layout is saved with the homebase and comes back on launch.

## Help (Phase 7)

- **`?`** in the Docket is the cheat sheet: the Docket's own keys, the prefixes, then every shortcut by section,
  generated from the keymap (so it shows your remapped keys). Typing narrows it; Enter runs the command.
- The first time Quire opens, a hint under the Docket handle says where everything is. It goes for good when
  dismissed or when the Docket is first opened.
