/**
 * The search index: in memory only (never written to disk, so it needs no encryption), rebuilt from the
 * notes at start and kept up to date as they change. Locked notes are never added. Pure: no DOM or files,
 * so it is unit-tested and benchmarked with a generated 10,000-note homebase.
 *
 * Full text: an inverted index from words to the notes containing them; a query's words are matched as
 * prefixes (the last one is usually half typed), and every word must appear. Names and headings: fuzzy
 * and substring matching over pre-lowercased strings.
 */
import { fuzzyScore } from './util';

export interface IndexedHeading { text: string; lower: string; level: number; line: number }

interface Doc {
	path: string;
	name: string;
	lowerName: string;
	/** First folder: the unit (subject) the note belongs to. */
	unit: string;
	folder: string;
	text: string;
	lower: string;
	headings: IndexedHeading[];
}

export interface NameHit { path: string; score: number }
export interface TextHit { path: string; score: number; line: number; snippet: string; ranges: [number, number][] }
export interface HeadingHit { path: string; heading: IndexedHeading; score: number }

/** Boosts the caller supplies: how often and how lately a note was used, and where the user is. */
export interface RankContext {
	usage?: (path: string) => number;
	unit?: string;
	folder?: string;
}

const TOKEN = /[\p{L}\p{N}]+/gu;

/** The words of `text`, lowercased, two characters or more. */
export function tokenize(text: string): string[] {
	const out: string[] = [];
	for (const m of text.toLowerCase().matchAll(TOKEN)) if (m[0].length >= 2) out.push(m[0]);
	return out;
}

/**
 * A full-text query: plain words (matched as prefixes, anywhere in the note), "quoted phrases" (must appear as
 * written, case ignored; a quote still open while typing counts to the end) and -excluded words or -"phrases" (no
 * note containing one is shown). `words` are every positive word, plain and quoted, for the index to narrow by.
 */
export interface TextQuery { words: string[]; phrases: string[]; exclude: string[]; plain: string }

export function parseTextQuery(query: string): TextQuery {
	const phrases: string[] = [];
	const exclude: string[] = [];
	const plain: string[] = [];
	for (const m of query.matchAll(/(?<![^\s])(-?)"([^"]*)"?|(\S+)/g)) {
		const neg = m[1] === '-';
		if (m[2] !== undefined) {
			const p = m[2].toLowerCase().trim().replace(/\s+/g, ' ');
			if (!tokenize(p).length) continue;
			(neg ? exclude : phrases).push(p);
		} else if (m[3]!.startsWith('-') && m[3]!.length > 1) {
			const w = m[3]!.slice(1).toLowerCase();
			if (tokenize(w).length) exclude.push(w);
		} else plain.push(m[3]!);
	}
	const words = [...new Set([...tokenize(plain.join(' ')), ...phrases.flatMap(tokenize)])];
	return { words, phrases, exclude, plain: plain.join(' ').toLowerCase().replace(/\s+/g, ' ').trim() };
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function unitOf(path: string): { unit: string; folder: string } {
	const parts = path.split('/');
	parts.pop();
	return { unit: parts[0] ?? '', folder: parts.join('/') };
}

function nameOf(path: string): string {
	const base = path.slice(path.lastIndexOf('/') + 1);
	return base.replace(/\.md$/i, '');
}

export class SearchIndex {
	/** How many matches get the costly ranking checks. */
	static DEEP = 300;
	private docs: (Doc | null)[] = [];
	private byPath = new Map<string, number>();
	/** Word → ids of the notes containing it, ascending. Removed notes are left as dead ids until compaction. */
	private postings = new Map<string, number[]>();
	/** Words in sorted order (for prefix lookups), plus words added since the last sort. */
	private sorted: string[] = [];
	private unsorted: string[] = [];
	private dead = 0;
	/** Bumped on every change, so remembered matches from an earlier query are not reused after one. */
	private version = 0;
	/**
	 * The last name and heading queries and what matched. Typing extends the query, and whatever matches
	 * "smit" also matched "smi", so the next keystroke only rechecks those instead of every note.
	 */
	private lastNames: { q: string; version: number; ids: number[] } | null = null;
	private lastHeadings: { q: string; version: number; hits: number[] } | null = null;
	/** Scratch for intersections: a stamp per note id. */
	private marks = new Uint32Array(0);
	private stamp = 0;

