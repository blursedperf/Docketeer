/**
 * Builds the app into dist/:
 *   main.cjs, preload.cjs        Electron main process and preload bridge
 *   renderer/renderer.js         the UI (ES module) with the single copy of @quire/api and CodeMirror
 *   renderer/modules/*.js        shims plugins import through the import map; they re-export the renderer's instances
 *   renderer/index.html          with the import map inline, and csp.txt with its hash
 *   renderer/pdf/engine.js       pdf.js (loaded when a PDF is first opened) and its JavaScript image decoders
 *   pdfjs/                       fonts and character maps for PDFs, read by the main process on demand
 *   renderer/fonts/              Inter, JetBrains Mono and Source Serif 4 (Latin), the app's own fonts
 *   example-homebase/            the example homebase (example/), with its sample recording and reading
 *   plugins/<id>/                built-in plugins, copied from ../../plugins/*
 *
 * `node build.mjs` builds the desktop app. Other hosts call buildApp(): the iOS shell (packages/ios) builds for
 * Safari, without the Electron files, and with a boot script that installs the host bridge before the renderer.
 */
import esbuild from 'esbuild';
import { buildExample } from './example/build.mjs';
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

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

/** CHANGELOG.md as text, bundled so "What's new" can be shown with no network (whats-new.ts). */
const changelog = {
	name: 'changelog',
	setup(build) {
		build.onResolve({ filter: /^virtual:changelog$/ }, () => ({ path: 'changelog', namespace: 'changelog' }));
		build.onLoad({ filter: /.*/, namespace: 'changelog' }, async () => ({ contents: await readFile(join(here, '..', '..', 'CHANGELOG.md'), 'utf8'), loader: 'text' }));
	},
};

/**
 * Build the app into `dist`. `target` is the browser the renderer runs in; `electron` adds the main process and
 * preload; `boot` is a module the page loads instead of renderer.js (it imports renderer.js itself).
 */
