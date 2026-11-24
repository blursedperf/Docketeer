/**
 * Quire main process: windows, homebase file access (refused outside the homebase), file watching, and the
 * offline guarantees — every network request is cancelled, navigation and new windows are refused, and
 * no permission is ever granted.
 */
import { BrowserWindow, app, dialog, ipcMain, protocol, session, shell, clipboard, type WebContents } from 'electron';
import { existsSync, watch, type FSWatcher } from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

const APP_DIR = __dirname; // dist/
const RENDERER_DIR = path.join(APP_DIR, 'renderer');
const BUILTIN_PLUGINS = path.join(APP_DIR, 'plugins');
const SHOTS = process.argv.includes('--shots');
const SMOKE = process.argv.includes('--smoke') || SHOTS;
const ALLOWED_SCHEMES = ['quire:', 'devtools:', 'data:', 'blob:', 'chrome-extension:'];

// -------------------------------------------------------------------------------------------------
// Offline: switch off Chromium's background traffic before anything starts.

for (const sw of [
	'disable-background-networking', 'disable-component-update', 'disable-domain-reliability', 'disable-sync',
	'no-pings', 'disable-breakpad', 'disable-client-side-phishing-detection', 'disable-default-apps',
	'metrics-recording-only', 'no-default-browser-check', 'dns-prefetch-disable',
]) app.commandLine.appendSwitch(sw);
app.commandLine.appendSwitch('disable-features', 'AutofillServerCommunication,MediaRouter,OptimizationHints,Translate,InterestFeedContentSuggestions,CertificateTransparencyComponentUpdater,NetworkTimeServiceQuerying');
// Proxy auto-detection would otherwise probe the network.
app.commandLine.appendSwitch('no-proxy-server');
if (SMOKE) app.commandLine.appendSwitch('ozone-platform', 'headless');

protocol.registerSchemesAsPrivileged([
	{ scheme: 'quire', privileges: { standard: true, secure: true, supportFetchAPI: false, corsEnabled: false, stream: true, codeCache: true } },
]);

// -------------------------------------------------------------------------------------------------
// App settings (outside any vault): recent vaults.

interface Recent { path: string; name: string; time: number; }
interface MainConfig { recent: Recent[]; last: string | null; [key: string]: unknown; }

const configFile = () => path.join(app.getPath('userData'), 'quire.json');
let config: MainConfig = { recent: [], last: null };

async function loadConfig() {
	try { config = { recent: [], last: null, ...JSON.parse(await fsp.readFile(configFile(), 'utf8')) }; } catch { /* first run */ }
}

async function saveConfig() {
	await fsp.mkdir(path.dirname(configFile()), { recursive: true });
	await fsp.writeFile(configFile(), JSON.stringify(config, null, '\t'));
}

// -------------------------------------------------------------------------------------------------
// The vault: every path from the renderer is relative to it, and checked.

let vaultRoot: string | null = null;
let vaultReal: string | null = null;
let watcher: FSWatcher | null = null;
let win: BrowserWindow | null = null;

function inside(root: string, p: string): boolean {
	return p === root || p.startsWith(root + path.sep);
}

/** Absolute path of a vault path, refused if it leaves the vault (also through symlinks). */
async function resolvePath(rel: unknown): Promise<string> {
	if (!vaultRoot || !vaultReal) throw new Error('No vault is open');
	if (typeof rel !== 'string' || rel.includes('\0')) throw new Error('Invalid path');
	const abs = path.resolve(vaultRoot, rel.replace(/^[/\\]+/, ''));
	if (!inside(vaultRoot, abs)) throw new Error(`Path outside the homebase: ${rel}`);
	// The nearest existing ancestor must really be inside the vault.
	let probe = abs;
	while (!existsSync(probe) && probe !== vaultRoot) probe = path.dirname(probe);
	const real = await fsp.realpath(probe);
	if (!inside(vaultReal, real)) throw new Error(`Path outside the homebase: ${rel}`);
	return abs;
}

function toRel(abs: string): string {
	return path.relative(vaultRoot!, abs).split(path.sep).join('/');
}

