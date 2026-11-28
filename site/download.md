# Download and install

Docketeer is free, for macOS and Linux. It needs no account and never connects to the internet, so it works the
same on a plane, in an exam room or at home.

::: info Docketeer is in beta
It is stable enough to use every day, and new features and fixes arrive often. Your notes are ordinary files in your
own folder, so nothing is locked in, but keep a backup of them, as you would with any app. If something goes wrong,
please [report it on GitHub](https://github.com/blursedperf/Docketeer/issues).
:::

<DownloadButtons />

## macOS

1. Download the `.dmg` for your Mac: **Apple Silicon** for a Mac with an M1 chip or later, **Intel** for older Macs.
   (Not sure? Apple menu → About This Mac: it says *Chip* for Apple Silicon and *Processor* for Intel.)
2. Open the `.dmg` and drag **Docketeer** into **Applications**.
3. Open Docketeer from Applications. Docketeer is not yet notarised by Apple, so the first time macOS says it
   *could not verify Docketeer is free of malware*. Click **Done**, then:
   1. Open **System Settings → Privacy & Security**.
   2. Scroll down to **Security**: it says *"Docketeer" was blocked to protect your Mac*. Click **Open Anyway**.
   3. Confirm with your password or Touch ID, then **Open Anyway** once more.

   This is needed only once: after that, Docketeer opens like any other app.

   ::: details Or, with Terminal
   Run this once, then open Docketeer from Applications as usual:

   ```bash
   xattr -dr com.apple.quarantine /Applications/Docketeer.app
   ```
   :::

## Linux

Pick the package for your system. Each comes for ordinary PCs (x86-64) and for ARM (arm64).

| System | Download | Install |
|---|---|---|
| Any distribution | AppImage | `chmod +x Docketeer-*.AppImage`, then run it |
| Debian, Ubuntu, Mint | `.deb` | `sudo apt install ./Docketeer-*.deb` |
| Arch, Omarchy | `.pacman` | `sudo pacman -U Docketeer-*.pacman` |

## Not yet available

- **Windows**: not built yet.
- **iPhone and iPad**: in testing. It will open the same folders of notes, synced through iCloud.

## Checking a download

Every release lists SHA-256 checksums in `SHA256SUMS.txt` (under *Other downloads* above), and the installers are
built by GitHub Actions straight from the source, with build attestations. To check a file on macOS or Linux:

```bash
shasum -a 256 Docketeer-*.dmg      # macOS; on Linux: sha256sum Docketeer-*.AppImage
# then compare with the line for that file in SHA256SUMS.txt
```

## Updating

Download the new version and install it over the old one. Your notes are in your own folder and your settings are
kept: nothing is lost. Docketeer does not check for updates by itself (that would mean going online), so watch the
[releases page](https://github.com/blursedperf/Docketeer/releases) or this site for new versions.
