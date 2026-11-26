import { describe, expect, it } from 'vitest';
import { MemoryFs, normalise } from '../web/memory-fs';

const seeded = () => new MemoryFs([
	{ path: 'Start here.md', data: '# Start' },
	{ path: 'Torts/Negligence/Duty of care.md', data: 'Duty' },
	{ path: 'Torts/lecture.wav', data: new Uint8Array([1, 2, 3]) },
	{ path: '.quire/workspace.json', data: '{}' },
]);

describe('normalise', () => {
	it('gives homebase paths with forward slashes and no leading or trailing slash', () => {
		expect(normalise('/a//b/')).toBe('a/b');
		expect(normalise('a\\b')).toBe('a/b');
		expect(normalise('./a')).toBe('a');
		expect(normalise('')).toBe('');
	});

	it('refuses paths that leave the homebase, and NUL', () => {
		expect(() => normalise('../x')).toThrow(/outside the homebase/);
		expect(() => normalise('a/../../x')).toThrow(/outside the homebase/);
		expect(() => normalise('a\0b')).toThrow(/Invalid path/);
	});
});

describe('MemoryFs', () => {
	it('lists the tree without hidden names, as the desktop does, and makes the folders a file needs', async () => {
		const paths = (await seeded().tree('')).map((e) => `${e.type === 'folder' ? 'd' : 'f'} ${e.path}`);
		expect(paths).toEqual(['f Start here.md', 'd Torts', 'd Torts/Negligence', 'f Torts/Negligence/Duty of care.md', 'f Torts/lecture.wav']);
		expect((await seeded().tree('Torts/Negligence')).map((e) => e.path)).toEqual(['Torts/Negligence/Duty of care.md']);
		expect(await seeded().tree('nowhere')).toEqual([]);
	});

	it('lists a folder\'s children with hidden names, and refuses a missing folder', async () => {
		expect(await seeded().list('')).toEqual({ files: ['Start here.md'], folders: ['.quire', 'Torts'] });
		await expect(seeded().list('nowhere')).rejects.toMatchObject({ code: 'ENOENT' });
	});

	it('reads, writes, appends and stats text and bytes', async () => {
		let t = 1000;
		const fs = new MemoryFs([], () => t);
		const st = await fs.write('a/b.md', 'héllo');
		expect(st).toEqual({ type: 'file', size: 6, mtime: 1000, ctime: 1000 });
		t = 2000;
		expect(await fs.append('a/b.md', '!')).toMatchObject({ size: 7, mtime: 2000, ctime: 1000 });
		expect(await fs.read('a/b.md')).toBe('héllo!');
		expect((await fs.stat('a'))?.type).toBe('folder');
		await fs.writeBinary('x.bin', new Uint8Array([9, 8]).buffer);
		expect([...new Uint8Array(await fs.readBinary('x.bin'))]).toEqual([9, 8]);
		expect(await fs.stat('nope')).toBeNull();
		await expect(fs.read('nope')).rejects.toMatchObject({ code: 'ENOENT' });
		await expect(fs.read('a')).rejects.toMatchObject({ code: 'EISDIR' });
	});

	it('keeps what it hands out separate from what it holds', async () => {
		const fs = seeded();
		const buf = await fs.readBinary('Torts/lecture.wav');
		new Uint8Array(buf)[0] = 99;
		expect(new Uint8Array(await fs.readBinary('Torts/lecture.wav'))[0]).toBe(1);
	});

	it('renames files and whole folders, and refuses moving a folder into itself', async () => {
		const fs = seeded();
		await fs.rename('Torts', 'Law/Torts');
		expect(await fs.exists('Torts')).toBe(false);
		expect(await fs.read('Law/Torts/Negligence/Duty of care.md')).toBe('Duty');
		await fs.rename('Start here.md', 'Law/Start.md');
		expect(await fs.read('Law/Start.md')).toBe('# Start');
		await expect(fs.rename('Law', 'Law/Inner')).rejects.toThrow(/into itself/);
		await expect(fs.rename('nope', 'x')).rejects.toMatchObject({ code: 'ENOENT' });
	});

	it('copies files, removes them, and removes folders only when asked to go deep', async () => {
		const fs = seeded();
		await fs.copy('Start here.md', 'Copies/Start.md');
		expect(await fs.read('Copies/Start.md')).toBe('# Start');
		await fs.remove('Copies/Start.md');
		expect(await fs.exists('Copies/Start.md')).toBe(false);
		await expect(fs.remove('Torts')).rejects.toMatchObject({ code: 'EISDIR' });
		await expect(fs.rmdir('Torts', false)).rejects.toMatchObject({ code: 'ENOTEMPTY' });
		await fs.rmdir('Torts', true);
		expect(await fs.exists('Torts/lecture.wav')).toBe(false);
		await expect(fs.rmdir('', true)).rejects.toThrow(/homebase/);
	});

	it('trashes a file or folder (gone for good in memory) and says whether there was one', async () => {
		const fs = seeded();
		expect(await fs.trash('Torts')).toBe(true);
		expect(await fs.exists('Torts/Negligence')).toBe(false);
		expect(await fs.trash('Torts')).toBe(false);
	});
});
