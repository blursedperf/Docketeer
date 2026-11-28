---
layout: home
title: Docketeer
titleTemplate: Offline notes for law students

hero:
  name: Docketeer
  text: Law notes that stay on your computer
  tagline: Plain Markdown files, AGLC4 citations that check themselves, case briefs that turn into flashcards, and the Docket, a keyboard-first tray that reaches everything without the mouse. Nothing goes online.
  image:
    src: /logo.png
    alt: The Docketeer icon
  actions:
    - theme: brand
      text: Download
      link: /download
    - theme: alt
      text: Get started
      link: /guide/getting-started

features:
  - icon: ⌨️
    title: Keyboard first
    details: "Press ⌘D (Super+D on Linux) and the Docket drops down: find a note, run a command, insert a citation, open a panel. Your hands stay on the keys."
  - icon: ⚖️
    title: Made for law school
    details: AGLC4 footnotes that are suggested as you type and checked as you write, a list of every authority you cite, case brief and IRAC templates, and export to Word or PDF.
  - icon: 🗂️
    title: Your files, your folder
    details: Notes are ordinary Markdown files in a folder you choose. Open them in any editor, sync them however you like, keep them forever.
  - icon: 🔒
    title: Offline, absolutely
    details: Docketeer cannot reach the internet. Every request is refused by the app itself, whatever a plugin tries. No account, no tracking, no cloud.
---

<script setup>
import { withBase } from 'vitepress';
const shot = (name) => withBase(`/screenshots/${name}.png`);
</script>

<div class="showcase">

<div class="showcase-row">
<div class="showcase-text">

## Everything is one keystroke away

The Docket is a tray that drops from the top of the window. Type to search every note, heading and authority at
once; type `>` for commands, `/` for headings, `~` to search inside your outlines. Enter opens a result, ⌘Enter opens
it beside the note you are in, Shift+Enter links to it.

</div>
<img :src="shot('23-docket-search')" alt="The Docket open over an essay, searching for Mabo: headings and authorities are listed">
</div>

<div class="showcase-row">
<div class="showcase-text">

## Citations that check themselves

The AGLC4 plugin suggests the year, report series and pages as you type a case into a footnote, underlines what does
not follow the guide (with a Fix button), and writes *Ibid* and short titles with “(n 3)” cross-references for you. The
**Authorities** panel lists every case and statute you have cited, and export to Word or PDF builds the footnotes
and bibliography for you.

</div>
<img :src="shot('26-docket-authorities')" alt="The Authorities panel listing the cases cited in an essay on native title">
</div>

<div class="showcase-row">
<div class="showcase-text">

## Study from your own notes

Write `Question :: Answer` anywhere, or just fill in a case brief: its Facts, Issues, Held and Ratio become cards on
their own. Review them with spaced repetition beside a focus timer, and see what is due from the **Study** panel.

</div>
<img :src="shot('48-study-view')" alt="The study view: a focus timer above a card asking for the ratio of Donoghue v Stevenson">
</div>

<div class="showcase-row">
<div class="showcase-text">

## Search your outlines as outlines

Type `~` and a few words to find them in your exam outlines, each match shown with the heading above it, its parent
points and everything nested under it: the whole branch, not a line out of context.

</div>
<img :src="shot('46-docket-whole-tree')" alt="Whole-tree search for foresee, showing Negligence, Duty of care and the neighbour principle around the match">
</div>

<div class="showcase-row">
<div class="showcase-text">

## Make it yours

Sixteen colour palettes, light and dark, your own fonts, three densities, two icon sets, tiling panes and saved
layouts for briefs, revision and exams. Plugins can add their own commands, panels and searches.

</div>
<img :src="shot('02-palette-tokyo-night')" alt="Docketeer in the Tokyo Night palette">
</div>

<div class="showcase-cta">

## Free for macOS and Linux

<DownloadButtons />

</div>

</div>
