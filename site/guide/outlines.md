# Searching your outlines

Exam outlines are trees: a heading, a topic, its elements, the cases under each. An ordinary search finds the one
line with your word and loses the branch it sits on. **Whole-Tree Search**, built in to Caselore, keeps the branch.

Type `~` in the Docket and a few words:

![Whole-tree search for "foresee"](/screenshots/46-docket-whole-tree.png){.shot}

Each match shows:

- the **heading** above it, so you know which part of the note it is in;
- its **parent** points;
- the **line found**, with your words marked;
- everything **nested under it**.

**Enter** opens the note at that line (⌘Enter to the right), and **Shift+Enter** inserts a link to it.

## Words down a branch

Your words do not have to be on one line. `~causation breach` finds "breach" under a heading or point that says
"causation", which is how outlines are written: the topic above, the detail below.

## Settings

Settings → Whole-Tree Search sets how many matches are listed, how many parent levels and nested levels are shown,
whether case matters, folders to leave out (such as templates), and whether a blank line ends an outline (turn that
off for lists with blank lines between their points).

It stays quick in a large homebase (only notes containing every word are read), and locked notes are never searched.