	get size(): number { return this.byPath.size; }
	has(path: string): boolean { return this.byPath.has(path); }
	paths(): string[] { return [...this.byPath.keys()]; }

	/** Add or replace a note. */
	set(path: string, text: string, headings: IndexedHeading[] = []): void {
		if (this.byPath.has(path)) this.remove(path);
		const name = nameOf(path);
		this.version++;
		const id = this.docs.length;
		this.docs.push({ path, name, lowerName: name.toLowerCase(), ...unitOf(path), text, lower: text.toLowerCase(), headings });
		this.byPath.set(path, id);
		for (const word of new Set([...tokenize(text), ...tokenize(name)])) {
			let list = this.postings.get(word);
			if (!list) {
				list = [];
				this.postings.set(word, list);
				this.unsorted.push(word);
			}
			list.push(id);
		}
	}

	/** Replace a note's headings (from the metadata cache) without re-reading its text. */
	setHeadings(path: string, headings: IndexedHeading[]): void {
		const id = this.byPath.get(path);
		if (id !== undefined) { this.docs[id]!.headings = headings; this.version++; }
	}

	remove(path: string): void {
		const id = this.byPath.get(path);
		if (id === undefined) return;
		this.docs[id] = null;
		this.byPath.delete(path);
		this.version++;
		this.dead++;
		if (this.dead > 500 && this.dead > this.docs.length / 4) this.compact();
	}

	rename(from: string, to: string): void {
		const id = this.byPath.get(from);
		if (id === undefined) return;
		const d = this.docs[id]!;
		this.set(to, d.text, d.headings);
		this.remove(from);
	}

	clear(): void {
		this.docs = [];
		this.byPath.clear();
		this.postings.clear();
		this.sorted = [];
		this.unsorted = [];
		this.dead = 0;
		this.version++;
		this.lastNames = null;
		this.lastHeadings = null;
	}

	/** Drop dead ids: renumber the live notes and rebuild the postings. */
	private compact(): void {
		const live = this.docs.filter((d): d is Doc => d !== null);
		this.clear();
		for (const d of live) this.set(d.path, d.text, d.headings);
	}

	/** The words starting with `prefix`. */
	private wordsWithPrefix(prefix: string): string[] {
		if (this.unsorted.length > 256) {
			this.sorted = [...this.sorted, ...this.unsorted].sort();
			this.unsorted = [];
		}
		const out: string[] = [];
		let lo = 0;
		let hi = this.sorted.length;
		while (lo < hi) { const mid = (lo + hi) >>> 1; if (this.sorted[mid]! < prefix) lo = mid + 1; else hi = mid; }
		for (let i = lo; i < this.sorted.length && this.sorted[i]!.startsWith(prefix); i++) out.push(this.sorted[i]!);
		for (const w of this.unsorted) if (w.startsWith(prefix)) out.push(w);
		return out;
	}

	/** Ids of notes containing a word starting with `prefix`, stamped into `marks`; returns how many. */
	private markWord(prefix: string, require: number): number {
		const stamp = ++this.stamp;
		let count = 0;
		for (const w of this.wordsWithPrefix(prefix)) {
			for (const id of this.postings.get(w)!) {
				if (this.marks[id] === require && this.docs[id]) { this.marks[id] = stamp; count++; }
			}
		}
		return count;
	}

	private context(d: Doc, ctx: RankContext): number {
		let s = ctx.usage?.(d.path) ?? 0;
		if (ctx.folder && d.folder === ctx.folder) s += 6;
		else if (ctx.unit && d.unit === ctx.unit) s += 3;
		return s;
	}

	/** Stamp the notes containing every word (as a prefix); returns the stamp, or 0 when none do. */
	private markAll(words: string[]): number {
		if (this.marks.length < this.docs.length) this.marks = new Uint32Array(Math.max(1024, this.docs.length * 2));
		// Longer words first: usually rarer, so fewer notes to check for the rest.
		const order = [...words].sort((a, b) => b.length - a.length);
		this.marks.fill(0, 0, this.docs.length);
		let require = 0;
		for (const w of order) {
			if (!this.markWord(w, require)) return 0;
			require = this.stamp;
		}
		return require;
	}

