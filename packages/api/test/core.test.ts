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

import { accentVars, cssProblems } from '../src/themes/manager';
import { BUILTIN_PALETTES } from '../src/themes/palettes';

describe('themes', () => {
	it('refuses CSS that loads from outside the app', () => {
		expect(cssProblems('body { color: red; }')).toEqual([]);
		expect(cssProblems('body { background: url(data:image/png;base64,AAA); }')).toEqual([]);
		expect(cssProblems('@import "x.css";')).toContain('@import');
		expect(cssProblems('body { background: url(https://e.com/a.png) }')).toEqual(['url(https://e.com/a.png)']);
		expect(cssProblems('@font-face { src: url("fonts/a.woff2") }')).toEqual(['url(fonts/a.woff2)']);
		expect(cssProblems('/* see https://example.com */ body {}')).toEqual([]);
		expect(cssProblems('a::after { content: "https://x.y" }')).toEqual(['a web address']);
	});
	it('derives accent tokens with readable text on the accent', () => {
		expect(accentVars('#ffffff')?.['doom-on-accent']).toBe('#0b1018');
		expect(accentVars('#1b55d6')?.['doom-on-accent']).toBe('#ffffff');
		expect(accentVars('#f80')?.['doom-blue-rgb']).toBe('255, 136, 0');
		expect(accentVars('not a colour')).toBeNull();
	});
	it('has complete palettes', () => {
		expect(BUILTIN_PALETTES).toHaveLength(18);
		const keys = Object.keys(BUILTIN_PALETTES[0]!.vars).sort();
		for (const p of BUILTIN_PALETTES) expect(Object.keys(p.vars).sort()).toEqual(keys);
		expect(BUILTIN_PALETTES.filter((p) => p.mode === 'dark')).toHaveLength(10);
	});
});

import { CONTRAST_PAIRS, contrastFixes, contrastRatio, parseHex, resolveToken } from '../src/themes/contrast';

describe('contrast', () => {
	const check = (vars: Record<string, string>) => CONTRAST_PAIRS.filter(([t, s, min]) => {
		const a = parseHex(resolveToken(vars, t) ?? '');
		const b = parseHex(resolveToken(vars, s) ?? '');
		return !a || !b || contrastRatio(a, b) < min - 0.01;
	}).map(([t, s]) => `${t} on ${s}`);

	it('every built-in palette meets every pairing once the guard is applied', () => {
		for (const p of BUILTIN_PALETTES) {
			const vars = { ...p.vars, ...contrastFixes(p.vars) };
			expect(check(vars), p.id).toEqual([]);
		}
	});
	it('leaves palettes that already pass untouched', () => {
		const crisp = BUILTIN_PALETTES.find((p) => p.id === 'crisp-dark')!;
		expect(contrastFixes(crisp.vars)).toEqual({});
	});
	it('fixes a custom accent that is too light for its text', () => {
		const crisp = BUILTIN_PALETTES.find((p) => p.id === 'crisp-light')!;
		const vars = { ...crisp.vars, ...accentVars('#ffee88')! };
		expect(check({ ...vars, ...contrastFixes(vars) })).toEqual([]);
	});
});

import { wordMatch } from '../src/util';

describe('word matching', () => {
	it('matches letters that run on or start words', () => {
		expect(wordMatch('ntab', 'New tab')).not.toBeNull();
		expect(wordMatch('spl', 'Split right')).not.toBeNull();
		expect(wordMatch('srig', 'Split right')).not.toBeNull();
		expect(wordMatch('mabo', 'Move tab to the pane left')).toBeNull();
		expect(wordMatch('tab', 'New tab')!).toBeGreaterThan(wordMatch('ntab', 'New tab')!);
	});
});

describe('word matching speed', () => {
	it('stays fast on long queries that nearly match', () => {
		const text = 'a '.repeat(60) + 'b';
		const t = performance.now();
		expect(wordMatch('a'.repeat(40) + 'c', text)).toBeNull();
		expect(performance.now() - t).toBeLessThan(50);
	});
});
