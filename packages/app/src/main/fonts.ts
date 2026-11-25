/**
 * The fonts installed on this computer, by family name, for the font settings. Read from the font folders and from
 * each font file's own tables (TrueType/OpenType `name` for the family, `post` for fixed pitch): no programs are run
 * and nothing is fetched. Only the start of each file and those two tables are read, so large fonts cost little.
 *
 * Kept free of Electron so it can be tested with plain Node.
 */
import type { Dirent } from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

export interface FontFamily { family: string; mono: boolean }

/** The folders fonts are installed in, on this platform. */
export function fontFolders(platform = process.platform, home = os.homedir(), env: NodeJS.ProcessEnv = process.env): string[] {
	if (platform === 'darwin') return ['/System/Library/Fonts', '/Library/Fonts', path.join(home, 'Library/Fonts')];
	if (platform === 'win32') {
		const win = env.WINDIR ?? 'C:\\Windows';
		const local = env.LOCALAPPDATA ?? path.join(home, 'AppData', 'Local');
		return [path.join(win, 'Fonts'), path.join(local, 'Microsoft', 'Windows', 'Fonts')];
	}
	return ['/usr/share/fonts', '/usr/local/share/fonts', path.join(home, '.local/share/fonts'), path.join(home, '.fonts')];
}

/** Read `length` bytes at `offset` (fewer at the end of the file). */
async function readAt(file: fsp.FileHandle, offset: number, length: number): Promise<Buffer> {
	const buf = Buffer.alloc(length);
	const { bytesRead } = await file.read(buf, 0, length, offset);
	return buf.subarray(0, bytesRead);
}

/** Family names (and fixed pitch) of the font(s) in a font file's bytes, as read through `read`. */
export async function readFontFamilies(read: (offset: number, length: number) => Promise<Buffer>): Promise<FontFamily[]> {
	const head = await read(0, 12);
	if (head.length < 12) return [];
	const tag = head.toString('latin1', 0, 4);
	if (tag === 'ttcf') {
		const count = Math.min(head.readUInt32BE(8), 64);
		const offsets = await read(12, count * 4);
		const out: FontFamily[] = [];
		for (let i = 0; i + 4 <= offsets.length; i++) {
			const f = await readOne(read, offsets.readUInt32BE(i * 4));
			if (f) out.push(f);
		}
		return out;
	}
	const f = await readOne(read, 0);
	return f ? [f] : [];
}

async function readOne(read: (offset: number, length: number) => Promise<Buffer>, at: number): Promise<FontFamily | null> {
	const head = await read(at, 12);
	if (head.length < 12) return null;
	const version = head.readUInt32BE(0);
	if (version !== 0x00010000 && head.toString('latin1', 0, 4) !== 'OTTO' && head.toString('latin1', 0, 4) !== 'true') return null;
	const numTables = Math.min(head.readUInt16BE(4), 128);
	const dir = await read(at + 12, numTables * 16);
	const tables = new Map<string, { offset: number; length: number }>();
	for (let i = 0; i + 16 <= dir.length; i += 16) tables.set(dir.toString('latin1', i, i + 4), { offset: dir.readUInt32BE(i + 8), length: dir.readUInt32BE(i + 12) });
	const name = tables.get('name');
	if (!name || name.length < 6) return null;
	const nt = await read(name.offset, Math.min(name.length, 65536));
	if (nt.length < 6) return null;
	const count = nt.readUInt16BE(2);
	const strings = nt.readUInt16BE(4);
	// Prefer the typographic family (16) over the family (1); Windows Unicode English, then any Windows, then Mac Roman.
	let best: { score: number; text: string } | null = null;
	for (let i = 0; i < count; i++) {
		const r = 6 + i * 12;
		if (r + 12 > nt.length) break;
		const platform = nt.readUInt16BE(r);
		const lang = nt.readUInt16BE(r + 4);
		const id = nt.readUInt16BE(r + 6);
		const len = nt.readUInt16BE(r + 8);
		const off = strings + nt.readUInt16BE(r + 10);
		if ((id !== 1 && id !== 16) || off + len > nt.length) continue;
		let text: string;
		if (platform === 3 || platform === 0) {
			const raw = nt.subarray(off, off + len);
			const swapped = Buffer.from(raw);
			swapped.swap16();
			text = swapped.toString('utf16le');
		} else if (platform === 1) text = nt.toString('latin1', off, off + len);
		else continue;
		text = text.replace(/\0/g, '').trim();
		if (!text) continue;
		const score = (id === 16 ? 10 : 0) + (platform === 3 ? (lang === 0x409 ? 3 : 2) : platform === 0 ? 2 : 1);
		if (!best || score > best.score) best = { score, text };
	}
	if (!best) return null;
	let mono = false;
	const post = tables.get('post');
	if (post && post.length >= 16) {
		const p = await read(post.offset, 16);
		if (p.length >= 16) mono = p.readUInt32BE(12) !== 0;
	}
	// The fixed-pitch flag is not always set (many coding fonts) and sometimes set where it means little (emoji).
	if (/emoji/i.test(best.text)) mono = false;
	else if (MONO_NAME.test(best.text)) mono = true;
	return { family: best.text, mono };
}

/** Names that mean monospaced: "…Mono" (not "Monotype"), Code, Courier, Consolas, Menlo … */
const MONO_NAME = /mono(?![a-z])|\b(code|courier|consol|menlo|fixed|terminal|typewriter)/i;

const FONT_FILE = /\.(ttf|otf|ttc|otc)$/i;

/** Every font file under `dirs` (a few levels deep, at most `limit`). */
async function fontFiles(dirs: string[], limit = 4000): Promise<string[]> {
	const out: string[] = [];
	const walk = async (dir: string, depth: number) => {
		if (out.length >= limit || depth > 4) return;
		let entries: Dirent[];
		try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
		for (const e of entries) {
			if (out.length >= limit) return;
			const p = path.join(dir, e.name);
			if (e.isDirectory()) await walk(p, depth + 1);
			else if (FONT_FILE.test(e.name)) out.push(p);
		}
	};
	for (const d of dirs) await walk(d, 0);
	return out;
}

/** The installed font families, A–Z, each once (monospaced if any of its files is). */
export async function installedFonts(dirs = fontFolders()): Promise<FontFamily[]> {
	const families = new Map<string, boolean>();
	for (const file of await fontFiles(dirs)) {
		let handle: fsp.FileHandle | null = null;
		try {
			handle = await fsp.open(file, 'r');
			const h = handle;
			for (const f of await readFontFamilies((o, l) => readAt(h, o, l))) families.set(f.family, (families.get(f.family) ?? false) || f.mono);
		} catch { /* not a font we can read */ } finally {
			await handle?.close();
		}
	}
	return [...families].map(([family, mono]) => ({ family, mono })).sort((a, b) => a.family.localeCompare(b.family, undefined, { sensitivity: 'base' }));
}

let cached: Promise<FontFamily[]> | null = null;
/** installedFonts(), read once per run. */
export function fontsOnce(): Promise<FontFamily[]> {
	cached ??= installedFonts().catch(() => []);
	return cached;
}