interface Stat { type: 'file' | 'folder'; size: number; mtime: number; ctime: number; }

async function statOf(abs: string): Promise<Stat | null> {
	try {
		const s = await fsp.stat(abs);
		return { type: s.isDirectory() ? 'folder' : 'file', size: s.size, mtime: Math.round(s.mtimeMs), ctime: Math.round(s.birthtimeMs || s.ctimeMs) };
	} catch {
		return null;
	}
}

async function tree(absDir: string, out: (Stat & { path: string })[] = []): Promise<(Stat & { path: string })[]> {
	let entries;
	try { entries = await fsp.readdir(absDir, { withFileTypes: true }); } catch { return out; }
	for (const e of entries) {
		if (e.name.startsWith('.') || e.isSymbolicLink()) continue;
		const abs = path.join(absDir, e.name);
		const st = await statOf(abs);
		if (!st) continue;
		out.push({ path: toRel(abs), ...st });
		if (st.type === 'folder') await tree(abs, out);
	}
	return out;
}

async function atomicWrite(abs: string, data: string | Buffer, append = false) {
	await fsp.mkdir(path.dirname(abs), { recursive: true });
	if (append) {
		await fsp.appendFile(abs, data);
	} else {
		const tmp = path.join(path.dirname(abs), `.${path.basename(abs)}.${process.pid}.quire-tmp`);
		await fsp.writeFile(tmp, data);
		await fsp.rename(tmp, abs);
	}
	return (await statOf(abs))!;
}

function startWatching() {
	watcher?.close();
	watcher = null;
	if (!vaultRoot) return;
	const root = vaultRoot;
	const pending = new Set<string>();
	let timer: NodeJS.Timeout | null = null;
	const flush = async () => {
		timer = null;
		const paths = [...pending];
		pending.clear();
		const events = [];
		for (const rel of paths) events.push({ path: rel, stat: await statOf(path.join(root, rel)) });
		if (events.length && win && !win.isDestroyed()) win.webContents.send('fs:events', events);
	};
	try {
		watcher = watch(root, { recursive: true }, (_type, filename) => {
			if (!filename) return;
			const rel = filename.toString().split(path.sep).join('/');
			if (rel.split('/').some((s) => s.startsWith('.'))) return;
			pending.add(rel);
			if (!timer) timer = setTimeout(() => { void flush(); }, 150);
		});
		watcher.on('error', (e) => console.error('Watcher error', e));
	} catch (e) {
		console.error('Could not watch the homebase', e);
	}
}

async function setVault(p: string | null) {
	if (p && !(await statOf(p))?.type) p = null;
	vaultRoot = p ? path.resolve(p) : null;
	vaultReal = vaultRoot ? await fsp.realpath(vaultRoot) : null;
	if (vaultRoot) {
		config.last = vaultRoot;
		config.recent = [{ path: vaultRoot, name: path.basename(vaultRoot), time: Date.now() }, ...config.recent.filter((r) => r.path !== vaultRoot)].slice(0, 12);
		if (!SMOKE) await saveConfig();
	}
	startWatching();
}

// -------------------------------------------------------------------------------------------------
// IPC

function handle(channel: string, fn: (...args: any[]) => unknown) {
	ipcMain.handle(channel, async (event, ...args) => {
		if (!win || event.sender !== win.webContents) throw new Error('Unknown sender');
		return fn(...args);
	});
}

