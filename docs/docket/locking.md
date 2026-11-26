# Locking and encryption

Decided with the user on 2026-11-25. Notes and folders can be locked; locked notes are encrypted on disk.

## What the user sees

- **Set up locking** once: choose a passphrase. Docketeer shows a **recovery key** once, to print or store
  safely. Forget the passphrase and lose the recovery key, and locked notes cannot be read by anyone.
- **Lock a note or a folder** (a subject or topic): its notes are encrypted on disk. New notes made in a
  locked folder are encrypted too. **Remove the lock** decrypts them again.
- **Unlocked / locked**: one passphrase opens every locked note for the session; **Lock now** (Mod+L)
  forgets it. While locked, locked notes are listed by name in Units with a lock, and nothing else about them
  appears anywhere: not in search, Authorities, links, mentions, previews, embeds, exports, the usage record
  or logs. Opening one asks for the passphrase.
- **Auto-lock**: after a set idle time (15 minutes by default) and when the computer sleeps or the screen
  locks, each can be turned off (Settings → Security). Docketeer is always locked after it closes: the key is
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
  This note is encrypted by Docketeer. Open it in Docketeer to read it.

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
- Someone who can run code as you while Docketeer is unlocked can read what Docketeer can.
- Copies made before a note was locked (other backups, sync services) are outside Docketeer's reach.

## Face ID and Touch ID on iPhone and iPad (design: not built, waiting for sign-off)

Written 2026-11-27 for docs/mobile/PLAN.md, Phase 2. **Nothing here is implemented until the owner signs it
off.** The passphrase stays the way in that always works; Face ID is a quicker way to the same key on one device.

### What the user sees

- After unlocking with the passphrase on an iPhone or iPad, Docketeer offers once: **"Unlock with Face ID on
  this iPhone?"** (Touch ID on a device that has it). It is also in Settings → Security, with **Forget Face ID
  on this device**.
- Locked, the unlock prompt shows Face ID first; **Use passphrase** is always beside it. Cancelling Face ID
  leaves the passphrase field.
- It is per device and per homebase: the Mac, another iPhone and other homebases are untouched. Nothing about it
  goes into the homebase or syncs.
- Docketeer still locks on leaving (when that is on), after the idle time and on closing; Face ID only makes
  unlocking again quicker.

### How it works

- **Keychain item**, one per homebase on this device: the 256-bit homebase key itself, stored by the Swift
  shell with an access control of **`.biometryCurrentSet`** and accessibility
  **`kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly`**. So:
  - only a face or finger enrolled *when the item was made* can read it (a new face or finger enrolled later
    deletes it, and the passphrase is needed again);
  - it is never in a backup and never leaves the device (iCloud Keychain included); turning off the device
    passcode deletes it;
  - **the device passcode does not open it** (no `.devicePasscode` / `.userPresence`): someone who knows the
    phone's passcode cannot reach locked notes. The fallback button is Docketeer's own passphrase.
  The item's account is the homebase's place (its bookmark id), and its label says what it is, not which notes.
- **Enrolling** happens straight after a passphrase unlock, the one moment the page holds the raw key (in
  `unlockWithPassphrase`, before it is imported as a non-extractable `CryptoKey` and wiped). The page passes the
  raw key over the bridge once; native stores it; the page wipes its copy. The `CryptoKey` stays
  non-extractable, as now.
- **Unlocking**: native reads the item (iOS shows Face ID), hands the raw key to the page, which imports it and
  wipes the bytes. The page then **checks it is the right key** by decrypting one sealed note; if that fails (the
  homebase's locking was removed and set up again, so its key changed), the item is deleted and the passphrase is
  asked for. A passphrase change or recovery keeps the same homebase key, so the item stays good.
- **Forgetting**: "Forget Face ID on this device", removing locking from the homebase, and forgetting the
  homebase on this device all delete the item.
- **Bridge channels** (page ↔ Swift; only the main frame at quire://app/, as every channel):
  `lock:biometry` (what the device has: none, Face ID, Touch ID), `lock:biometryEnrol(raw)`,
  `lock:biometryUnlock()` → the raw key, or null when cancelled or gone, and `lock:biometryForget()`. Each acts
  on the open homebase only; the page never names another.
- `NSFaceIDUsageDescription`: "Docketeer uses Face ID to unlock your locked notes."
- Desktop is unchanged. (Touch ID on a Mac could use the same design later.)

### What it does not change, and what it adds

- The lock file, the note format and the passphrase and recovery key are untouched: a homebase opened on a
  device without Face ID, or on the Mac, works exactly as now.
- **Added exposure**: the homebase key is in the device's Keychain, behind the Secure Enclave's biometric check,
  instead of only in memory while unlocked. Someone who can get past Face ID on this device (or run code as
  Docketeer on a compromised device) can unlock. This is the same trade that banking and password apps make, and
  it is opt-in.
- The raw key crosses the bridge, inside the app's own process, at enrolling and at each Face ID unlock.

### For the owner to decide

1. Is the device passcode kept out as a fallback (recommended above), or should it open the notes too?
2. Offer it once after a passphrase unlock (above), or only from Settings → Security?
