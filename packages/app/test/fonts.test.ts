import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { fontFolders, installedFonts, readFontFamilies } from '../src/main/fonts';

/** A minimal TrueType file: a `name` table with the given names (Windows, UTF-16BE) and a `post` table. */
function fakeFont(names: [id: number, text: string][], mono: boolean, platform = 3): Buffer {
	const strings = Buffer.concat(names.map(([, t]) => (platform === 1 ? Buffer.from(t, 'latin1') : Buffer.from(t, 'utf16le').swap16())));
	const name = Buffer.alloc(6 + names.length * 12);
	name.writeUInt16BE(0, 0); name.writeUInt16BE(names.length, 2); name.writeUInt16BE(name.length, 4);
	let off = 0;
	names.forEach(([id, t], i) => {
		const len = platform === 1 ? t.length : t.length * 2;
		const r = 6 + i * 12;
		name.writeUInt16BE(platform, r); name.writeUInt16BE(1, r + 2); name.writeUInt16BE(platform === 3 ? 0x409 : 0, r + 4);
		name.writeUInt16BE(id, r + 6); name.writeUInt16BE(len, r + 8); name.writeUInt16BE(off, r + 10);
		off += len;
	});
	const nameTable = Buffer.concat([name, strings]);
	const post = Buffer.alloc(32);
	post.writeUInt32BE(0x00030000, 0);
	post.writeUInt32BE(mono ? 1 : 0, 12);
	const head = Buffer.alloc(12 + 2 * 16);
	head.writeUInt32BE(0x00010000, 0);
	head.writeUInt16BE(2, 4);
	const nameAt = head.length;
	const postAt = nameAt + nameTable.length;
	head.write('name', 12, 'latin1'); head.writeUInt32BE(nameAt, 20); head.writeUInt32BE(nameTable.length, 24);
	head.write('post', 28, 'latin1'); head.writeUInt32BE(postAt, 36); head.writeUInt32BE(post.length, 40);
	return Buffer.concat([head, nameTable, post]);
}

const reader = (buf: Buffer) => async (offset: number, length: number) => buf.subarray(offset, offset + length);
const tmp = mkdtempSync(join(tmpdir(), 'quire-fonts-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe('font names', () => {
	it('reads the family name and whether it is monospaced', async () => {
		expect(await readFontFamilies(reader(fakeFont([[1, 'Inter']], false)))).toEqual([{ family: 'Inter', mono: false }]);
		expect(await readFontFamilies(reader(fakeFont([[1, 'JetBrains Mono']], true)))).toEqual([{ family: 'JetBrains Mono', mono: true }]);
	});
	it('also takes coding fonts that do not say so as monospaced, and not emoji fonts that do', async () => {
		expect((await readFontFamilies(reader(fakeFont([[1, 'JetBrainsMono Nerd Font']], false))))[0]!.mono).toBe(true);
		expect((await readFontFamilies(reader(fakeFont([[1, 'Noto Color Emoji']], true))))[0]!.mono).toBe(false);
		expect((await readFontFamilies(reader(fakeFont([[1, 'Monotype Corsiva']], false))))[0]!.mono).toBe(false);
		expect((await readFontFamilies(reader(fakeFont([[1, 'Encode Sans']], false))))[0]!.mono).toBe(false);
		expect((await readFontFamilies(reader(fakeFont([[1, 'Cascadia Code']], false))))[0]!.mono).toBe(true);
	});
	it('prefers the typographic family to the style-specific family', async () => {
		expect((await readFontFamilies(reader(fakeFont([[1, 'Source Serif 4 Semibold'], [16, 'Source Serif 4']], false))))[0]!.family).toBe('Source Serif 4');
	});
	it('reads Mac Roman names, and ignores what is not a font', async () => {
		expect((await readFontFamilies(reader(fakeFont([[1, 'Old Mac Font']], false, 1))))[0]!.family).toBe('Old Mac Font');
		expect(await readFontFamilies(reader(Buffer.from('not a font at all')))).toEqual([]);
		expect(await readFontFamilies(reader(Buffer.alloc(3)))).toEqual([]);
	});
	it('lists installed families once each, A–Z, from the font folders', async () => {
		mkdirSync(join(tmp, 'a', 'deeper'), { recursive: true });
		writeFileSync(join(tmp, 'a', 'Inter-Regular.ttf'), fakeFont([[1, 'Inter']], false));
		writeFileSync(join(tmp, 'a', 'deeper', 'Inter-Bold.ttf'), fakeFont([[1, 'Inter']], false));
		writeFileSync(join(tmp, 'a', 'Mono.otf'), fakeFont([[1, 'Fira Code']], true));
		writeFileSync(join(tmp, 'a', 'readme.txt'), 'x');
		writeFileSync(join(tmp, 'a', 'Broken.ttf'), 'nope');
		expect(await installedFonts([join(tmp, 'a'), join(tmp, 'missing')])).toEqual([{ family: 'Fira Code', mono: true }, { family: 'Inter', mono: false }]);
	});
	it('knows where each system keeps its fonts', () => {
		expect(fontFolders('linux', '/home/x')).toContain('/home/x/.local/share/fonts');
		expect(fontFolders('darwin', '/Users/x')).toContain('/Users/x/Library/Fonts');
		expect(fontFolders('win32', 'C:\\Users\\x', { WINDIR: 'C:\\Windows' })[0]).toContain('Fonts');
	});
});
