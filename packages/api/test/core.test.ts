import { describe, expect, it, vi } from 'vitest';
import { debounce, fuzzyScore, normalizePath } from '../src/util';
import { minimalChange } from '../src/editor';
import { parseFrontMatter, parseLinktext, parseMetadata, splitFrontMatter, withFrontMatter } from '../src/metadata';
import { Events } from '../src/events';
import { Component } from '../src/component';

describe('paths', () => {
	it('normalises', () => {
		expect(normalizePath('/a//b/')).toBe('a/b');
		expect(normalizePath('a\\b')).toBe('a/b');
		expect(normalizePath('')).toBe('/');
		expect(normalizePath('/')).toBe('/');
	});
});

describe('frontmatter', () => {
	const note = '---\ntags: [a, b]\naglc: true\n---\n\n# Title\n';
	it('splits and parses', () => {
		expect(splitFrontMatter(note).yaml).toBe('tags: [a, b]\naglc: true');
		expect(parseFrontMatter(note)).toEqual({ tags: ['a', 'b'], aglc: true });
		expect(parseFrontMatter('# No frontmatter')).toBeUndefined();
	});
	it('round-trips a change and keeps the body', () => {
		const fm = parseFrontMatter(note)!;
		fm.aglc = false;
		const next = withFrontMatter(note, fm);
		expect(next.endsWith('\n# Title\n')).toBe(true);
		expect(parseFrontMatter(next)).toEqual({ tags: ['a', 'b'], aglc: false });
	});
	it('adds and removes the block', () => {
		const added = withFrontMatter('Body\n', { aglc: true });
		expect(added).toBe('---\naglc: true\n---\n\nBody\n');
		expect(withFrontMatter(added, {})).toBe('Body\n');
	});
	it('tolerates invalid YAML', () => {
		expect(parseFrontMatter('---\n: : :\n  - [\n---\n')).toBeUndefined();
	});
});

describe('metadata', () => {
	const text = [
		'---', 'title: x', '---', '# One', 'See [[Other note|alias]] and [md](Folder/Third.md) and https://x.y #tag.',
		'```', '[[not a link]] #nottag [^9]', '```', '## Two', 'A footnote.[^1] ![[image.png]]', '', '[^1]: The note.',
	].join('\n');
	const m = parseMetadata(text);
	it('finds headings outside code', () => {
		expect(m.headings?.map((h) => [h.level, h.heading])).toEqual([[1, 'One'], [2, 'Two']]);
		expect(m.headings?.[0]?.position.start.line).toBe(3);
	});
	it('finds links, embeds and tags', () => {
		expect(m.links?.map((l) => l.link)).toEqual(['Other note', 'Folder/Third.md']);
		expect(m.links?.[0]?.displayText).toBe('alias');
		expect(m.embeds?.map((l) => l.link)).toEqual(['image.png']);
		expect(m.tags?.map((t) => t.tag)).toEqual(['#tag']);
	});
	it('finds footnotes', () => {
		expect(m.footnotes?.map((f) => f.id)).toEqual(['1']);
		expect(m.footnoteRefs?.map((f) => f.id)).toEqual(['1']);
	});
	it('splits link text', () => {
		expect(parseLinktext('Note#Heading')).toEqual({ path: 'Note', subpath: '#Heading' });
		expect(parseLinktext('Note')).toEqual({ path: 'Note', subpath: '' });
	});
});

describe('helpers', () => {
	it('computes minimal changes', () => {
		expect(minimalChange('abcdef', 'abXYef')).toEqual({ from: 2, to: 4, insert: 'XY' });
		expect(minimalChange('same', 'same')).toBeNull();
		expect(minimalChange('aaa', 'aaaa')).toEqual({ from: 3, to: 3, insert: 'a' });
	});
	it('fuzzy matches', () => {
		expect(fuzzyScore('cnt', 'Create new note')).not.toBeNull();
		expect(fuzzyScore('zzz', 'Create new note')).toBeNull();
		expect(fuzzyScore('note', 'note')!).toBeGreaterThan(fuzzyScore('note', 'a long name with note in it')!);
	});
	it('debounces, with reset and cancel', () => {
		vi.useFakeTimers();
		const fn = vi.fn();
		const d = debounce(fn, 100, true);
		d(1); vi.advanceTimersByTime(60); d(2); vi.advanceTimersByTime(60);
		expect(fn).not.toHaveBeenCalled();
		vi.advanceTimersByTime(50);
		expect(fn).toHaveBeenCalledWith(2);
		d(3); d.cancel(); vi.advanceTimersByTime(200);
		expect(fn).toHaveBeenCalledTimes(1);
		vi.useRealTimers();
	});
	it('undoes registrations when a component unloads', () => {
		const ev = new Events();
		const fn = vi.fn();
		const c = new Component();
		c.load();
		c.registerEvent(ev.on('x', fn));
		ev.trigger('x');
		c.unload();
		ev.trigger('x');
		expect(fn).toHaveBeenCalledTimes(1);
	});
});
