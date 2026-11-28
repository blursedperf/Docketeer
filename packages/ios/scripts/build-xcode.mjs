/**
 * Builds the iOS app for the simulator (macOS with Xcode only): the page first (build.mjs), then the Xcode project.
 * `--test` also runs the XCTests on a simulator (CASELORE_SIMULATOR names it; default "iPhone 17"). `--shots`
 * runs only the iPhone screenshots, into Caselore/build/shots/ (compare them: npm run shots:ios).
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
const project = join(here, 'Caselore', 'Caselore.xcodeproj');
if (!existsSync(project)) {
	console.error(`There is no Xcode project at ${project}.`);
	process.exit(1);
}
const run = (cmd, args, env = process.env) => {
	const r = spawnSync(cmd, args, { stdio: 'inherit', cwd: here, env });
	if (r.status !== 0) process.exit(r.status ?? 1);
};
run(process.execPath, ['build.mjs']);
const shots = process.argv.includes('--shots');
const test = shots || process.argv.includes('--test');
const destination = test ? `platform=iOS Simulator,name=${process.env.CASELORE_SIMULATOR ?? 'iPhone 17'}` : 'generic/platform=iOS Simulator';
run('xcodebuild', [
	test ? 'test' : 'build', '-project', project, '-scheme', 'Caselore', '-configuration', 'Debug',
	'-destination', destination, '-derivedDataPath', join(here, 'Caselore', 'build'), 'CODE_SIGNING_ALLOWED=NO', '-quiet',
	...(shots ? ['-only-testing:CaseloreTests/SmokeTests/testPhoneScreenshots'] : []),
], shots ? { ...process.env, TEST_RUNNER_CASELORE_SHOTS: join(here, 'Caselore', 'build', 'shots') } : process.env);
console.log(test ? 'The XCTests passed.' : `Built ${join(here, 'Caselore', 'build', 'Build', 'Products', 'Debug-iphonesimulator', 'Caselore.app')}`);