	/**
	 * Notes that may contain `text`: every word of it (two letters or more) appears in them. A cheap first
	 * cut before an exact search, such as for unlinked mentions of a note's name. Null when `text` has no
	 * such words (then every note may).
	 */
	candidates(text: string): string[] | null {
		const words = [...new Set(tokenize(text))];
		if (!words.length) return null;
		const require = this.markAll(words);
		const out: string[] = [];
		if (!require) return out;
		for (let id = 0; id < this.docs.length; id++) if (this.marks[id] === require) out.push(this.docs[id]!.path);
		return out;
	}

	/** Notes whose name matches `query` (fuzzy), best first. */
	searchNames(query: string, limit = 50, ctx: RankContext = {}): { hits: NameHit[]; total: number } {
		const q = query.trim().toLowerCase();
		if (!q) return { hits: [], total: 0 };
		const prev = this.lastNames;
		const narrow = prev && prev.version === this.version && q.startsWith(prev.q) ? prev.ids : null;
		const ids: number[] = [];
		const top = new TopK(limit);
		const check = (id: number) => {
			const d = this.docs[id];
			if (!d) return;
			const s = fuzzyLower(q, d.lowerName);
			if (s === null) return;
			ids.push(id);
			top.push(id, s + this.context(d, ctx));
		};
		if (narrow) for (const id of narrow) check(id);
		else for (let id = 0; id < this.docs.length; id++) check(id);
		this.lastNames = { q, version: this.version, ids };
		return { hits: top.ids.map((id, i) => ({ path: this.docs[id]!.path, score: top.scores[i]! })), total: ids.length };
	}