function registerIpc() {
	ipcMain.on('host:info', (e) => {
		e.returnValue = {
			platform: process.platform,
			appVersion: app.getVersion(),
			vault: vaultRoot ? { path: vaultRoot, name: path.basename(vaultRoot) } : null,
			isSmoke: SMOKE,
			isShots: SHOTS,
		};
	});
	handle('fs:tree', async (rel: string) => tree(await resolvePath(rel)));
	handle('fs:stat', async (rel: string) => statOf(await resolvePath(rel)));
	handle('fs:exists', async (rel: string) => existsSync(await resolvePath(rel)));
	handle('fs:read', async (rel: string) => fsp.readFile(await resolvePath(rel), 'utf8'));
	handle('fs:readBinary', async (rel: string) => new Uint8Array(await fsp.readFile(await resolvePath(rel))));
	handle('fs:write', async (rel: string, data: string) => atomicWrite(await resolvePath(rel), String(data)));
	handle('fs:writeBinary', async (rel: string, data: Uint8Array) => atomicWrite(await resolvePath(rel), Buffer.from(data)));
	handle('fs:append', async (rel: string, data: string) => atomicWrite(await resolvePath(rel), String(data), true));
	handle('fs:mkdir', async (rel: string) => { await fsp.mkdir(await resolvePath(rel), { recursive: true }); });
	handle('fs:list', async (rel: string) => {
		const abs = await resolvePath(rel);
		const files: string[] = [];
		const folders: string[] = [];
		for (const e of await fsp.readdir(abs, { withFileTypes: true })) {
			const r = toRel(path.join(abs, e.name));
			(e.isDirectory() ? folders : files).push(r);
		}
		return { files, folders };
	});
	handle('fs:remove', async (rel: string) => { await fsp.unlink(await resolvePath(rel)); });
	handle('fs:rmdir', async (rel: string, recursive: boolean) => {
		const abs = await resolvePath(rel);
		if (abs === vaultRoot) throw new Error('Cannot remove the homebase');
		await fsp.rm(abs, { recursive: !!recursive });
	});
	handle('fs:rename', async (from: string, to: string) => {
		const a = await resolvePath(from);
		const b = await resolvePath(to);
		await fsp.mkdir(path.dirname(b), { recursive: true });
		await fsp.rename(a, b);
	});
	handle('fs:copy', async (from: string, to: string) => {
		const b = await resolvePath(to);
		await fsp.mkdir(path.dirname(b), { recursive: true });
		await fsp.copyFile(await resolvePath(from), b);
	});
	handle('fs:trash', async (rel: string) => {
		const abs = await resolvePath(rel);
		if (abs === vaultRoot) throw new Error('Cannot remove the homebase');
		try { await shell.trashItem(abs); return true; } catch { return false; }
	});

	handle('plugins:list', async () => {
		const out: unknown[] = [];
		const scan = async (dir: string, source: 'builtin' | 'vault') => {
			let names: string[] = [];
			try { names = await fsp.readdir(dir); } catch { return; }
			for (const name of names) {
				const d = path.join(dir, name);
				try {
					const manifest = JSON.parse(await fsp.readFile(path.join(d, 'manifest.json'), 'utf8'));
					if (!existsSync(path.join(d, 'main.js')) || typeof manifest.id !== 'string') continue;
					if (out.some((p) => (p as { manifest: { id: string } }).manifest.id === manifest.id)) continue;
					out.push({ manifest, source, hasStyles: existsSync(path.join(d, 'styles.css')) });
				} catch { /* not a plugin */ }
			}
		};
		await scan(BUILTIN_PLUGINS, 'builtin');
		if (vaultRoot) await scan(path.join(vaultRoot, '.quire', 'plugins'), 'vault');
		return out;
	});

	handle('app:getConfig', () => config);
	handle('app:setConfig', async (patch: Record<string, unknown>) => { Object.assign(config, patch); await saveConfig(); });
	handle('app:recent', () => config.recent.filter((r) => existsSync(r.path)));
	handle('app:chooseVault', async (create: boolean) => {
		const r = await dialog.showOpenDialog(win!, { title: create ? 'Create a homebase in a folder' : 'Open a folder as a homebase', properties: ['openDirectory', 'createDirectory'] });
		const p = r.filePaths[0];
		if (r.canceled || !p) return false;
		await openVaultAndReload(p);
		return true;
	});
	handle('app:openVault', async (p: string) => {
		if (!(await statOf(p))) return false;
		await openVaultAndReload(p);
		return true;
	});
	handle('app:showItemInFolder', async (rel: string) => { shell.showItemInFolder(await resolvePath(rel)); });
	handle('clipboard:writeText', (text: string) => { clipboard.writeText(String(text)); });
	handle('clipboard:readText', () => clipboard.readText());
	// Spelling dictionaries shipped with the app (read on demand; only these languages).
	handle('spell:dictionary', async (lang: string) => {
		if (!['en-AU', 'en-GB', 'en-US'].includes(lang)) return null;
		const dir = path.join(APP_DIR, 'dictionaries', lang);
		try {
			return { aff: await fsp.readFile(path.join(dir, 'index.aff'), 'utf8'), dic: await fsp.readFile(path.join(dir, 'index.dic'), 'utf8') };
		} catch {
			return null;
		}
	});
	handle('app:notices', () => fsp.readFile(path.join(APP_DIR, 'THIRD_PARTY_NOTICES.txt'), 'utf8').catch(() => ''));
	ipcMain.on('smoke:report', (_e, report) => { void finishSmoke(report); });
	// Screenshot mode: the renderer asks for a capture of the window as it is now.
	ipcMain.handle('smoke:capture', async (_e, name: string) => {
		if (!SMOKE || !win || !/^[a-z0-9-]+$/.test(name)) return null;
		const dir = process.env.QUIRE_SMOKE_OUT ?? os.tmpdir();
		await fsp.mkdir(dir, { recursive: true });
		const file = path.join(dir, `${name}.png`);
		await fsp.writeFile(file, (await captureFrame()).toPNG());
		return file;
	});
}

