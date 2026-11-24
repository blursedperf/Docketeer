/**
 * Builds the app into dist/:
 *   main.cjs, preload.cjs        Electron main process and preload bridge
 *   renderer/renderer.js         the UI (ES module) with the single copy of @quire/api and CodeMirror
 *   renderer/modules/*.js        shims plugins import through the import map; they re-export the renderer's instances
 *   renderer/index.html          with the import map inline, and csp.txt with its hash
 *   plugins/<id>/                built-in plugins, copied from ../../plugins/*
 */
import esbuild from 'esbuild';
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, 'dist');
const rendererOut = join(dist, 'renderer');
const watch = process.argv.includes('--watch');

/** Modules shared with plugins. Plugins mark these external; the import map points them at shims. */
export const SHARED = [
	'@quire/api',
	'@codemirror/state',
	'@codemirror/view',
	'@codemirror/language',
	'@codemirror/commands',
	'@codemirror/search',
	'@codemirror/autocomplete',
	'@codemirror/lang-markdown',
	'@lezer/common',
	'@lezer/highlight',
	'@lezer/markdown',
];

await rm(dist, { recursive: true, force: true });
await mkdir(join(rendererOut, 'modules'), { recursive: true });

const common = { bundle: true, logLevel: 'warning', sourcemap: 'linked', legalComments: 'none' };

await esbuild.build({ ...common, entryPoints: [join(here, 'src/main/main.ts')], outfile: join(dist, 'main.cjs'), platform: 'node', format: 'cjs', target: 'node22', external: ['electron'] });
await esbuild.build({ ...common, entryPoints: [join(here, 'src/main/preload.ts')], outfile: join(dist, 'preload.cjs'), platform: 'node', format: 'cjs', target: 'node22', external: ['electron'] });
/** Phosphor icons (MIT) as data: every icon is a single <path>, so one string per weight. */
const PHOSPHOR_WEIGHTS = ['regular', 'light', 'bold', 'thin'];
const phosphorIcons = {
	name: 'phosphor-icons',
	setup(build) {
		build.onResolve({ filter: /^virtual:phosphor-icons$/ }, () => ({ path: 'phosphor-icons', namespace: 'virtual' }));
		build.onLoad({ filter: /.*/, namespace: 'virtual' }, async () => {
			let pkg = dirname(fileURLToPath(import.meta.resolve('@phosphor-icons/core')));
			while (!existsSync(join(pkg, 'assets', 'regular'))) {
				if (dirname(pkg) === pkg) throw new Error('@phosphor-icons/core assets not found');
				pkg = dirname(pkg);
			}
			const root = join(pkg, 'assets');
			const icons = {};
			for (const [i, w] of PHOSPHOR_WEIGHTS.entries()) {
				for (const f of await readdir(join(root, w))) {
					if (!f.endsWith('.svg')) continue;
					const svg = await readFile(join(root, w, f), 'utf8');
					const paths = [...svg.matchAll(/<path d="([^"]+)"/g)];
					if (paths.length !== 1 || /<(?!path|svg|\/)/.test(svg)) throw new Error(`Unexpected Phosphor SVG: ${w}/${f}`);
					const name = f.slice(0, -4).replace(new RegExp(`-${w}$`), '');
					(icons[name] ??= [])[i] = paths[0][1];
				}
			}
			return { contents: JSON.stringify({ weights: PHOSPHOR_WEIGHTS, icons }), loader: 'json' };
		});
	},
};

await esbuild.build({ ...common, entryPoints: [join(here, 'src/renderer/main.ts')], outfile: join(rendererOut, 'renderer.js'), platform: 'browser', format: 'esm', target: 'chrome130', plugins: [phosphorIcons] });

// Shims: the export names of each shared module, read from esbuild's metafile.
const imports = {};
for (const mod of SHARED) {
	const r = await esbuild.build({
		stdin: { contents: `export * from ${JSON.stringify(mod)};`, resolveDir: here, loader: 'js' },
		bundle: true, write: false, format: 'esm', platform: 'browser', metafile: true, outfile: 'x.js', logLevel: 'silent',
	});
	const names = Object.values(r.metafile.outputs)[0].exports.filter((n) => n !== 'default');
	const file = `${mod.replace(/^@/, '').replace(/[/]/g, '-')}.js`;
	const src = [
		`// Re-exports the app's own ${mod}, so plugins share its instances.`,
		`const m = globalThis.__quireModules && globalThis.__quireModules[${JSON.stringify(mod)}];`,
		`if (!m) throw new Error(${JSON.stringify(`${mod} is not available`)});`,
		`export const { ${names.join(', ')} } = m;`,
		'',
	].join('\n');
	await writeFile(join(rendererOut, 'modules', file), src);
	imports[mod] = `/modules/${file}`;
}

