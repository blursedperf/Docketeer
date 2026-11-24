/**
 * The Docket's decisions that do not need a screen, kept pure so they are unit-tested: reading the prefix
 * off the input, choosing the panel to open from where the cursor is, and grouping results.
 */
import type { SearchResult } from './docket-registry';

export const DOCKET_PREFIXES = ['>', '@', '#', '/', '?'] as const;

/** "> new note" → { prefix: '>', text: 'new note' }. */
export function parsePrefix(input: string): { prefix: string; text: string } {
	const first = input.charAt(0);
	if ((DOCKET_PREFIXES as readonly string[]).includes(first)) return { prefix: first, text: input.slice(1).trim() };
	return { prefix: '', text: input.trim() };
}

/** Words that start a sentence before a case name, not part of it. */
const LEAD_WORDS = new Set(['In', 'See', 'Cf', 'Also', 'But', 'And', 'As', 'Following', 'Unlike', 'Like', 'Under', 'Applying', 'Compare', 'Contra', 'Since', 'After', 'Before', 'Per']);
const NAME_WORD = String.raw`(?:[A-Z][\w'’&.()-]*|of|the|and|for|de|van|von)`;
const CASE_NAME = new RegExp(String.raw`${NAME_WORD}(?: ${NAME_WORD}){0,6} v ${NAME_WORD}(?: (?:${NAME_WORD}|\[No \d+\]))*`, 'g');

/** The case name ("Mabo v Queensland [No 2]") at `ch` in `line`, if the cursor is on one. */
export function caseNameAt(line: string, ch: number): string | null {
	for (const m of line.matchAll(CASE_NAME)) {
		const from = m.index;
		const to = from + m[0].length;
		if (ch < from || ch > to) continue;
		const words = m[0].split(' ');
		while (words.length > 3 && LEAD_WORDS.has(words[0]!)) words.shift();
		while (words.length > 3 && /^[a-z]/.test(words[words.length - 1]!)) words.pop();
		const name = words.join(' ');
		return / v /.test(name) && !name.startsWith('v ') ? name : null;
	}
	return null;
}

/** Whether the cursor is in a footnote: a definition line ("[^1]: …") or an inline footnote (^[…]). */
export function inFootnote(line: string, ch: number): boolean {
	if (/^ {0,3}\[\^[^\]\n]+\]:/.test(line)) return true;
	for (const m of line.matchAll(/\^\[[^\]\n]*\]?/g)) if (ch > m.index && ch <= m.index + m[0].length) return true;
	return false;
}

/** Which panel to open from the cursor: Authorities on a case name, Cite in a footnote, else none. */
export function contextPanel(line: string, ch: number): { panel: 'authorities'; focus: string } | { panel: 'cite' } | null {
	if (inFootnote(line, ch)) return { panel: 'cite' };
	const name = caseNameAt(line, ch);
	return name ? { panel: 'authorities', focus: name } : null;
}

/** Group heading order for the unprefixed search. Other types follow, alphabetically. */
const TYPE_ORDER = ['In the Docket', 'In Units', 'Prefixes', 'Recently used', 'Notes', 'Folders', 'Headings', 'Authorities', 'In notes', 'Commands', 'Tags', 'Settings', 'Search', 'Docket', 'Edit', 'View', 'Layout', 'Homebase', 'App', 'Shortcuts', 'New note'];

/**
 * Results grouped by type, best first within a group, groups in a fixed order; `perGroup` limits each
 * group (the unprefixed search shows a few of each).
 */
export function groupResults(results: SearchResult[], perGroup = Infinity, totals: Record<string, number> = {}): { type: string; items: SearchResult[]; total: number }[] {
	const by = new Map<string, SearchResult[]>();
	for (const r of results) {
		const list = by.get(r.type) ?? [];
		list.push(r);
		by.set(r.type, list);
	}
	// Known groups in order, then any others A–Z, then "New note" last of all.
	const rank = (t: string) => (t === 'New note' ? TYPE_ORDER.length + 1 : (() => { const i = TYPE_ORDER.indexOf(t); return i === -1 ? TYPE_ORDER.length : i; })());
	return [...by.entries()]
		.sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
		.map(([type, items]) => {
			const sorted = [...items].sort((x, y) => (y.score ?? 0) - (x.score ?? 0));
			return { type, items: sorted.slice(0, perGroup), total: Math.max(items.length, totals[type] ?? 0) };
		});
}

/** Clamp the Docket's height (a fraction of the window) to 20–60 %. */
export function clampHeight(f: number): number {
	return Math.min(0.6, Math.max(0.2, Math.round(f * 100) / 100));
}

/** Merge what providers returned (plain lists or lists with totals). */
export function mergeResults(lists: (SearchResult[] | { results: SearchResult[]; totals?: Record<string, number> })[]): { results: SearchResult[]; totals: Record<string, number> } {
	const results: SearchResult[] = [];
	const totals: Record<string, number> = {};
	for (const l of lists) {
		if (Array.isArray(l)) { results.push(...l); continue; }
		results.push(...l.results);
		for (const [k, v] of Object.entries(l.totals ?? {})) totals[k] = (totals[k] ?? 0) + v;
	}
	return { results, totals };
}
