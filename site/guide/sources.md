# PDFs and lecture recordings

Judgments, readings and lecture recordings live in your homebase beside your notes, and open in Caselore itself.

## PDFs

A PDF opens in a tab: pages appear as you scroll, with text you can select and copy, zoom, *Fit the width*, and a page
box that takes the **printed** page number (`iv`, `112`) as well as the PDF's own. The tab remembers where you were.

- **Link to a page**: `[[Smith v Jones.pdf#page=12]]` opens the PDF beside your note at that page.
- **Quote with the page**: select text in the PDF and press **⌥Q** (or right-click → *Quote in note*). It goes into
  your note as a quotation with a link back to its page, named by the printed page:

  ```markdown
  > The duty of care is owed … ([[Smith v Jones.pdf#page=12|p 112]])
  ```

PDFs never run scripts or forms and their links are not followed, so a PDF cannot reach the internet either.
Password-protected PDFs and searching inside a PDF are not supported yet.

## Lecture recordings

Embed a recording with `![[Week 3.mp4]]` (or drop the file into a note) and it plays under the line, in the editor
and in reading view, and keeps playing while you type. Video and audio (MP4, M4A, MP3, WAV and more) work; a `.vtt`
file with the same name beside a video is shown as its captions.

**Timestamps**: press **⌥T** while it plays to insert a link to that moment, such as `[[Week 3.mp4#t=12:34|12:34]]`.
Clicking it later jumps the recording there.

These keys work while you type, on the recording you last played:

| Keys | |
|---|---|
| **⌥K** | Play or pause |
| **⌥J** / **⌥L** | Back / forward 5 seconds |
| **⌥,** / **⌥.** | Slower / faster (0.5× to 3×) |
| **⌥T** | Insert a timestamp link |

(**⌥** is Option on a Mac and Alt on Linux.)