const importMap = JSON.stringify({ imports }, null, 2);
const hash = createHash('sha256').update(importMap).digest('base64');
const csp = [
	"default-src 'none'",
	`script-src 'self' quire://app 'sha256-${hash}'`,
	"style-src 'self' quire://app 'unsafe-inline'",
	"img-src 'self' quire://app data: blob:",
	"font-src 'self' quire://app data:",
	"media-src 'self' quire://app blob:",
	"connect-src 'none'",
	"object-src 'none'",
	"frame-src 'none'",
	"worker-src 'none'",
	"base-uri 'none'",
	"form-action 'none'",
].join('; ');
await writeFile(join(rendererOut, 'csp.txt'), csp);
await writeFile(join(rendererOut, 'index.html'), `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Quire</title>
<script type="importmap">${importMap}</script>
<link rel="stylesheet" href="/app.css">
<script type="module" src="/renderer.js"></script>
</head>
<body></body>
</html>
`);
await cp(join(here, 'src/renderer/app.css'), join(rendererOut, 'app.css'));

// Spelling dictionaries (SCOWL, via wooorm/dictionaries), read by the main process on demand.
for (const [lang, pkg] of [['en-AU', 'dictionary-en-au'], ['en-GB', 'dictionary-en-gb'], ['en-US', 'dictionary-en']]) {
	// These packages export only their JS entry, so read the files from the package folder.
	const src = join(here, '..', '..', 'node_modules', pkg);
	const out = join(dist, 'dictionaries', lang);
	await mkdir(out, { recursive: true });
	for (const f of ['index.aff', 'index.dic', 'license']) await cp(join(src, f), join(out, f));
}

// Licence notices for everything the app ships, shown under Settings → About.
const NOTICE_PACKAGES = [
	'electron', 'codemirror', '@codemirror/state', '@codemirror/view', '@codemirror/language', '@codemirror/commands',
	'@codemirror/search', '@codemirror/autocomplete', '@codemirror/lang-markdown', '@lezer/common', '@lezer/highlight',
	'@lezer/lr', '@lezer/markdown', 'style-mod', 'w3c-keyname', 'crelt', '@marijn/find-cluster-break',
	'@replit/codemirror-vim', '@replit/codemirror-vim-core', 'markdown-it', 'markdown-it-footnote', 'entities', 'linkify-it',
	'mdurl', 'uc.micro', 'punycode.js', 'argparse', 'yaml', 'lucide', '@phosphor-icons/core', 'nspell', 'is-buffer',
	'dictionary-en-au', 'dictionary-en-gb', 'dictionary-en', 'docx', 'fflate', 'jszip',
];
let notices = 'Quire includes the following software and data. Their licences follow.\n';
const root = join(here, '..', '..', 'node_modules');
for (const name of NOTICE_PACKAGES) {
	const dir = join(root, name);
	if (!existsSync(dir)) continue;
	const pkgJson = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'));
	const file = (await readdir(dir)).find((f) => /^(licen[cs]e|copying)(\.(md|txt))?$/i.test(f));
	notices += `\n${'='.repeat(78)}\n${name} ${pkgJson.version ?? ''} (${pkgJson.license ?? 'see below'})\n${'='.repeat(78)}\n\n`;
	notices += file ? (await readFile(join(dir, file), 'utf8')).trim() + '\n' : `Licence: ${pkgJson.license ?? 'unknown'}\n`;
}
await writeFile(join(dist, 'THIRD_PARTY_NOTICES.txt'), notices);

// Built-in plugins.
const pluginsRoot = join(here, '..', '..', 'plugins');
for (const name of existsSync(pluginsRoot) ? await readdir(pluginsRoot) : []) {
	const dir = join(pluginsRoot, name);
	if (!existsSync(join(dir, 'manifest.json')) || !existsSync(join(dir, 'main.js'))) {
		console.warn(`Skipping plugin ${name}: build it first (manifest.json and main.js are needed).`);
		continue;
	}
	const manifest = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'));
	const out = join(dist, 'plugins', manifest.id);
	await mkdir(out, { recursive: true });
	for (const f of ['manifest.json', 'main.js', 'styles.css']) if (existsSync(join(dir, f))) await cp(join(dir, f), join(out, f));
}

console.log(`Built Quire into ${dist}`);
if (watch) console.log('(--watch is not supported yet; re-run the build)');
