/**
 * Builds the iOS app for the simulator (macOS with Xcode only): the page first (build.mjs), then the Xcode project.
 * `--test` also runs the XCTests on a simulator (DOCKETEER_SIMULATOR names it; default "iPhone 17").
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'darwin') {
	console.error('build:xcode needs macOS with Xcode. On this computer, `npm run build -w @quire/ios` builds the web part only.');
	process.exit(1);
}
const here = join(dirname(fileURLToPath(import.meta.url)), '..');
const project = join(here, 'Docketeer', 'Docketeer.xcodeproj');
if (!existsSync(project)) {
	console.error(`There is no Xcode project at ${project}.`);
	process.exit(1);
}
const run = (cmd, args) => {
	const r = spawnSync(cmd, args, { stdio: 'inherit', cwd: here });
	if (r.status !== 0) process.exit(r.status ?? 1);
};
run(process.execPath, ['build.mjs']);
const test = process.argv.includes('--test');
const destination = test ? `platform=iOS Simulator,name=${process.env.DOCKETEER_SIMULATOR ?? 'iPhone 17'}` : 'generic/platform=iOS Simulator';
run('xcodebuild', [
	test ? 'test' : 'build', '-project', project, '-scheme', 'Docketeer', '-configuration', 'Debug',
	'-destination', destination, '-derivedDataPath', join(here, 'Docketeer', 'build'), 'CODE_SIGNING_ALLOWED=NO', '-quiet',
]);
console.log(test ? 'The XCTests passed.' : `Built ${join(here, 'Docketeer', 'build', 'Build', 'Products', 'Debug-iphonesimulator', 'Docketeer.app')}`);
