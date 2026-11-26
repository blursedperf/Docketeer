#!/usr/bin/env node
/*
 * Offline audit for Docketeer: fails if anything that ships could make a network request, run generated
 * code, or inject raw HTML. Same rules as the AGLC4 plugin's audit, applied to:
 *   - the app's source (packages/api/src, packages/app/src, packages/ios/web),
 *   - the iOS shell (Swift in packages/ios/Docketeer and DocketeerTests, its Info.plist and Xcode project),
 *   - the built app (packages/app/dist: main, preload, renderer bundle, shims, CSS),
 *   - every plugin, through its own audit (plugins/<name>/scripts/offline-audit.mjs) or these rules.
 *
 * A few uses are deliberate; each is listed in ALLOWED with its reason, and must still be found (so a
 * stale entry fails too).
 *
 *   node scripts/offline-audit.mjs
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const CODE_RULES = [
	[/\bfetch\s*\(/, 'fetch()'],
	[/\bXMLHttpRequest\b/, 'XMLHttpRequest'],
	[/\bnew\s+WebSocket\b/, 'WebSocket'],
	[/\bEventSource\b/, 'EventSource'],
	[/\bsendBeacon\b/, 'navigator.sendBeacon'],
	[/\bRTCPeerConnection\b/, 'WebRTC'],
	[/\bserviceWorker\.register\b/, 'service workers'],
	[/\bimportScripts\s*\(/, 'importScripts()'],
	[/\bimport\s*\(/, 'dynamic import()'],
	[/require\(\s*["'](?:node:)?(?:http|https|http2|net|tls|dns|dgram|child_process)["']\s*\)/, 'Node network or process module'],
	[/\bfrom\s*["'](?:node:)?(?:http|https|http2|net|tls|dns|dgram|child_process)["']/, 'Node network or process module'],
	[/\bnet\.request\b/, 'Electron net.request'],
	[/\bopenExternal\b/, 'shell.openExternal'],
	[/\bwindow\.open\s*\(/, 'window.open()'],
	[/\bautoUpdater\b/, 'auto-updater'],
	[/\bcrashReporter\b/, 'crash reporter'],
	[/\beval\s*\(/, 'eval()'],
	[/\bnew\s+Function\s*\(/, 'new Function()'],
	[/\bset(?:Timeout|Interval)\s*\(\s*["'`]/, 'string timer (implicit eval)'],
	[/\.outerHTML\s*[+]?=/, 'outerHTML assignment'],
	[/\binsertAdjacentHTML\b/, 'insertAdjacentHTML'],
	[/\bdocument\.write\b/, 'document.write'],
	[/\bcreateContextualFragment\b/, 'createContextualFragment'],
	[/\.src\s*=\s*["'`](?:https?:)?\/\//, 'remote src assignment'],
];
/** innerHTML is checked in our own source only: bundled libraries (CodeMirror) use it on their own, non-user content. */
const SOURCE_ONLY_RULES = [[/\.innerHTML\s*[+]?=/, 'innerHTML assignment']];

/** Swift: nothing that opens a connection or hands a web address to another app (docs/mobile/PLAN.md §0, §2.7). */
const SWIFT_RULES = [
	[/\bURLSession\w*/, 'URLSession'],
	[/\bURLRequest\b/, 'URLRequest'],
	[/\bNW(Connection|Listener|Browser|PathMonitor)\b|import\s+Network\b/, 'Network framework'],
	[/\bCF(Network|Stream|Socket|HTTP)\w*/, 'CFNetwork'],
	[/WebSocket/, 'WebSocket'],
	[/\bSFSafariViewController\b|import\s+SafariServices\b/, 'SFSafariViewController'],
	[/UIApplication\.shared\.open\b|\bopenURL\b|extensionContext\??\.open\b|\bUIApplication\.open\b/, 'opening a URL in another app'],
	[/["']https?:|["']wss?:|["']ftp:/, 'a web address'],
];