export async function buildApp({ dist = join(here, 'dist'), target = 'chrome130', electron = true, boot = null } = {}) {
	const rendererOut = join(dist, 'renderer');
	await rm(dist, { recursive: true, force: true });
	await mkdir(join(rendererOut, 'modules'), { recursive: true });

	const common = { bundle: true, logLevel: 'warning', sourcemap: 'linked', legalComments: 'none' };

	if (electron) {
		await esbuild.build({ ...common, entryPoints: [join(here, 'src/main/main.ts')], outfile: join(dist, 'main.cjs'), platform: 'node', format: 'cjs', target: 'node22', external: ['electron'] });
		await esbuild.build({ ...common, entryPoints: [join(here, 'src/main/preload.ts')], outfile: join(dist, 'preload.cjs'), platform: 'node', format: 'cjs', target: 'node22', external: ['electron'] });
	}
	await esbuild.build({ ...common, entryPoints: [join(here, 'src/renderer/main.ts')], outfile: join(rendererOut, 'renderer.js'), platform: 'browser', format: 'esm', target, plugins: [phosphorIcons, changelog] });
	// The host's boot script (iOS): installs window.quire, then loads the renderer.
	if (boot) await esbuild.build({ ...common, entryPoints: [boot], outfile: join(rendererOut, 'boot.js'), platform: 'browser', format: 'esm', target });

	// The PDF engine: pdf.js in a module of its own, loaded the first time a PDF opens (pdf/view.ts).
	await esbuild.build({ ...common, entryPoints: [join(here, 'src/renderer/pdf/engine.ts')], outfile: join(rendererOut, 'pdf', 'engine.js'), platform: 'browser', format: 'esm', target });
	const pdfjsRoot = join(here, '..', '..', 'node_modules', 'pdfjs-dist');
	// Its JavaScript decoders for JPEG 2000 and JBIG2 images (no WebAssembly: the CSP does not allow it).
	await mkdir(join(rendererOut, 'pdf', 'wasm'), { recursive: true });
	for (const f of ['openjpeg_nowasm_fallback.js', 'jbig2_nowasm_fallback.js']) await cp(join(pdfjsRoot, 'wasm', f), join(rendererOut, 'pdf', 'wasm', f));
	// Standard fonts and character maps, read through the main process (pdf:asset), never fetched.
	for (const d of ['standard_fonts', 'cmaps']) await cp(join(pdfjsRoot, d), join(dist, 'pdfjs', d), { recursive: true });

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
	// iOS: no zooming in on a field when it is tapped (iOS zooms to any text under 16px, and the zoomed page then
	// pans sideways); text size is a setting. viewport-fit=cover: the page reaches the screen's edges and keeps
	// clear of the home indicator and rounded corners itself (env(safe-area-inset-*) in app.css). Desktop as before.
	const viewport = boot ? 'width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover' : 'width=device-width, initial-scale=1';
	await writeFile(join(rendererOut, 'index.html'), `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="${viewport}">
<title>Caselore</title>
<script type="importmap">${importMap}</script>
<link rel="stylesheet" href="/app.css">
<script type="module" src="/${boot ? 'boot' : 'renderer'}.js"></script>
</head>
<body></body>
</html>
`);
	// Fonts shipped with Caselore (SIL OFL 1.1): Latin and Latin Extended, upright and italic, variable weight. They are
	// the defaults (Inter for the interface, JetBrains Mono for code and the chrome) and an option (Source Serif 4), so
	// Caselore looks the same on every computer. Their @font-face rules go ahead of the stylesheet.
	const FONTS = [['inter', 'Inter', '100 900'], ['jetbrains-mono', 'JetBrains Mono', '100 800'], ['source-serif-4', 'Source Serif 4', '200 900']];
	const RANGES = {
		latin: 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD',
		'latin-ext': 'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF',
	};
	let fontFaces = '/* Fonts shipped with Caselore (generated by build.mjs). */\n';
	await mkdir(join(rendererOut, 'fonts'), { recursive: true });
	for (const [id, family, weights] of FONTS) {
		for (const subset of ['latin-ext', 'latin']) {
			for (const style of ['normal', 'italic']) {
				const file = `${id}-${subset}-wght-${style}.woff2`;
				await cp(join(here, '..', '..', 'node_modules', '@fontsource-variable', id, 'files', file), join(rendererOut, 'fonts', file));
				fontFaces += `@font-face { font-family: "${family}"; font-style: ${style}; font-display: block; font-weight: ${weights}; src: url("fonts/${file}") format("woff2-variations"); unicode-range: ${RANGES[subset]}; }\n`;
			}
		}
	}
	await writeFile(join(rendererOut, 'app.css'), fontFaces + (await readFile(join(here, 'src/renderer/app.css'), 'utf8')));

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
		'dictionary-en-au', 'dictionary-en-gb', 'dictionary-en', 'docx', 'fflate', 'jszip', 'pdfjs-dist',
		'@fontsource-variable/inter', '@fontsource-variable/jetbrains-mono', '@fontsource-variable/source-serif-4',
	];
	let notices = 'Caselore includes the following software and data. Their licences follow.\n';
	const root = join(here, '..', '..', 'node_modules');
	for (const name of NOTICE_PACKAGES) {
		if (name === 'electron' && !electron) continue;
		const dir = join(root, name);
		if (!existsSync(dir)) continue;
		const pkgJson = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'));
		const file = (await readdir(dir)).find((f) => /^(licen[cs]e|copying)(\.(md|txt))?$/i.test(f));
		notices += `\n${'='.repeat(78)}\n${name} ${pkgJson.version ?? ''} (${pkgJson.license ?? 'see below'})\n${'='.repeat(78)}\n\n`;
		notices += file ? (await readFile(join(dir, file), 'utf8')).trim() + '\n' : `Licence: ${pkgJson.license ?? 'unknown'}\n`;
	}
	// pdf.js ships fonts and decoders under their own licences.
	for (const [what, file] of [
		['pdf.js standard fonts (Foxit)', 'standard_fonts/LICENSE_FOXIT'], ['pdf.js standard fonts (Liberation)', 'standard_fonts/LICENSE_LIBERATION'],
		['OpenJPEG (JPEG 2000 decoder)', 'wasm/LICENSE_OPENJPEG'], ['pdf.js OpenJPEG build', 'wasm/LICENSE_PDFJS_OPENJPEG'],
		['JBIG2 decoder', 'wasm/LICENSE_JBIG2'], ['pdf.js JBIG2 build', 'wasm/LICENSE_PDFJS_JBIG2'],
	]) {
		notices += `\n${'='.repeat(78)}\n${what}\n${'='.repeat(78)}\n\n${(await readFile(join(root, 'pdfjs-dist', file), 'utf8')).trim()}\n`;
	}
	await writeFile(join(dist, 'THIRD_PARTY_NOTICES.txt'), notices);

	// The example homebase (example/build.mjs), copied into Documents when the user asks for it.
	await buildExample(join(dist, 'example-homebase'));

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
	return dist;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	const dist = await buildApp();
	console.log(`Built Caselore into ${dist}`);
	if (process.argv.includes('--watch')) console.log('(--watch is not supported yet; re-run the build)');
}
