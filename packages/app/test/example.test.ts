import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
// @ts-expect-error: a build script in plain JavaScript
import { buildExample, lectureWav, readingPdf } from '../example/build.mjs';
import { EXAMPLE_MARKER, EXAMPLE_NAME, LEGACY_EXAMPLE_NAME, installExample } from '../src/main/example';

const tmp = mkdtempSync(join(tmpdir(), 'quire-example-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function files(dir: string, root = dir, out: string[] = []): string[] {
	for (const name of readdirSync(dir)) {
		const p = join(dir, name);
		if (statSync(p).isDirectory()) files(p, root, out);
		else out.push(relative(root, p).split('\\').join('/'));
	}
	return out;
}

describe('the example homebase', async () => {
	const out = join(tmp, 'built');
	await buildExample(out);
	const all = files(out);
	const notes = all.filter((f) => f.endsWith('.md'));

	it('has its notes, its sample recording and reading, and the files that mark and lay it out', () => {
		for (const f of ['Start here.md', 'Torts/Negligence/Donoghue v Stevenson.md', 'Torts/Negligence/Week 3 lecture.wav',
			'Torts/Readings/The neighbour principle (sample reading).pdf', '.quire/example.json', '.quire/workspace.json']) {
			expect(all, f).toContain(f);
		}
	});

	it('links only to things that are in it', () => {
		const resolve = (target: string) => {
			const want = /\.[a-z0-9]+$/i.test(target) && !target.endsWith('.md') ? target : `${target.replace(/\.md$/, '')}.md`;
			return all.some((f) => f === want || f.endsWith(`/${want}`));
		};
		const broken: string[] = [];
		for (const n of notes) {
			const text = readFileSync(join(out, n), 'utf8');
			for (const m of text.matchAll(/!?\[\[([^\]|#^]+)(?:[#^][^\]|]*)?(?:\|[^\]]*)?\]\]/g)) if (!resolve(m[1]!.trim())) broken.push(`${n}: ${m[0]}`);
		}
		expect(broken).toEqual([]);
	});

	it('opens on notes that exist', () => {
		const layout = readFileSync(join(out, '.quire/workspace.json'), 'utf8');
		for (const m of layout.matchAll(/"file": "([^"]+)"/g)) expect(all, m[1]).toContain(m[1]);
	});

	it('has a 3-page reading labelled from 101, and an 80-second recording', () => {
		const pdf = readingPdf().toString('latin1');
		expect(pdf.startsWith('%PDF-1.4')).toBe(true);
		expect(pdf).toContain('/Count 3');
		expect(pdf).toContain('/St 101');
		const xref = Number(/startxref\n(\d+)/.exec(pdf)![1]);
		expect(pdf.slice(xref, xref + 4)).toBe('xref');
		const wav = lectureWav();
		expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
		expect(wav.readUInt32LE(40)).toBe(80 * 8000);
	});
});

describe('installExample', () => {
	const source = join(tmp, 'source');
	mkdirSync(join(source, '.quire'), { recursive: true });
	writeFileSync(join(source, EXAMPLE_MARKER), '{}');
	writeFileSync(join(source, 'Start here.md'), 'Hello');

	it('copies the example into a folder of its own, then opens that copy again as it is', async () => {
		const docs = join(tmp, 'docs1');
		const first = await installExample(source, docs);
		expect(first).toBe(join(docs, EXAMPLE_NAME));
		writeFileSync(join(first, 'Start here.md'), 'Changed by the user');
		const again = await installExample(source, docs);
		expect(again).toBe(first);
		expect(readFileSync(join(first, 'Start here.md'), 'utf8')).toBe('Changed by the user');
	});

	it('leaves a folder of the same name that is not the example alone', async () => {
		const docs = join(tmp, 'docs2');
		mkdirSync(join(docs, EXAMPLE_NAME), { recursive: true });
		writeFileSync(join(docs, EXAMPLE_NAME, 'mine.md'), 'mine');
		const dest = await installExample(source, docs);
		expect(dest).toBe(join(docs, `${EXAMPLE_NAME} 2`));
		expect(readdirSync(join(docs, EXAMPLE_NAME))).toEqual(['mine.md']);
		expect(existsSync(join(dest, 'Start here.md'))).toBe(true);
	});

	it('opens a "Quire example" made before the rename, as it is', async () => {
		const docs = join(tmp, 'docs4');
		const legacy = join(docs, LEGACY_EXAMPLE_NAME);
		mkdirSync(join(legacy, '.quire'), { recursive: true });
		writeFileSync(join(legacy, EXAMPLE_MARKER), '{}');
		writeFileSync(join(legacy, 'Start here.md'), 'Changed by the user');
		expect(await installExample(source, docs)).toBe(legacy);
		expect(existsSync(join(docs, EXAMPLE_NAME))).toBe(false);
		expect(readFileSync(join(legacy, 'Start here.md'), 'utf8')).toBe('Changed by the user');
	});

	it('refuses a source that is not the example', async () => {
		await expect(installExample(join(tmp, 'nowhere'), join(tmp, 'docs3'))).rejects.toThrow(/missing/);
	});
});