	/**
	 * Notes containing every word of `query` (the words as prefixes), best first, each with the line of the
	 * first match. Score: the whole phrase present, a match near the top, the name matching too, and context.
	 * "Quoted phrases" must appear as written and -words or -"phrases" leave a note out (parseTextQuery).
	 */
	searchText(query: string, limit = 50, ctx: RankContext = {}): { hits: TextHit[]; total: number } {
		const q = parseTextQuery(query);
		const { words } = q;
		if (!words.length) return { hits: [], total: 0 };
		const require = this.markAll(words);
		if (require === 0) return { hits: [], total: 0 };
		// An excluded word or phrase counts where a word starts ("-tort" leaves out notes with "torts" too).
		const excluded = q.exclude.map((x) => new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(x)}`, 'u'));
		const wanted = (d: Doc) => q.phrases.every((p) => d.lower.includes(p)) && !excluded.some((re) => re.test(d.lower));
		const phrase = q.phrases[0] ?? q.plain;
		const first = words[words.length - 1]!;
		// Two passes: a cheap score (use, unit, the name matching) for every match, then the costly checks
		// (the whole phrase, how near the top) for the best few hundred. With thousands of matches the rest
		// are never looked at; the query gets refined instead.
		const top = new TopK(SearchIndex.DEEP);
		let total = 0;
		for (let id = 0; id < this.docs.length; id++) {
			if (this.marks[id] !== require) continue;
			const d = this.docs[id]!;
			if ((q.phrases.length || excluded.length) && !wanted(d)) continue;
			total++;
			let score = 10 + this.context(d, ctx);
			if (words.every((w) => d.lowerName.includes(w))) score += 8;
			top.push(id, score);
		}
		const deep = top.ids.map((id, i) => ({ d: this.docs[id]!, score: top.scores[i]! }));
		for (const s of deep) {
			if (!q.phrases.length && words.length > 1 && phrase && s.d.lower.includes(phrase)) s.score += 20;
			const at = s.d.lower.indexOf(first);
			if (at >= 0) s.score += 5 * (1 - Math.min(at, 5000) / 5000);
		}
		deep.sort((a, b) => b.score - a.score);
		const hits = deep.slice(0, limit).map(({ d, score }) => ({ path: d.path, score, ...snippet(d, words, phrase, q.phrases.length > 0) }));
		return { hits, total };
	}

	/** Headings, in any note, containing every word of `query`, best first. */
	searchHeadings(query: string, limit = 50, ctx: RankContext = {}): { hits: HeadingHit[]; total: number } {
		const q = query.toLowerCase().trim();
		const words = q.split(/\s+/).filter(Boolean);
		if (!words.length) return { hits: [], total: 0 };
		const prev = this.lastHeadings;
		const narrow = prev && prev.version === this.version && q.startsWith(prev.q) && !/\s$/.test(query) ? prev.hits : null;
		// A heading is numbered note id × 4096 + its position in the note.
		const kept: number[] = [];
		const top = new TopK(limit);
		const check = (id: number, hi: number) => {
			const d = this.docs[id];
			const h = d?.headings[hi];
			if (!d || !h || !words.every((w) => h.lower.includes(w))) return;
			kept.push(id * 4096 + hi);
			const starts = h.lower.startsWith(words[0]!) ? 4 : 0;
			top.push(id * 4096 + hi, 10 + starts - h.level * 0.5 - h.lower.length * 0.01 + this.context(d, ctx));
		};
		if (narrow) for (const k of narrow) check(Math.floor(k / 4096), k % 4096);
		else for (let id = 0; id < this.docs.length; id++) { const d = this.docs[id]; if (d) for (let hi = 0; hi < Math.min(d.headings.length, 4096); hi++) check(id, hi); }
		this.lastHeadings = { q, version: this.version, hits: kept };
		const hits = top.ids.map((k, i) => { const d = this.docs[Math.floor(k / 4096)]!; return { path: d.path, heading: d.headings[k % 4096]!, score: top.scores[i]! }; });
		return { hits, total: kept.length };
	}
}

/**
 * The best `k` of a stream of (id, score), best first. Most matches are turned away by one comparison once
 * it is full, so a search over thousands of notes allocates almost nothing.
 */
class TopK {
	ids: number[] = [];
	scores: number[] = [];
	constructor(private k: number) {}
	push(id: number, score: number): void {
		const n = this.scores.length;
		if (n === this.k && score <= this.scores[n - 1]!) return;
		let lo = 0;
		let hi = n;
		while (lo < hi) { const m = (lo + hi) >>> 1; if (this.scores[m]! >= score) lo = m + 1; else hi = m; }
		this.scores.splice(lo, 0, score);
		this.ids.splice(lo, 0, id);
		if (this.scores.length > this.k) { this.scores.pop(); this.ids.pop(); }
	}
}

/** `fuzzyScore` for text that is already lowercase (names are stored that way), without copying it. */
function fuzzyLower(q: string, t: string): number | null {
	const direct = t.indexOf(q);
	if (direct !== -1) return 1000 - direct - (t.length - q.length) * 0.01;
	let score = 0;
	let ti = 0;
	let prev = -2;
	for (let i = 0; i < q.length; i++) {
		const ch = q[i]!;
		if (ch === ' ') continue;
		const found = t.indexOf(ch, ti);
		if (found === -1) return null;
		score += found === prev + 1 ? 5 : 1;
		if (found === 0) score += 3;
		else { const c = t.charCodeAt(found - 1); if (c === 32 || c === 47 || c === 45 || c === 95 || c === 46) score += 3; }
		prev = found;
		ti = found + 1;
	}
	return score - t.length * 0.01;
}

/** The line with the first match (the phrase, else the first word), trimmed around it, with highlights. */
function snippet(d: Doc, words: string[], phrase: string, quoted = false): { line: number; snippet: string; ranges: [number, number][] } {
	let at = words.length > 1 || quoted ? d.lower.indexOf(phrase) : -1;
	if (at < 0) {
		// Prefer a match at the start of a word.
		for (const w of words) {
			const re = new RegExp(`(?<![\\p{L}\\p{N}])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'u');
			const m = re.exec(d.lower);
			if (m && (at < 0 || m.index < at)) at = m.index;
		}
	}
	if (at < 0) at = 0;
	const start = d.text.lastIndexOf('\n', at - 1) + 1;
	let end = d.text.indexOf('\n', at);
	if (end < 0) end = d.text.length;
	const line = (d.text.slice(0, start).match(/\n/g) ?? []).length;
	let from = start;
	let to = end;
	if (to - from > 160) { from = Math.max(start, at - 60); to = Math.min(end, from + 160); }
	const text = d.text.slice(from, to);
	const lower = text.toLowerCase();
	const ranges: [number, number][] = [];
	for (const w of words) {
		let i = lower.indexOf(w);
		while (i >= 0 && ranges.length < 20) { ranges.push([i, i + w.length]); i = lower.indexOf(w, i + w.length); }
	}
	ranges.sort((a, b) => a[0] - b[0]);
	return { line, snippet: (from > start ? '…' : '') + text + (to < end ? '…' : ''), ranges: from > start ? ranges.map(([a, b]) => [a + 1, b + 1]) : ranges };
}
