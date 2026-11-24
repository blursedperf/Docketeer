# Locking and encryption

Decided with the user on 2026-11-25. Notes and folders can be locked; locked notes are encrypted on disk.

## What the user sees

- **Set up locking** once: choose a passphrase. Quire shows a **recovery key** once, to print or store
  safely. Forget the passphrase and lose the recovery key, and locked notes cannot be read by anyone.
- **Lock a note or a folder** (a subject or topic): its notes are encrypted on disk. New notes made in a
  locked folder are encrypted too. **Remove the lock** decrypts them again.
- **Unlocked / locked**: one passphrase opens every locked note for the session; **Lock now** (Mod+L)
  forgets it. While locked, locked notes are listed by name in Units with a lock, and nothing else about them
  appears anywhere: not in search, Authorities, links, mentions, previews, embeds, exports, the usage record
  or logs. Opening one asks for the passphrase.
- **Auto-lock**: after a set idle time (15 minutes by default) and when the computer sleeps or the screen
  locks, each can be turned off (Settings → Security). Quire is always locked after it closes: the key is
  never written to disk.

## How it works

- **Key**: a random 256-bit homebase key encrypts notes (AES-GCM, a fresh 96-bit IV per write).
- **Passphrase**: PBKDF2-SHA-256, 600,000 iterations, a random 16-byte salt, gives a key that wraps the
  homebase key (AES-GCM). A wrong passphrase fails the authentication check; nothing is compared directly.
- **Recovery key**: 200 random bits shown as 8 groups of 5 letters and digits (no 0, O, 1 or I); it wraps the homebase key
  the same way (its own salt). Using it lets you set a new passphrase.
- **`.quire/lock.json`**: format version, KDF parameters, the two wrapped keys, and the lists of locked
  folders. No note names beyond the locked folders' paths; no key or passphrase.
- **A locked note on disk** keeps its file name and `.md` extension (so links and folders still work) and
  holds a short readable header for other apps, then the ciphertext:

  ```
  ---
  quire-locked: 1
  ---
  This note is encrypted by Quire. Open it in Quire to read it.

  <!-- quire-encrypted v1
  base64(iv ‖ ciphertext and tag)
  -->
  ```

  The plaintext is the whole note, frontmatter included. **File names stay readable on disk**: give
  sensitive notes neutral names if names themselves are confidential.
- **In memory only**: decrypted text lives in the editor, the vault's cache, the metadata cache and the
  search index while unlocked. Locking clears all of them for locked notes and closes their tabs (saving
  first).
- **Plugins** read and write locked notes through the vault while unlocked, like the app; they get nothing
  while locked. `app.isEncrypted(file)` tells them a note is locked so they can avoid copying it (the AGLC4
  plugin keeps no version history of locked notes, and erases it when a note is locked).

## Not covered

- File and folder names, attachments (pictures, PDFs) and the folder structure are not encrypted.
- Someone who can run code as you while Quire is unlocked can read what Quire can.
- Copies made before a note was locked (other backups, sync services) are outside Quire's reach.
