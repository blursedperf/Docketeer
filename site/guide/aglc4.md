# AGLC4 citations

Docketeer comes with **AGLC4 Citations**, which writes and checks footnotes to the *Australian Guide to Legal
Citation* (4th ed). It is on in every new homebase (Settings → Plugins turns it off).

::: tip Try it in two minutes
Run **Create example essay** (`>example essay` in the Docket). It adds a five-page essay on native title, correctly
cited to AGLC4 with every kind of source, plus a part with deliberate mistakes to fix and a list of things to try.
:::

## Writing a footnote

Put the cursor at the end of a sentence and press **⌘⌥F** (Super+Alt+F on Linux), or choose *Footnote* in the
[/ menu](./writing#the-menu). The footnote opens below. Start typing a citation, such as `*Mabo v Queensland [No 2]*`
and a space, and the plugin **suggests the next element**: the year, the report series, the page. Finish with a full
stop and press **Enter** to go back to your sentence.

Footnotes are kept in reading order at the bottom of the note and renumbered as you move text around, and `(n 3)`
cross-references keep pointing at the right footnote.

### The Cite panel

Rather fill in a form? The Docket's **Cite** panel builds the citation for you: choose the kind of source, fill in
the parts (Tab moves between them) and Enter inserts it as a footnote, worked out as a full citation, *Ibid* or a
short title with "(n X)" from the footnotes already there.

![The Cite panel, building a citation for a reported case](/screenshots/30-docket-cite.png){.shot}

It covers cases, legislation, journal articles, books, treaties, government, Productivity Commission and law reform
reports, and web pages.

## Checking

As you write, citations that do not follow AGLC4 are **underlined** in red or orange. Rest the mouse on one to see what is wrong and the rule it breaks, with a **Fix** button. **Fix all
automatically fixable problems** fixes every one in the note at once (one undo puts them back).

The checks are fixed rules written from the guide itself. No AI is involved and nothing leaves your computer: the
same text always gets the same answer.

## Authorities

The Docket's **Authorities** panel lists every case, statute and secondary source the note cites, with its citation
and how many times it appears, filtered by jurisdiction if you like. Enter jumps to the next place it is cited; →
finds every note that cites it, or cites it again. Opening the Docket with the cursor on a case name goes straight
to it, and `@` in the Docket searches authorities.

![The Authorities panel](/screenshots/26-docket-authorities.png){.shot}

## Page preview and exporting

**Open page preview** shows the note as it will print: A4 pages, AGLC4 headings, each footnote at the foot of its
page. From the note's menu (or the Docket's actions):

- **Export to Word with AGLC4 footnotes**: a `.docx` with real Word footnotes, AGLC4 headings and a bibliography on
  a new page, ready to hand in.
- **Export to HTML** or **PDF**, with the same footnotes and bibliography.

Word documents can be **imported** too, footnotes and all.

## Version history

The plugin keeps earlier versions of your notes, so any earlier draft, a deleted note or an overwritten export can be
brought back. **Show version history** lists them: ↑ ↓ shows what changed in each, Enter offers *Restore*, *Restore as
a copy* and *Name*. Locked notes are never copied into the history.

## Paragraph guides

If you want them, guides above each paragraph show what it should do, sentence by sentence, for IRAC, ILAC, HIRAC or
MIRAT problem answers, critical analysis and "discuss" essays, or your own structure. They are written from
Australian law schools' writing guides.

## Only for assignments

The plugin can be kept to the notes you mark as assignments, leaving lecture notes alone, with each assignment's own
style (headings, bibliography, prompts) in its properties.

## The full guide

AGLC4 Citations has its own detailed guide: workflows from first draft to submission, every rule it checks, headings,
the bibliography, settings and troubleshooting. It is in the
[plugin's documentation](https://github.com/blursedperf/Docketeer/tree/master/plugins/aglc4/docs).
