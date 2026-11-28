# Privacy: offline, absolutely

Docketeer was built so its author could be certain nothing left the computer, even in an open-book law exam. So it
does not just avoid going online: it **cannot**.

## What that means

- **No network access at all.** Every request the app could make is refused by the app itself, whether it comes from
  Docketeer, a plugin, a theme or a note: web pages, pictures with web addresses, fonts, update checks. This is
  enforced in two places (the page and the app's main process), so one mistake cannot open a hole.
- **No account, no cloud, no sync service of our own.** Your notes are files in a folder you choose. Sync them with
  iCloud, Syncthing or a USB stick if you want to; Docketeer never sees how.
- **No analytics, tracking or crash reports.** Nothing about how you use Docketeer is recorded anywhere but your
  computer.
- **No AI.** Citation checks are fixed rules from the AGLC4 text. Nothing you write is sent anywhere to be analysed.
- **Logs never contain your notes**: no note text, note names or searches.
- **Spelling dictionaries, fonts, the PDF viewer and the flashcard chime** all come with the app. The browser's own
  spellchecker, which downloads dictionaries, stays off.
- **Locked notes** are encrypted on disk. See [Locking notes](./guide/locking).

## How it is checked

Every build of Docketeer runs an **offline audit** that fails if anything shipped, including the built-in plugins and
every library they use, could reach the network or run code it generates. The end-to-end tests then try to reach the
internet from inside the running app and check that it is refused.

Releases are built by GitHub Actions straight from the public source code, with checksums and build attestations, so
you can check that what you downloaded is what the source says. See [Checking a download](./download#checking-a-download).

## This website

This site is the only part of Docketeer on the internet. It is a set of static pages hosted by GitHub Pages: it has
no analytics, no cookies, no forms and no accounts. Downloads come straight from GitHub's release page.
