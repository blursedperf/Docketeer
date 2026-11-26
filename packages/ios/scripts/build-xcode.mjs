/** Builds the Xcode project (macOS only). The project arrives with the Swift shell in Phase 0. */
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'darwin') {
	console.error('build:xcode needs macOS with Xcode. On this computer, `npm run build -w @quire/ios` builds the web part only.');
	process.exit(1);
}
const project = join(dirname(fileURLToPath(import.meta.url)), '..', 'Docketeer', 'Docketeer.xcodeproj');
if (!existsSync(project)) {
	console.error('There is no Xcode project yet (Docketeer/Docketeer.xcodeproj): it is created with the Swift shell (docs/mobile/PLAN.md, Phase 0).');
	process.exit(1);
}
console.error('Building the Xcode project is not set up yet.');
process.exit(1);