const CSS_RULES = [
	[/@import\b/i, '@import'],
	// Allowed: inline data: URIs, #fragments, and the fonts shipped with the app (a relative path under fonts/, which
	// loads from quire://app).
	[/url\(\s*(?!["']?(?:data:|#|fonts\/[\w.-]+\.woff2["']?\s*\)))/i, 'url() that is not an inline data: URI or a shipped font'],
	[/https?:\/\//i, 'remote URL'],
];

/** Deliberate uses: [file (relative), label, reason]. */
const ALLOWED = [
	['packages/api/src/app.ts', 'dynamic import()', 'loads a plugin\'s main.js from quire://app/plugins/ (local files only; the CSP allows scripts only from quire:)'],
	['packages/ios/Docketeer/App/PageViewController.swift', 'URLRequest', 'iOS: the WebView opens the app\'s own page, quire://app/index.html (served from the bundle by QuireSchemeHandler)'],
	['packages/ios/Docketeer/App/PageViewController.swift', 'opening a URL in another app', 'iOS: "Show in folder" opens the Files app at a folder on the device (shareddocuments://, checked before it opens); never a web address'],
	['packages/ios/DocketeerTests/AppFilesTests.swift', 'URLRequest', 'iOS test: builds quire://app/ requests for a stand-in WebKit task, to test the scheme handler; nothing is sent'],
	['packages/ios/DocketeerTests/AppFilesTests.swift', 'a web address', 'iOS test: checks that the scheme handler refuses an https: address'],
	['packages/ios/web/boot.ts', 'dynamic import()', 'iOS: loads the app\'s own renderer from quire://app/renderer.js once window.quire is in place (the CSP allows scripts only from quire:)'],
	['packages/app/src/renderer/smoke.ts', 'fetch()', 'smoke test: checks that a request from the page is refused'],
	['packages/app/src/main/main.ts', 'fetch()', 'smoke test: checks that a request from the main process is refused'],
	['packages/app/dist/main.cjs', 'fetch()', 'built from main.ts (see above)'],
	['packages/app/dist/renderer/renderer.js', 'fetch()', 'built from smoke.ts (see above)'],
	['packages/app/dist/renderer/renderer.js', 'dynamic import()', 'built from app.ts (see above)'],
	// The PDF viewer (pdf.js), in a module of its own. The document is handed over as bytes and fonts and
	// character maps come through pdf:asset (an IPC that reads only files shipped with the app), so pdf.js's
	// URL loaders are never called; if they were, connect-src 'none' and the main process's block stop them.
	['packages/app/src/renderer/pdf/engine.ts', 'fetch()', 'the asset factory pdf.js calls is a method named fetch: it reads app files through pdf:asset'],
	['packages/app/src/renderer/pdf/view.ts', 'dynamic import()', 'loads the app\'s own PDF engine from quire://app/pdf/engine.js (the CSP allows scripts only from quire:)'],
	['packages/app/dist/renderer/pdf/engine.js', 'fetch()', 'pdf.js: URL loaders it is never given a URL for, and xref.fetch (an object lookup inside the PDF)'],
	['packages/app/dist/renderer/pdf/engine.js', 'XMLHttpRequest', 'pdf.js: URL loaders it is never given a URL for (see above)'],
	['packages/app/dist/renderer/pdf/engine.js', 'dynamic import()', 'pdf.js: imports its JPEG 2000 and JBIG2 decoders from quire://app/pdf/wasm/; its worker loaders are unused (it runs without a worker)'],
];

function stripComments(code) {
	let out = '';
	for (let i = 0; i < code.length; i++) {
		const ch = code[i];
		const next = code[i + 1];
		if (ch === '"' || ch === "'" || ch === '`') {
			let j = i + 1;
			while (j < code.length && code[j] !== ch) j += code[j] === '\\' ? 2 : 1;
			out += code.slice(i, j + 1);
			i = j;
		} else if (ch === '/' && next === '/') {
			while (i < code.length && code[i] !== '\n') i++;
			out += '\n';
		} else if (ch === '/' && next === '*') {
			const end = code.indexOf('*/', i + 2);
			out += code.slice(i, end === -1 ? code.length : end + 2).replace(/[^\n]/g, ' ');
			i = end === -1 ? code.length : end + 1;
		} else {
			out += ch;
		}
	}
	return out;
}

function walk(dir, exts, found = [], skip = []) {
	if (!existsSync(dir)) return found;
	for (const name of readdirSync(dir)) {
		if (name === 'node_modules' || name.startsWith('.') || skip.includes(name)) continue;
		const path = join(dir, name);
		if (statSync(path).isDirectory()) walk(path, exts, found, skip);
		else if (exts.some((e) => name.endsWith(e)) && !name.endsWith('.d.ts') && !name.endsWith('.map')) found.push(path);
	}
	return found;
}

const problems = [];
const used = new Set();
/** Report each line that breaks a rule into `sink`, unless ALLOWED lists it (`allow` false: report everything). */
function check(path, text, rules, sink = problems, allow = true) {
	const rel = relative(ROOT, path);
	const lines = text.split('\n');
	for (const [regex, label] of rules) {
		for (let i = 0; i < lines.length; i++) {
			if (!regex.test(lines[i])) continue;
			const allowed = allow ? ALLOWED.findIndex(([f, l]) => f === rel && l === label) : -1;
			if (allowed !== -1) { used.add(allowed); continue; }
			sink.push(`${rel}:${i + 1}: ${label}`);
		}
	}
}

// Our source.
const source = [...walk(join(ROOT, 'packages/api/src'), ['.ts']), ...walk(join(ROOT, 'packages/app/src'), ['.ts']), ...walk(join(ROOT, 'packages/ios/web'), ['.ts'])];
for (const f of source) check(f, stripComments(readFileSync(f, 'utf8')), [...CODE_RULES, ...SOURCE_ONLY_RULES]);
for (const f of walk(join(ROOT, 'packages/app/src'), ['.css'])) check(f, readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, ''), CSS_RULES);

// The iOS shell: Swift (not the built page in Resources/ or Xcode's build/), Info.plist and the Xcode project.

/** Swift packages the shell may use. Empty: none so far. */
const SWIFT_PACKAGES = [];

/** Audit an iOS shell: `pkg` holds the app folder `Docketeer/` and `DocketeerTests/`. Returns the Swift files seen. */
function auditIos(pkg, sink = problems, allow = true) {
	const appDir = join(pkg, 'Docketeer');
	const swiftFiles = [...walk(appDir, ['.swift'], [], ['Resources', 'build']), ...walk(join(pkg, 'DocketeerTests'), ['.swift'])];
	for (const f of swiftFiles) check(f, stripComments(readFileSync(f, 'utf8')), SWIFT_RULES, sink, allow);
	for (const f of walk(appDir, ['.plist'], [], ['Resources', 'build'])) {
		if (/NSAppTransportSecurity|NSAllows\w*Loads|NSExceptionDomains/.test(readFileSync(f, 'utf8'))) sink.push(`${relative(ROOT, f)}: App Transport Security exceptions are not allowed`);
	}
	for (const f of walk(appDir, ['.pbxproj'], [], ['Resources', 'build'])) {
		const text = readFileSync(f, 'utf8');
		for (const m of text.matchAll(/repositoryURL = "?([^";]+)/g)) {
			if (!SWIFT_PACKAGES.includes(m[1])) sink.push(`${relative(ROOT, f)}: Swift package ${m[1]} is not on the allow-list`);
		}
		if (/XC(Local|Remote)SwiftPackageReference/.test(text) && !SWIFT_PACKAGES.length) sink.push(`${relative(ROOT, f)}: Swift packages are not allowed`);
	}
	for (const pod of ['Podfile', 'Cartfile', 'Package.swift']) {
		for (const dir of [pkg, appDir]) if (existsSync(join(dir, pod))) sink.push(`${relative(ROOT, join(dir, pod))}: dependency managers are not allowed`);
	}
	return swiftFiles;
}
const swift = auditIos(join(ROOT, 'packages/ios'));

// The rules themselves: a planted shell (scripts/offline-audit-fixtures/ios) breaks each once, and each must fire.
{
	const fixtures = join(ROOT, 'scripts/offline-audit-fixtures/ios');
	const found = [];
	auditIos(fixtures, found, false);
	const expected = [
		...SWIFT_RULES.map(([, label]) => `: ${label}`),
		'App Transport Security exceptions are not allowed', 'is not on the allow-list', 'Swift packages are not allowed',
		'Podfile: dependency managers are not allowed',
	];
	for (const e of expected) if (!found.some((p) => p.includes(e))) problems.push(`scripts/offline-audit-fixtures/ios: the rule for "${e.replace(/^: /, '')}" did not fire on its fixture`);
	const quiet = found.filter((p) => p.includes('Quiet.swift'));
	if (quiet.length) problems.push(`scripts/offline-audit-fixtures/ios: rules fired on code that is allowed: ${quiet.join('; ')}`);
}

// The built app (bundled libraries included).
const dist = join(ROOT, 'packages/app/dist');
const built = existsSync(dist);
if (built) {
	for (const f of walk(dist, ['.js', '.cjs', '.mjs'])) {
		if (f.includes(`${join(dist, 'plugins')}`)) continue; // audited with their plugin below
		check(f, stripComments(readFileSync(f, 'utf8')), CODE_RULES);
	}
	for (const f of walk(join(dist, 'renderer'), ['.css'])) check(f, readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, ''), CSS_RULES);
	const csp = readFileSync(join(dist, 'renderer/csp.txt'), 'utf8');
	for (const must of ["connect-src 'none'", "default-src 'none'", "worker-src 'none'", "object-src 'none'"]) {
		if (!csp.includes(must)) problems.push(`packages/app/dist/renderer/csp.txt: missing ${must}`);
	}
	if (/unsafe-eval/.test(csp)) problems.push('packages/app/dist/renderer/csp.txt: allows unsafe-eval');
}

// The PDF engine's allowances above hold only while pdf.js is set up this way.
const engineFile = join(ROOT, 'packages/app/src/renderer/pdf/engine.ts');
if (existsSync(engineFile)) {
	const engine = stripComments(readFileSync(engineFile, 'utf8'));
	for (const must of ['BinaryDataFactory: AppBinaryData', 'useWasm: false', 'useWorkerFetch: false', 'enableXfa: false', 'globalThis as { pdfjsWorker']) {
		if (!engine.includes(must)) problems.push(`packages/app/src/renderer/pdf/engine.ts: pdf.js must be set up with ${must}`);
	}
	if (/getDocument\(\{[^}]*\burl\s*:/s.test(engine)) problems.push('packages/app/src/renderer/pdf/engine.ts: pdf.js must be given bytes, never a URL');
}

// Plugins: their own audit if they have one, otherwise these rules.
const pluginsDir = join(ROOT, 'plugins');
for (const name of existsSync(pluginsDir) ? readdirSync(pluginsDir) : []) {
	const dir = join(pluginsDir, name);
	const own = join(dir, 'scripts/offline-audit.mjs');
	if (existsSync(own)) {
		try {
			execFileSync(process.execPath, [own], { stdio: 'pipe' });
		} catch (e) {
			problems.push(`plugins/${name}: its offline audit failed:\n${e.stdout?.toString() ?? ''}${e.stderr?.toString() ?? ''}`);
		}
	} else {
		for (const f of [...walk(join(dir, 'src'), ['.ts', '.js']), ...['main.js'].map((x) => join(dir, x)).filter(existsSync)]) {
			check(f, stripComments(readFileSync(f, 'utf8')), [...CODE_RULES, ...SOURCE_ONLY_RULES]);
		}
	}
}

ALLOWED.forEach(([file, label], i) => {
	const isDist = file.startsWith('packages/app/dist/');
	if (!used.has(i) && (!isDist || built)) problems.push(`${file}: allowed "${label}" not found (remove it from ALLOWED)`);
});

if (problems.length) {
	console.error('Offline audit failed:');
	for (const p of problems) console.error(`  ${p}`);
	process.exit(1);
}
console.log(`Offline audit passed: ${source.length} source files, ${swift.length} Swift files${built ? ', the built app' : ' (app not built: run npm run build to audit the bundle)'} and ${readdirSync(pluginsDir).length} plugin(s).`);
