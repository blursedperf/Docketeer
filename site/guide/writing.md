# Writing notes

A note is a Markdown file. Docketeer shows it as you write it (**live preview**): headings, bold, lists, tables and
links take shape as you type, and their marks come back on the line the cursor is on, so you always see what you
are editing.

![An essay in live preview, with its properties and the printed pages beside it](/screenshots/01-main-crisp-light.png){.shot}

## New notes

**⌘N** asks for the name and the subject or topic it belongs in, in one dialog, so there are no "Untitled" notes.
In the Docket, `+` and a name does the same (`+Mabo brief`, then Enter). A note's file name is its title.

## The / menu

Type **`/`** at the start of a line or after a space, a few letters to narrow it, and Enter:

| Item | Inserts |
|---|---|
| Heading 1–3, lists, task, quote | Turns the line into that, keeping its text |
| Table | A table, with its first heading selected to type over |
| Code block, divider | On lines of their own |
| Link, embed | `[[` or `![[` with name completion |
| Footnote | An AGLC4 footnote (see [AGLC4](./aglc4)) |
| Highlight, comment, today's date | At the cursor |
| **Case brief** | Facts, Issues, Held, Ratio and Obiter headings, the cursor under the first |
| **IRAC answer** | Issue, Rule, Application and Conclusion headings |
| Your templates | Any note in your templates folder |

It is also a **calculator**: `/12*3.5+4` offers `46` (and the working, `12 × 3.5 + 4 = 46`). It knows brackets,
powers, percentages (`/15% of 80`), `sqrt`, `round`, `log` and more, and works it out itself: nothing you type is
run as code.

## Links

- Type `[[` and a note's name; add `#` for one of its headings. Enter finishes the link.
- Renaming or moving any file updates every link to it.
- Rest the mouse on a link for a **hover preview** of the note (hold ⌘ to see it at once).
- In the Docket, → on a note lists the notes linking to it, and mentions of its name that are not links yet.

## Properties

Properties (subject, due date, tags, a flashcard deck …) sit at the top of a note. In live preview each is a row with
a field to suit its value: chips for a list, a checkbox, a date picker, a number or text. Names and values you have
used in other notes are suggested as you type. **⌘;** adds one. **Edit as YAML** shows them as written.

## Pictures, embeds and attachments

Paste a screenshot or drop a file into a note: it is saved in the attachments folder and embedded. `![[picture.png|300]]`
sets a width. `![[Another note]]` or `![[Another note#Heading]]` shows that note, or one section of it, inside this one.
Recordings and PDFs have [a page of their own](./sources).

## Templates

::: v-pre
Every note in your **Templates** folder (Settings → Editor) is a template, offered in the / menu and by **Insert
template…**. **New note from template…** starts a note from one, and **Save as template…** turns a note or a selection
into one. `{{title}}`, `{{date}}` (or `{{date:D MMMM YYYY}}`), `{{time}}` and `{{cursor}}` are filled in.
:::

## Spelling

Misspelt words are underlined as you write; right-click for suggestions, **Add to dictionary** or **Ignore**. English
(Australia) by default, or British or US English (Settings → Editor → Spelling). **Legal terms** is on by default, so
*estoppel*, *justiciable*, Latin phrases and AGLC abbreviations (*ibid*, *cf*, *sch*) are not marked. Names, links,
code and (unless you turn it on) footnotes are not checked. The dictionaries are part of the app: nothing is looked up
online.

## Reading view and exporting

The book icon at the top of a note switches to **reading view**. To share or hand in a note:

- **Export to PDF**: the note on A4 pages as it reads, saved beside it. In the note's menu and the Docket's actions.
- **AGLC4 exports**: Word (with real footnotes), HTML or PDF, with footnotes and a bibliography. See [AGLC4](./aglc4).
- The Homebase panel can export a note to Markdown or HTML with comments, properties or names you list removed.

## Vim

Settings → Editor → **Vim key bindings** turns on Vim's modes, motions and operators, with `:w`, `:q` and `:wq`.
The status bar shows the mode.
