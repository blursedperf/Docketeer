# Flashcards and the focus timer

**Pomodoro Flashcards**, built in to Docketeer, turns what you write into flashcards and schedules them with spaced
repetition, beside a Pomodoro focus timer. There is no separate card editor: your cards are lines in your notes.

![The study view: the focus timer above a card](/screenshots/48-study-view.png){.shot}

## Writing cards

Write any of these in any note:

```markdown
What is the standard of proof in civil cases? :: On the balance of probabilities

Estoppel ::: A rule preventing a party from going back on a representation
```

`::` makes one card; `:::` makes two, one each way. Other forms:

```markdown
Q: What did Donoghue v Stevenson establish?
A: The neighbour principle: a duty of care to those closely and directly affected.

What are the elements of negligence?
?
Duty, breach, causation and damage.

Negligence requires {{c1::a duty of care}}, {{c2::breach}} and {{c3::damage::what kind of harm?}}.
```

The last is a **cloze deletion**: each number becomes one card with that part blanked out (the text after a second
`::` is a hint). **Wrap selection in cloze deletion** does the typing for you.

### Your case briefs become cards

A case brief (from the / menu's *Case brief*, or any note with `type: case-brief`, a `case-brief` tag, or Facts,
Issues, Held and Ratio headings) makes cards on its own from what you write under each heading:

- *What are the facts of Donoghue v Stevenson?*, and the reverse: *Which case had these facts?*
- *What was the issue in Donoghue v Stevenson?*
- *What was held in Donoghue v Stevenson?*
- *What is the ratio of Donoghue v Stevenson?*, and the reverse: *Which case established this principle?*

Empty headings make no cards, so a new brief adds cards as you fill it in.

### Decks

Cards go into decks by the note's `deck:` property, a tag such as `#deck/Torts` on a heading or line, or the general
deck. Renaming or moving a note keeps each card's review history.

## Studying

Open the **Study** panel in the Docket (or click the timer in the status bar):

![The Study panel in the Docket](/screenshots/47-docket-study.png){.shot}

- **Enter** on a deck studies its due cards (or all of them, if none are due); **→** offers *Study the due* or
  *Cram all*.
- The chips at the top start or pause the timer, skip to the next phase, or make a new card.
- **So far** shows your streak and totals.

In the study view, press **Space** (or tap the card) to see the answer, then rate how well you knew it: **1** Again,
**2** Hard, **3** Good (or Space), **4** Easy. Each button shows when you will see the card next. Cards are scheduled
with the SM-2 algorithm: the better you know one, the longer until it comes back. **Cram** goes through every card in
a deck, due or not.

## The focus timer

25 minutes of focus, then a 5-minute break, and a 15-minute break after every fourth session (all adjustable in
Settings → Pomodoro Flashcards). During a break the cards are put away so you actually rest, with a button to keep going if you would
rather. A chime marks each change, made by the app itself. The status bar shows the time left and how many cards are
due.

## Locked notes

Cards in a [locked note](./locking) are never read while it is locked: they leave the decks when it locks and come
back when you unlock.
