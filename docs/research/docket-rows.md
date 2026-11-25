# Docket rows: why moving through them jumped, and the values now used

## What made ↑/↓ jumpy

1. **Rows of different heights.** A row with a detail (a note's folder, a heading's note, a case's citation)
   put it on a second line, about 40 px tall. Rows without one were 26 px, and *Show all* rows shorter still. Each step
   moved the list by a different amount.
2. **Group titles scrolled away.** The selected row was kept in view with the browser's `scrollIntoView({ block:
   'nearest' })`. Moving down onto a group's first row showed the row but not the title above it. Moving back up
   from there into the previous group then brought the title in with a lurch, and the name of the group you were in
   was usually off screen.
3. **No context.** `nearest` stops with the selected row at the very edge, so you could not see what came next
   until you got there.
4. **The wrong thing scrolled.** `scrollIntoView` scrolls every scrolling box around the row, not only the list.

## The values now

| Element | Value | Why |
|---|---|---|
| Row | `--docket-row` = `--row-h` + 4 px: 30 px (26 compact, 34 spacious), the same for results and panel rows | one step, one distance |
| Detail | on the same line after the name, smaller and muted, cut short with … | keeps every row one line; the name never gives way to it |
| Full-text matches (*In notes*) | 1.6 rows, every row of the group | the matching line is the point of the result, so it keeps its own line, but the whole group shares one height |
| Group and section title | 24 px, sticky at the top of the list while its rows scroll | you always see which group you are in; the next title pushes the last away |
| Gap between groups | 8 px | unchanged |
| Scrolling | the list only, keeping a fixed margin of one row above (below the sticky title) and below the selection; a group's first row brings its title fully into view | the selection stays at the same place on screen while the list moves under it by the real distance between two rows. A margin of "the next row" (0.17.0) made the selection bounce by a title and gap at every section boundary, which showed most in short sections |
| Entering a panel | scrolled to the top; ↓ from the search goes to the first row | a panel no longer inherits where another was left |

A smoke check steps down and back up through a long result list and checks each step:

- the selected row is fully in view, below its group's title;
- the selection never moves back against the key, and never further than the distance between the two rows (at the very top the list may settle up to two rows);
- each panel opens at its top, and ↓ from the search goes to its first row;
- every row outside the full-text group is the same height.
