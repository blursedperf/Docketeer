import { describe, expect, it } from 'vitest';
import { SearchIndex, tokenize } from '../src/search-index';
import { Usage, frecency } from '../src/usage';
// @ts-expect-error: plain JS module shared with the benchmark script
import { makeFixture } from '../../../scripts/fixture.mjs';

const h = (text: string, level = 1, line = 0) => ({ text, lower: text.toLowerCase(), level, line });

function small() {
	const idx = new SearchIndex();
	idx.set('Torts/Duty/Donoghue v Stevenson.md', '# Donoghue v Stevenson\n\nThe neighbour principle.\n\n## Held\n\nA duty of care is owed to neighbours.', [h('Donoghue v Stevenson'), h('Held', 2, 4)]);
	idx.set('Torts/Breach/Wyong v Shirt.md', '# Wyong Shire Council v Shirt\n\nBreach: a risk that is not far-fetched or fanciful.', [h('Wyong Shire Council v Shirt')]);
	idx.set('Contracts/Formation/Carlill.md', 'Carlill v Carbolic Smoke Ball: an offer to the world. The duty to perform.', []);
	return idx;
}

describe('search index', () => {
	it('tokenizes', () => {
		expect(tokenize('A duty-of-care, s 18!')).toEqual(['duty', 'of', 'care', '18']);
	});
	it('finds notes by name, fuzzily', () => {
		const idx = small();
		expect(idx.searchNames('donog').hits[0]?.path).toBe('Torts/Duty/Donoghue v Stevenson.md');
		expect(idx.searchNames('wys').hits[0]?.path).toBe('Torts/Breach/Wyong v Shirt.md');
	});
	it('finds every word as a prefix, with the matching line', () => {
		const idx = small();
		const r = idx.searchText('duty of care');
		expect(r.total).toBe(1);
		expect(r.hits[0]!.path).toBe('Torts/Duty/Donoghue v Stevenson.md');
		expect(r.hits[0]!.snippet).toBe('A duty of care is owed to neighbours.');
		expect(r.hits[0]!.line).toBe(6);
		expect(r.hits[0]!.ranges[0]).toEqual([2, 6]);
		expect(idx.searchText('duty').total).toBe(2);
		expect(idx.searchText('nothing here').total).toBe(0);
	});
	it('ranks the current unit and use higher', () => {
		const idx = small();
		// "duty car": Donoghue (duty, care) and Carlill (duty, Carbolic); the phrase wins.
		expect(idx.searchText('duty car').total).toBe(2);
		expect(idx.searchText('duty of care').hits[0]!.path).toBe('Torts/Duty/Donoghue v Stevenson.md');
		expect(idx.searchText('duty', 5, { unit: 'Torts' }).hits[0]!.path).toBe('Torts/Duty/Donoghue v Stevenson.md');
		expect(idx.searchText('duty', 5, { unit: 'Contracts' }).hits[0]!.path).toBe('Contracts/Formation/Carlill.md');
		expect(idx.searchText('duty', 5, { usage: (p) => (p.startsWith('Contracts') ? 50 : 0) }).hits[0]!.path).toBe('Contracts/Formation/Carlill.md');
	});
	it('searches headings in every note', () => {
		const idx = small();
		expect(idx.searchHeadings('held').hits.map((x) => x.heading.text)).toEqual(['Held']);
		expect(idx.searchHeadings('council shirt').total).toBe(1);
	});
	it('follows changes, renames and deletes', () => {
		const idx = small();
		idx.set('Torts/Duty/Donoghue v Stevenson.md', 'Snail in a bottle.');
		expect(idx.searchText('neighbour').total).toBe(0);
		expect(idx.searchText('snail').total).toBe(1);
		idx.rename('Torts/Duty/Donoghue v Stevenson.md', 'Torts/Duty/Donoghue.md');
		expect(idx.searchText('snail').hits[0]!.path).toBe('Torts/Duty/Donoghue.md');
		idx.remove('Torts/Duty/Donoghue.md');
		expect(idx.searchText('snail').total).toBe(0);
		expect(idx.size).toBe(2);
	});
	it('stays correct after compaction', () => {
		const idx = new SearchIndex();
		for (let i = 0; i < 2000; i++) idx.set(`n${i}.md`, `word${i % 10} common`);
		for (let i = 0; i < 1500; i++) idx.remove(`n${i}.md`);
		expect(idx.size).toBe(500);
		expect(idx.searchText('common').total).toBe(500);
		expect(idx.searchText('word3').total).toBe(50);
	});
});

describe('usage', () => {
	it('fades with time and grows with use', () => {
		const now = Date.UTC(2026, 10, 24);
		expect(frecency(undefined, now)).toBe(0);
		const once = frecency({ count: 1, last: now }, now);
		expect(frecency({ count: 10, last: now }, now)).toBeGreaterThan(once);
		expect(frecency({ count: 1, last: now - 7 * 86_400_000 }, now)).toBeCloseTo(once / 2);
	});
	it('records, renames and forgets', () => {
		const u = new Usage();
		u.record('note', 'a.md');
		u.record('note', 'a.md');
		u.record('note', 'b.md');
		expect(u.score('note', 'a.md')).toBeGreaterThan(u.score('note', 'b.md'));
		u.rename('note', 'a.md', 'c.md');
		expect(u.score('note', 'a.md')).toBe(0);
		expect(u.recent('note')).toContain('c.md');
		u.forget('note', 'c.md');
		expect(u.score('note', 'c.md')).toBe(0);
	});
});

describe('benchmark: 10,000 notes', () => {
	it('filters within 16 ms a keystroke', () => {
		const notes = makeFixture(10000) as { path: string; text: string }[];
		const idx = new SearchIndex();
		let t = performance.now();
		for (const n of notes) {
			const headings = [...n.text.matchAll(/^(#{1,6}) (.+)$/gm)].map((m) => h(m[2]!, m[1]!.length));
			idx.set(n.path, n.text, headings);
		}
		const build = performance.now() - t;
		const ctx = { unit: 'Torts', usage: () => 0 };
		const typed = ['s', 'sm', 'smi', 'smit', 'smith', 'smith v', 'smith v j', 'smith v jon', 'n', 'ne', 'neg', 'negl', 'neglig', 'negligence', 'negligence b', 'negligence breach', 'ha', 'hc', 'hca 2', 'proximate rel'];
		const times: number[] = [];
		for (const q of typed) {
			t = performance.now();
			idx.searchNames(q, 50, ctx);
			if (q.length >= 2) { idx.searchText(q, 50, ctx); idx.searchHeadings(q, 50, ctx); }
			times.push(performance.now() - t);
		}
		times.sort((a, b) => a - b);
		const median = times[Math.floor(times.length / 2)]!;
		const p90 = times[Math.floor(times.length * 0.9)]!;
		console.log(`10,000 notes: index built in ${build.toFixed(0)} ms; per keystroke median ${median.toFixed(1)} ms, 90th percentile ${p90.toFixed(1)} ms, worst ${times[times.length - 1]!.toFixed(1)} ms`);
		expect(median).toBeLessThan(16);
		expect(p90).toBeLessThan(16);
	}, 60_000);
});

describe('candidates', () => {
	it('narrows to notes with every word of a name', () => {
		const idx = small();
		expect(idx.candidates('Donoghue v Stevenson')).toEqual(['Torts/Duty/Donoghue v Stevenson.md']);
		expect(idx.candidates('v')).toBeNull();
		expect(idx.candidates('Unknown name')).toEqual([]);
	});
});
