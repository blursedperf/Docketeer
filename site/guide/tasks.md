# Tasks

Every checkbox in every note is a task, and the **Tasks** panel in the Docket (from the built-in **Task Docket**
plugin) lists them all in one place, most urgent first.

![The Tasks panel in the Docket](/screenshots/44-docket-tasks.png){.shot}

## Writing tasks

```markdown
- [ ] Brief Donoghue v Stevenson 📅 2026-11-20 ⏫ #torts
- [ ] Tutorial problem question 📅 2026-11-14 14:00
- [ ] Moot submissions [due:: 2026-11-21T17:00] [priority:: highest]
- [x] Summarise Wagon Mound ✅ 2026-11-12
```

Due dates, times and priorities are read in either common format (the Tasks plugin's emoji, or Dataview's
`[due:: ]` fields), so tasks written in Obsidian work as they are. `[x]` is done, `[-]` cancelled, `[/]` in progress.

### Dates as you type

On a task line, type **`@`** to set a date or priority without leaving the keyboard:

| Type | Gives |
|---|---|
| `@tom`, `@fri`, `@mon` | That day |
| `@fri 9am`, `@tomorrow 17:00` | That day, at that time |
| `@3d`, `@2w`, `@2026-12-01` | In 3 days, in 2 weeks, on a date |
| `@high`, `@low`, `@!!!` | A priority |

The `@…` becomes the date or priority, written in the format the line already uses.

## The Tasks panel

Tasks are grouped by when they are due (overdue, today, tomorrow, the next seven days, later, no date) and sorted by
urgency, which weighs how soon a task is due against its priority. They can be grouped by priority, note or tag
instead.

- **Space** (or a click on its box) checks a task off; the next one is selected, so a list can be worked through
  from the keyboard. Space again reopens it.
- **Enter** opens the task's note at its line.
- **→** makes it due today, tomorrow or in a week, picks a date, or sets a priority.

The change is written to the task's own line in its own note, and nothing else. The status bar counts what is
overdue and due today; **Add task** puts a new one in your inbox note (`Tasks.md`).
