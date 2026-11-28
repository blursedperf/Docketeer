# Privacy

Your writing never leaves your computer.

- **Fully offline.** The plugin makes no network requests of any kind: no servers, no APIs, no downloads, no update checks. It works the same with your internet connection turned off.
- **No AI.** Citations are checked with fixed rules written from the AGLC4 text, not by a language model or any other AI service. Nothing you write is sent anywhere to be analysed, and the same text always gets the same result.
- **No telemetry, no accounts.** There is no tracking, analytics or sign-in.
- **Your files stay where they are.** Word and HTML exports are written into your homebase; Word imports are read on your computer. Nothing is uploaded.
- **What it stores.** Its settings, in your homebase's `.quire` folder, and the [version history](version-history.md), in a folder of your homebase (`.aglc-history` by default).

## How this is checked

- **Offline audit.** Every build is checked by an offline audit (`scripts/offline-audit.mjs`) over the source code, the built plugin and its styles, including the libraries bundled into it (`docx` for Word files and `fflate` for zip files). The audit fails if any of them could make a network request, open a web page, run generated code, decode or encode base64, or inject raw HTML.
- **Readable code.** The released `main.js` is not minified, so anyone can read exactly what it does.
- **Verifiable build.** Each Caselore release carries a GitHub build attestation. To confirm that a downloaded installer was built from this repository's source by its release workflow, run `gh attestation verify <installer> -R blursedperf/Docketeer`.

The developer tools in `scripts/` (such as the Word fidelity check, which drives a local browser) are not part of the plugin and are not in a release.