async function openVaultAndReload(p: string) {
	if (win) await beforeQuit(win.webContents);
	await setVault(p);
	win?.webContents.reload();
}

// -------------------------------------------------------------------------------------------------
// Serving the app, plugins and vault images over quire://app/

const MIME: Record<string, string> = {
	'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
	'.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp',
	'.avif': 'image/avif', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf',
};

let csp = '';

async function serve(abs: string, extraHeaders: Record<string, string> = {}): Promise<Response> {
	try {
		const data = await fsp.readFile(abs);
		const type = MIME[path.extname(abs).toLowerCase()] ?? 'application/octet-stream';
		return new Response(data, { headers: { 'content-type': type, 'x-content-type-options': 'nosniff', 'cache-control': 'no-store', ...extraHeaders } });
	} catch {
		return new Response('Not found', { status: 404 });
	}
}

function registerProtocol() {
	protocol.handle('quire', async (req) => {
		const url = new URL(req.url);
		if (url.host !== 'app') return new Response('Not found', { status: 404 });
		const parts = url.pathname.split('/').filter(Boolean).map((s) => decodeURIComponent(s));
		if (parts.some((p) => p === '..' || p.includes('\0'))) return new Response('Forbidden', { status: 403 });
		if (parts.length === 0 || parts[0] === 'index.html') {
			return serve(path.join(RENDERER_DIR, 'index.html'), { 'content-security-policy': csp });
		}
		if (parts[0] === 'plugins' && parts.length === 3) {
			const [, id, file] = parts as [string, string, string];
			if (!['main.js', 'styles.css', 'manifest.json'].includes(file) || !/^[a-z0-9][a-z0-9_.-]*$/i.test(id)) return new Response('Forbidden', { status: 403 });
			const builtin = path.join(BUILTIN_PLUGINS, id, file);
			if (existsSync(builtin)) return serve(builtin);
			if (vaultRoot) {
				const abs = await resolvePath(`.quire/plugins/${id}/${file}`).catch(() => null);
				if (abs) return serve(abs);
			}
			return new Response('Not found', { status: 404 });
		}
		if (parts[0] === 'vault') {
			const rel = parts.slice(1).join('/');
			if (!MIME[path.extname(rel).toLowerCase()]?.startsWith('image/')) return new Response('Forbidden', { status: 403 });
			const abs = await resolvePath(rel).catch(() => null);
			return abs ? serve(abs) : new Response('Not found', { status: 404 });
		}
		const abs = path.join(RENDERER_DIR, ...parts);
		if (!inside(RENDERER_DIR, abs)) return new Response('Forbidden', { status: 403 });
		return serve(abs);
	});
}

