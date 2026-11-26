/**
 * Builds the page the iOS shell serves at quire://app/ into Docketeer/Resources/app/ (git-ignored): the desktop
 * renderer built for Safari, the iOS boot script (web/boot.ts) loaded ahead of it, and the same plugins, fonts,
 * dictionaries, PDF assets and example homebase. Build the plugins first (the root `npm run build` does).
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from '../app/build.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const dist = await buildApp({
	dist: join(here, 'Docketeer', 'Resources', 'app'),
	target: 'safari17',
	electron: false,
	boot: join(here, 'web', 'boot.ts'),
});
console.log(`Built Docketeer for iOS into ${dist}`);
