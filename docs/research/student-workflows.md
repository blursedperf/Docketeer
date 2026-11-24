# Student note-taking workflows: what Quire should support next

Research notes, 2026-11-25. Scope: law scaffolds, essay-question research, PDF and lecture-video embeds.
Each section says what students do, what Quire (0.7.1) already covers, where the gaps are, and what to build.

## 1. The weekly cycle of an Australian law student

```
readings (cases, reader PDFs, legislation)  ─┐
lecture (recording + slides PDF)            ─┼─► case briefs / lecture notes ─► topic summary ─► exam scaffold
tutorial prep (problem question)            ─┘                                     │                 │
                                                                                    ▼                 ▼
                                                               research essay (assignment)   open-book exam answer
```

- **Inputs** are mostly PDFs (judgments from AustLII/Jade, reading packs, slides) and lecture recordings
  (Echo360/Panopto/Lectopia, often downloadable as MP4, usually with captions).
- **Intermediate notes**: case briefs, statute notes, lecture notes. US guides (Berkeley, BARBRI) stress
  that briefs are short and that outlines are organised **by topic, not by case**, with case coverage in
  proportion to class time.
- **Outputs**: (a) the *exam scaffold* (an issue checklist per topic that a student IRACs from in an
  open-book exam), (b) problem answers (IRAC, MIRAT at Monash, ILAC, HIRAC at ANU), (c) research essays
  (thesis → annotated sources → outline → draft, AGLC4).
- Open-book success is about **finding the rule fast**: "know the rules cold — either memorise them or
  have them perfectly drafted in your outline." Quire's Docket search, offline guarantee and locking
  already fit this; what is missing is the scaffold itself and links from it back to sources.

## 2. Law scaffolds

### What exists
| Quire today | Where |
|---|---|
| Case-brief detection (`type: case-brief`, tag, or 3 of Facts/Issues/Held/Ratio/Obiter) and "add a missing field" | `packages/api/src/outline-edit.ts:93` |
| Outline panel: move sections (Alt+↑/↓), change levels | Docket → Outline |
| Paragraph prompts for problem answers and essays (sentence-level IRAC guides, alternatives ⟳) | `plugins/aglc4/src/prompts/` |
| Authorities panel (cases/legislation/secondary in the note), Cite panel, footnotes, Word export | Docket, AGLC4 plugin |
| Layout presets "Brief + Source", "Revision", "Exam" | Docket → Layout |

Your Obsidian suite already has the missing pieces, not yet ported: **Inline Schema Expander** (`#case-law`
records, starter schemas for case / statute / principle / exam issue, schema table, promote-to-note),
**Outline to Draft** (C/E/A/O outline → paragraph stubs), **Pomodoro Flashcards** (auto case cards from
ratio/held), **Legal Core** (shared authorities store across notes).

### Gaps
1. **No templates / new-note-from-scaffold.** Ctrl+N asks for name and folder only. A case brief has to be
   typed or tagged by hand.
2. **No cross-note authority store.** Authorities are per note; a topic summary cannot list "every case I
   have briefed on negligence" with its ratio.
3. **No exam scaffold type.** The central open-book artefact (ordered issues → rule → elements →
   authorities → arguments both ways) has no structure, so it cannot drive an answer.
4. **No bridge from scaffold to answer.** Paragraph prompts guide *how* to write IRAC, but the student
   still retypes the rule and authority they already have in their notes.

### Recommendations
- **Scaffold types** (built-in, editable files in `.quire/scaffolds/`): Case brief (citation, court,
  judges, procedural history, facts, issues, held, ratio, obiter, dissent, *significance / use for*),
  Statute section (text, elements, defined terms, interpreting cases), Principle (elements, each with
  authorities), Lecture note (date, recording link, slide link), **Exam issue** (trigger facts, rule,
  elements, leading authority, counter-arguments, remedies). Offer them from Ctrl+N and from Units' **N**.
- **Port Inline Schema Expander first.** It gives one-line records (`#case-law [court:: HCA] [ratio:: …]`)
  for fast lecture capture, a sortable table, and promote-to-note into the case-brief scaffold. It is also
  the data source for flashcards and for the authority store.
- **Topic summary roll-up**: a Docket panel (or embedded block) that lists every case/statute note under a
  subject or topic folder with its ratio/elements, refreshed live. This is the student's "outline by topic"
  generated from briefs.
- **Problem-answer builder**: select issues from an Exam-issue scaffold (or tick them in a checklist),
  generate IRAC/MIRAT stubs per issue with the rule and authority pre-filled as AGLC4 footnotes, then let
  paragraph prompts guide the Application. The same mechanism as Outline to Draft, applied to problems.
