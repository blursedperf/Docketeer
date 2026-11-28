# Locking notes

Lock a note, or a whole subject or topic, and it is **encrypted on disk**. Anyone who opens the file in another app,
or finds it in a backup or a synced folder, sees only *This note is encrypted by Docketeer*.

![A locked note in Subjects](/screenshots/37-units-locked-note.png){.shot}

## Setting up

Run **Set up locking** (or Settings → Security) once:

1. Choose a **passphrase**. One passphrase unlocks every locked note in the homebase.
2. Docketeer shows a **recovery key**, once. Print it or keep it somewhere safe: if you forget the passphrase, it is
   the only way back in. Lose both and no one, including the makers of Docketeer, can read your locked notes.

## Locking and unlocking

- **Lock** a note or folder from its actions (→ in the Docket), or with *Lock note* / *Lock folder*. New notes made
  in a locked folder are locked too.
- **⌘L**, or the lock in the status bar, locks everything now: open locked notes are saved and closed and nothing of
  them stays in memory.
- Docketeer also locks after 15 idle minutes and when the computer sleeps or the screen locks (each can be turned
  off in Settings → Security), and is always locked when it starts.
- Open a locked note to unlock: it asks for the passphrase.
- **Remove the lock** (in the note's or folder's actions) decrypts it again.

While locked, a locked note shows only as its name with a lock. Nothing else about it appears anywhere: not in
search, Authorities, links, previews, flashcards, tasks or outlines.

## What is and is not protected

- Notes are encrypted with AES-256-GCM. Your passphrase unlocks the key through PBKDF2 (600,000 rounds), and is
  never written down anywhere.
- **File and folder names are not encrypted**: give a sensitive note a neutral name if its name gives it away.
- Attachments (pictures, PDFs) are not encrypted.
- Copies made before a note was locked (in other backups or sync history) are outside Docketeer's reach.
- Exporting a locked note warns you first, since the export is not encrypted.
