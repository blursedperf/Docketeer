#!/usr/bin/env node
/*
 * Screenshot comparison (docs/design/polish-plan.md §4). Compares the PNGs `npm run shots` wrote with
 * the reference images in test/visual/<platform>/, and fails when any screen changed by more than
 * MAX_RATIO of its pixels. Differences are written as images to <out>/diff/ for review.
 *
 *   node scripts/shots-diff.mjs <shots-dir> [--update] [--platform linux]
 *
 * --update copies the new screenshots over the references (after reviewing the change). References are
 * per platform because fonts differ; CI compares on Linux.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const shots = args.find((a) => !a.startsWith('--'));
const update = args.includes('--update');
const platform = args.includes('--platform') ? args[args.indexOf('--platform') + 1] : process.platform;
/** Share of pixels that may differ (antialiasing, subpixel shifts). */
const MAX_RATIO = 0.003;

if (!shots || !existsSync(shots)) {
	console.error('Usage: node scripts/shots-diff.mjs <shots-dir> [--update] [--platform linux]');
	process.exit(2);
}
const baseline = join(ROOT, 'test', 'visual', platform);
const names = readdirSync(shots).filter((f) => /^\d\d-.+\.png$/.test(f)).sort();
if (names.length === 0) {
	console.error(`No screenshots in ${shots}.`);
	process.exit(2);
}

const empty = names.filter((n) => statSync(join(shots, n)).size === 0);
if (empty.length) {
	console.error(`Empty screenshot(s), the capture failed: ${empty.join(', ')}`);
	process.exit(1);
}

if (update) {
	mkdirSync(baseline, { recursive: true });
	for (const n of names) copyFileSync(join(shots, n), join(baseline, n));
	console.log(`Updated ${names.length} reference image(s) in test/visual/${platform}/.`);
	process.exit(0);
}

if (!existsSync(baseline)) {
	console.log(`No reference images for ${platform} yet (test/visual/${platform}/). Review the screenshots, then run with --update.`);
	process.exit(0);
}

const diffDir = join(shots, 'diff');
mkdirSync(diffDir, { recursive: true });
const failures = [];
for (const n of names) {
	const refPath = join(baseline, n);
	if (!existsSync(refPath)) { failures.push(`${n}: no reference image`); continue; }
	let a;
	let b;
	try {
		a = PNG.sync.read(readFileSync(refPath));
		b = PNG.sync.read(readFileSync(join(shots, n)));
	} catch (e) {
		failures.push(`${n}: not a readable PNG (${e instanceof Error ? e.message : e})`);
		console.log(`✗ ${n.padEnd(34)} unreadable`);
		continue;
	}
	if (a.width !== b.width || a.height !== b.height) {
		failures.push(`${n}: size ${b.width}×${b.height}, reference ${a.width}×${a.height}`);
		continue;
	}
	const diff = new PNG({ width: a.width, height: a.height });
	const changed = pixelmatch(a.data, b.data, diff.data, a.width, a.height, { threshold: 0.1 });
	const ratio = changed / (a.width * a.height);
	const mark = ratio > MAX_RATIO ? '✗' : '✓';
	console.log(`${mark} ${n.padEnd(34)} ${(ratio * 100).toFixed(3)}% changed`);
	if (ratio > MAX_RATIO) {
		writeFileSync(join(diffDir, n), PNG.sync.write(diff));
		failures.push(`${n}: ${(ratio * 100).toFixed(2)}% of pixels changed`);
	}
}
for (const ref of readdirSync(baseline).filter((f) => f.endsWith('.png'))) {
	if (!names.includes(ref)) failures.push(`${ref}: reference has no screenshot (screen removed or renamed?)`);
}
if (failures.length) {
	console.error(`\nScreens changed (diff images in ${diffDir}):`);
	for (const f of failures) console.error(`  ${f}`);
	console.error('\nIf the change is intended, review it and run with --update.');
	process.exit(1);
}
console.log(`\nAll ${names.length} screens match the references.`);