// -------------------------------------------------------------------------------------------------
// Lockdown

let blocked: string[] = [];

function lockDown() {
	const ses = session.defaultSession;
	ses.webRequest.onBeforeRequest((details, cb) => {
		const ok = ALLOWED_SCHEMES.some((s) => details.url.startsWith(s));
		if (!ok) {
			blocked.push(details.url);
			console.warn(`Blocked network request: ${details.url}`);
		}
		cb({ cancel: !ok });
	});
	ses.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
	ses.setPermissionCheckHandler(() => false);
	// Electron downloads spelling dictionaries from the web; turn spellcheck off rather than go online.
	ses.setSpellCheckerEnabled(false);
	ses.setSpellCheckerDictionaryDownloadURL('quire://app/no-dictionaries/');
	ses.on('will-download', (e) => e.preventDefault());

	app.on('web-contents-created', (_e, contents) => {
		contents.setWindowOpenHandler(() => ({ action: 'deny' }));
		contents.on('will-navigate', (e, url) => { if (!url.startsWith('quire://app/')) e.preventDefault(); });
		contents.on('will-redirect', (e, url) => { if (!url.startsWith('quire://app/')) e.preventDefault(); });
		contents.on('will-attach-webview', (e) => e.preventDefault());
	});
}

// -------------------------------------------------------------------------------------------------
// Closing: let the renderer save open notes first.

let quitting = false;

function beforeQuit(contents: WebContents): Promise<void> {
	return new Promise((resolve) => {
		const token = Math.random().toString(36).slice(2);
		const done = (_e: unknown, t: string) => {
			if (t !== token) return;
			ipcMain.removeListener('app:quit-ready', done);
			clearTimeout(timer);
			resolve();
		};
		const timer = setTimeout(() => { ipcMain.removeListener('app:quit-ready', done); resolve(); }, 4000);
		ipcMain.on('app:quit-ready', done);
		contents.send('app:before-quit', token);
	});
}