- **Exam mode** (extends the Exam layout preset): read-only reference notes, a countdown with the
  "5–10 minutes to plan per hour" split, and a reminder before time ends that each issue needs a
  conclusion (the CAUL guide's most common mark loss).

## 3. Essay-question research

### Workflow (law library guides: Georgetown, Villanova, UC Law SF)
1. Unpack the question into sub-questions; draft a working thesis.
2. Research one issue at a time; log every source as found in an **annotated bibliography** (citation +
   one or two neutral sentences on how it bears on the topic).
3. Take excerpts with pinpoints.
4. Outline around **issues and arguments, not sources**; map sources to points (a literature matrix:
   sources × sub-questions).
5. Draft, keep the thesis in view, manage the word budget, cite (AGLC4), check, export.

### Quire coverage
Step 5 is strong (AGLC4 underlining, Cite panel, prompts, page preview, Word export, history). Steps 1–4
are unsupported.

### Recommendations
- **Essay project scaffold**: a folder with `Question.md` (question, sub-questions, thesis, word limit, due
  date), `Sources/` (one note per source with AGLC4 fields from the Cite panel), `Outline.md`, `Draft.md`.
- **Source notes = annotated bibliography**: Cite panel → "Save as source note" stores the structured
  citation in frontmatter, so footnotes are inserted from the store rather than retyped. Generate the
  AGLC4 bibliography from the project's source notes.
- **Excerpts with pinpoints** that link back to the PDF page/paragraph (see §4); quoting an excerpt into
  the draft inserts the footnote with the pinpoint.
- **Matrix view**: sub-questions × sources, cells = excerpts tagged to that sub-question. Cheap to build on
  the metadata cache.
- **Port Outline to Draft** (C/E/A/O, section word shares, thesis check, prose regions it never touches).
  Its `E: [[Source]] at [78]` syntax already pairs with source notes.

## 4. PDF embeds

### Current state (verified in code)
- Dropping a PDF stores it in `attachments/` and inserts `[[x.pdf]]` (smoke test covers this), but it
  **cannot be opened in Quire**.
- `quire://app/vault/…` serves **images only** (`packages/app/src/main/main.ts`, the `parts[0] === 'vault'`
  branch) and `serve()` reads the whole file into memory.
- CSP: `object-src 'none'`, `frame-src 'none'`, `worker-src 'none'`. Chromium's built-in PDF viewer is
  therefore unavailable (and should stay so: it is an extension surface outside the offline audit).

### What students need
Read a judgment beside its brief ("Brief + Source" preset), highlight, and pull a quote with an **AGLC4
pinpoint**: for judgments that is the **paragraph number** `[78]`, for books/articles the **printed page**
(not the PDF page index). Obsidian users do this with PDF++ (links to a selection become highlights; notes
stay plain Markdown, which matches Quire's plain-files rule).

### Design
- **Bundle pdf.js** (Apache-2.0, add to `THIRD_PARTY_NOTICES`) and add a `PdfView` tab: canvas + text
  layer, thumbnails, find, zoom.
- **Security / offline**: serve `pdf.worker.mjs` from `quire://app` and relax CSP to
  `worker-src 'self' quire://app` (or run without a worker for small files). Set `isEvalSupported: false`
  (CVE-2024-4367 path; recent pdf.js removed the eval) and `enableScripting: false`; no XFA; links inside
  the PDF go nowhere external. Extend `offline-audit.mjs` to scan the pdf.js bundle with an allow-list.
- **Protocol**: allow `application/pdf` (and the media types below) on the vault route, streamed with Range
  support, not `readFile`.
- **Links**: `[[Smith v Jones.pdf#page=12]]`, `#page=12&selection=…` (text quote anchor, robust to
  re-download), and `#para=78` (resolved by scanning the text layer for `[78]` paragraph markers).
- **Highlights live in Markdown**, not in the PDF: a link to a selection *is* the highlight (PDF++ model).
  Optional "export with highlights" writes annotations into a copy.
- **Quote with pinpoint** (command and selection menu): inserts a blockquote plus a link; with the AGLC4
  plugin, a footnote using the PDF's page labels (`getPageLabels`) or the detected paragraph number.
- **Search**: extract PDF text into the in-memory search index (same privacy rules: never logged).
- **Locking**: attachments are not encrypted today. A locked subject full of PDFs leaks them; either encrypt
  attachments in locked folders or warn clearly.

## 5. Lecture video (and audio) embeds

### Current state
`media-src 'self' quire://app blob:` is already in the CSP, but the vault route refuses non-images and has
no Range support, so a 1–2 GB lecture recording would be read whole into memory and could not seek.
Remote players (YouTube, Echo360 streams) are impossible by design and should stay so: **download first**.

### What students need
Watch at 1.5–2×, pause while typing, drop a timestamp into the note, jump back from the note, read and
search the transcript, and link the slide that was on screen. Obsidian plugins in this space (Media
Extended, Video Notes, Media Marker, Timestamp Notes) converge on the same features; "Video Notes" is an
offline-only fork of the idea, which confirms demand for exactly Quire's constraints.

### Design
- **Protocol**: add `video/mp4`, `video/webm`, `audio/mp4` (m4a), `audio/mpeg`, `audio/ogg`, `text/vtt`;
  answer `Range` with `206 Partial Content` + `Content-Range`, streaming from a file handle. Without this
  seeking fails (a known Electron custom-protocol pitfall; `stream: true` is already set on the scheme).
  Electron's Chromium plays H.264/AAC MP4, the usual lecture export.
- **Embed**: `![[Week 3 lecture.mp4]]` renders a player in live preview and reading view; `#t=12:34` starts
  there. A **pinned player** pane (Layout preset "Lecture": video + notes) keeps playing while the note scrolls.
- **Timestamps**: a hotkey inserts `[[Week 3 lecture.mp4#t=12:34|12:34]]`; Ctrl-click seeks. Optional
  "pause while typing" and "rewind 5 s on resume". Speed and seek keys work from the editor.
- **Transcript**: if a sidecar `.vtt`/`.srt` exists (Echo360 and Panopto export captions), show it in a
  transcript pane that follows playback; click a line to seek; select lines → quote with timestamp. Index
  transcripts for search.
- **Slides sync**: link a slides PDF to the recording; a timestamp note can carry `slide=7`, opening both.
- **Later, optional**: local transcription with whisper.cpp (offline, MIT) for recordings without
  captions. Large binary and models, so a separate opt-in plugin.

## 6. Suggested order

| # | Work | Why first | Size |
|---|---|---|---|
| 1 | Vault route: PDF + media MIME types, Range/streaming | Unblocks §4 and §5; small, contained, testable in smoke | S |
| 2 | Video/audio embed, timestamp links, insert-timestamp hotkey | Highest value per effort for lecture notes | M |
| 3 | pdf.js `PdfView`, page links, quote-with-link, CSP/audit changes | Core reading workflow | L |
| 4 | Scaffold types + new-note-from-scaffold; port Inline Schema Expander | Unlocks briefs, statute notes, exam issues | M |
| 5 | Pinpoints: page labels and `[para]` detection; highlights as links | The law-specific edge over generic apps | M |
| 6 | Transcript pane from VTT/SRT, indexed for search | Builds on 2 | M |
| 7 | Topic roll-up panel; authority store across notes (Legal Core) | Generates the topic outline from briefs | M |
| 8 | Problem-answer builder; port Outline to Draft; essay project scaffold | Connects notes to assessments | L |
| 9 | Exam mode; flashcards port; whisper.cpp plugin | Polish and opt-ins | M–L |

Open questions for you:
- Encrypt attachments in locked folders, or only warn?
- Keep pdf.js on the main thread (no CSP change) or allow a same-origin worker?
- Should scaffolds be plain template notes (user-editable Markdown) or schemas (Inline Schema Expander
  style)? Recommendation: schemas define fields, a template note defines layout, as the Obsidian plugin does.

## Sources
- [BARBRI: Law school outlines and note-taking tips](https://www.barbri.com/law-school-outlines-and-note-taking-tips)
- [Berkeley Law: A Quick Guide to Outlining](https://www.law.berkeley.edu/wp-content/uploads/2021/08/A-Quick-Guide-to-Outlining.pdf)
- [BARBRI Law Preview: Taking notes in law school](https://lawpreview.barbri.com/taking-notes-in-law-school/)
- [Monash: Legal problem solving (IRAC)](https://www.monash.edu/student-academic-success/excel-at-writing/annotated-assessment-samples/law/law-legal-problem-solving-irac)
- [ANU: Writing in law](https://anu.edu.au/students/academic-skills/writing-assessment/other-assessments/writing-in-law)
- [Adelaide Writing Centre: Legal problem solving](https://adelaide.edu.au/writingcentre/ua/media/353/legal-problem-solving.pdf)
- [CAUL OER: Guide to writing in law school](https://oercollective.caul.edu.au/guide-writing-law-school/?p=269)
- [SCU: IRAC quick guide](https://www.scu.edu.au/media/scu-dep/current-students/learning-zone/quick-guides/LZ-Quick-Guides-IRAC-Method_final.pdf)
- [Georgetown Law: Checklist for the writing process](https://www.law.georgetown.edu/wp-content/uploads/2018/07/checklistwriting_000.pdf)
- [Villanova Law Library: research tips](https://libguides.law.villanova.edu/CrimLawResearch/tips)
- [UC Law SF: Scholarly writing — organise](https://libguides.uclawsf.edu/Scholarly/Organize)
- [PDF++ (Obsidian)](https://www.github.com/RyotaUshio/obsidian-pdf-plus) · [PDF++ Exporter](https://community.obsidian.md/plugins/pdfplus-exporter)
- [Obsidian forum: lawyers using Obsidian](https://forum.obsidian.md/t/any-lawyers-or-legal-practitioners-using-obsidian/2057?page=2)
- [Media Extended](https://community.obsidian.md/plugins/media-extended) · [Video Notes](https://community.obsidian.md/plugins/video-notes) · [Media Marker](https://community.obsidian.md/plugins/media-marker) · [Timestamp Notes](https://github.com/dinghaoz/ObsidianTimestampNotes)
- [Electron issue: custom protocol video needs stream privilege](https://www.github.com/electron/electron/issues/40447) · [web.dev: range requests](https://web.dev/articles/sw-range-requests)
- [GHSA-wgrm-67xf-hhpq: pdf.js isEvalSupported](https://github.com/advisories/GHSA-wgrm-67xf-hhpq) · [pdf.js PR #18015](https://www.github.com/mozilla/pdf.js/pull/18015)