function createWindow() {
	win = new BrowserWindow({
		width: 1280,
		height: 860,
		minWidth: 640,
		minHeight: 400,
		show: false,
		title: 'Quire',
		backgroundColor: '#1e1e1e',
		autoHideMenuBar: true,
		paintWhenInitiallyHidden: true,
		webPreferences: {
			preload: path.join(APP_DIR, 'preload.cjs'),
			contextIsolation: true,
			sandbox: true,
			nodeIntegration: false,
			webSecurity: true,
			spellcheck: false,
			devTools: !SMOKE,
			offscreen: SMOKE,
		},
	});
	win.setMenuBarVisibility(false);
	win.once('ready-to-show', () => { if (!SMOKE) win?.show(); });
	win.on('close', (e) => {
		if (quitting || !win) return;
		e.preventDefault();
		void beforeQuit(win.webContents).then(() => { quitting = true; win?.close(); });
	});
	win.on('closed', () => { win = null; });
	win.webContents.on('before-input-event', (e, input) => {
		// F12 / Ctrl+Shift+I open developer tools (useful for plugin authors).
		if (input.type === 'keyDown' && (input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i'))) {
			win?.webContents.toggleDevTools();
			e.preventDefault();
		}
	});
	if (SMOKE) {
		win.webContents.setFrameRate(30);
		win.webContents.on('paint', (_e, _dirty, image) => {
			if (image.isEmpty()) return;
			lastFrame = image;
			const waiting = frameWaiters;
			frameWaiters = [];
			for (const w of waiting) w(image);
		});
		win.webContents.on('console-message', (event) => {
			const { level, message } = event as unknown as { level: string; message: string };
			smokeConsole.push({ level, message });
		});
	}
	void win.loadURL('quire://app/index.html');
}

// -------------------------------------------------------------------------------------------------
// Smoke test: boot offscreen on a copy of a test vault, let the renderer run its checks, then exit.

const smokeConsole: { level: string; message: string }[] = [];

async function finishSmoke(report: Record<string, unknown>) {
	let exitCode = report.ok ? 0 : 1;
	try {
		// The main process tries the network itself, through the same session: it must be refused.
		let mainFetchBlocked = false;
		try { await session.defaultSession.fetch('https://example.com/'); } catch { mainFetchBlocked = true; }
		// The screenshot is for review, not a check: a capture that fails (some CI GPUs) is reported only.
		let shot: string | null = path.join(process.env.QUIRE_SMOKE_OUT ?? os.tmpdir(), 'quire-smoke.png');
		let screenshotError: string | null = null;
		try {
			if (win) await fsp.writeFile(shot, (await captureFrame()).toPNG());
		} catch (e) {
			screenshotError = e instanceof Error ? e.message : String(e);
			shot = null;
		}
		const errors = smokeConsole.filter((m) => m.level === 'error' || m.level === '3');
		const out = { ...report, mainFetchBlocked, blockedRequests: blocked, consoleErrors: errors.map((m) => m.message), screenshot: shot, screenshotError };
		if (!mainFetchBlocked) exitCode = 1;
		console.log(`QUIRE_SMOKE ${JSON.stringify(out, null, 2)}`);
	} catch (e) {
		console.error(e);
		exitCode = 1;
	}
	quitting = true;
	app.exit(exitCode);
}

/**
 * The window as it is now. Offscreen windows deliver their frames through 'paint'; asking for a fresh
 * one works on CI machines where capturePage() fails (UnknownVizError on GitHub's Ubuntu runners).
 */
let lastFrame: Electron.NativeImage | null = null;
let frameWaiters: ((img: Electron.NativeImage) => void)[] = [];
async function captureFrame(): Promise<Electron.NativeImage> {
	if (!win) throw new Error('No window');
	if (!win.webContents.isOffscreen()) return win.webContents.capturePage();
	// Offscreen windows occasionally paint an empty frame; ask again until one has pixels.
	for (let attempt = 0; attempt < 5; attempt++) {
		const fresh = new Promise<Electron.NativeImage>((resolve) => frameWaiters.push(resolve));
		win.webContents.invalidate();
		const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 2000));
		const img = await Promise.race([fresh, timeout]);
		if (img && !img.isEmpty()) return img;
	}
	if (lastFrame && !lastFrame.isEmpty()) return lastFrame;
	const page = await win.webContents.capturePage();
	if (page.isEmpty()) throw new Error('No frame painted');
	return page;
}

async function smokeVault(): Promise<string> {
	// A fixed homebase name, so screenshots are the same from run to run.
	const dir = path.join(await fsp.mkdtemp(path.join(os.tmpdir(), 'quire-smoke-')), 'Quire demo');
	await fsp.mkdir(dir);
	await fsp.writeFile(path.join(dir, 'Welcome.md'), '# Welcome\n\nA note with a [[Second note]] link.[^1]\n\n[^1]: A footnote.\n');
	await fsp.writeFile(path.join(dir, 'Second note.md'), '---\ntags: [test]\n---\n\n# Second\n\nBack to [[Welcome]].\n');
	await fsp.mkdir(path.join(dir, 'Folder'));
	await fsp.writeFile(path.join(dir, 'Folder', 'Inside.md'), 'Inside a folder.\n');
	return dir;
}

// -------------------------------------------------------------------------------------------------

app.whenReady().then(async () => {
	lockDown();
	registerProtocol();
	registerIpc();
	csp = await fsp.readFile(path.join(RENDERER_DIR, 'csp.txt'), 'utf8').then((s) => s.trim());
	await loadConfig();
	// --homebase=<folder> opens a folder directly (--vault= is accepted too).
	const arg = process.argv.find((a) => /^--(?:homebase|vault)=/.test(a))?.replace(/^--(?:homebase|vault)=/, '');
	if (SMOKE) await setVault(arg ?? (await smokeVault()));
	else await setVault(arg ?? config.last);
	createWindow();
	if (SMOKE) setTimeout(() => { console.error('Smoke test timed out'); app.exit(2); }, 60_000);
}).catch((e) => {
	console.error(e);
	app.exit(1);
});

app.on('window-all-closed', () => app.quit());
