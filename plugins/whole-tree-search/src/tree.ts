/**
 * Whole-tree matching for the Docket. Each match comes back as lines with their depth (the outline around it:
 * ancestors, the line found, its nested children, by parser.ts's rules), the nearest heading above it, and the
 * matched words marked. Several words may be spread down one branch: "duty breach" finds a child with "breach"
 * under a parent with "duty". Words match where a word starts, case ignored unless asked, as in the Docket's
 * own search.
 *
 * Pure: no app or DOM, tested on its own.
 */
import { DEFAULT_SEARCH_OPTIONS, type TreeSearchOptions, getFrontmatterEndIndex, getIndentationLevel } from "./parser";

export interface TreeLine { text: string; depth: number; match?: boolean; ranges?: [number, number][] }

export interface TreeMatch {
	/** The line found (0-based). */
	line: number;
	/** The line found, as shown (no indentation or list marker). */
	text: string;
	/** Every word is on the line itself (not spread down its branch). */
	whole: boolean;
	lines: TreeLine[];
}

export interface TreeMatchOptions extends TreeSearchOptions {
	/** Show the nearest heading above the match as the first line. */
	showHeading: boolean;
}

export const DEFAULT_TREE_OPTIONS: TreeMatchOptions = { ...DEFAULT_SEARCH_OPTIONS, showHeading: true };

const HEADING = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const MARKER = /^(?:[-*+]|\d{1,9}[.)])\s+/;
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The query's words: split on spaces, lowercased unless case matters, each once. */
export function queryWords(query: string, caseSensitive = false): string[] {
	const words = query.trim().split(/\s+/).filter(Boolean).map((w) => (caseSensitive ? w : w.toLowerCase()));
	return [...new Set(words)];
}

/** A line as shown: no indentation, no list marker, a heading without its #s. */
export function displayLine(line: string): string {
	const h = HEADING.exec(line);
	if (h) return h[2]!;
	return line.trim().replace(MARKER, "");
}

/** Where `words` start in `text` (at the start of a word), sorted, for highlighting. */
function rangesIn(text: string, patterns: RegExp[]): [number, number][] {
	const out: [number, number][] = [];
	for (const re of patterns) {
		const g = new RegExp(re.source, `${re.flags}g`);
		for (const m of text.matchAll(g)) if (m[0]) out.push([m.index!, m.index! + m[0].length]);
	}
	out.sort((a, b) => a[0] - b[0]);
	// Overlapping words ("neg" and "negligence"): keep the first of each overlap.
	return out.filter((r, i) => i === 0 || r[0] >= out[i - 1]![1]);
}

/** Ancestors of line `i` (indices, outermost first), up to `levels`, by the parser's indentation rules. */
function ancestorsOf(lines: string[], i: number, levels: number, opts: TreeMatchOptions): number[] {
	const out: number[] = [];
	let threshold = getIndentationLevel(lines[i]!, opts.tabSize);
	for (let j = i - 1; j >= opts.minLineIndex && out.length < levels && threshold > 0; j--) {
		const c = lines[j]!;
		if (c.trim() === "") { if (opts.stopAtBlankLines) break; continue; }
		const indent = getIndentationLevel(c, opts.tabSize);
		if (indent < threshold) { out.unshift(j); threshold = indent; }
	}
	return out;
}

/** Nested children of line `i`, each with its depth below it (1 = directly under). */
function childrenOf(lines: string[], i: number, opts: TreeMatchOptions): { index: number; depth: number }[] {
	const out: { index: number; depth: number }[] = [];
	if (!opts.includeChildren) return out;
	const base = getIndentationLevel(lines[i]!, opts.tabSize);
	const stack: number[] = [];
	for (let j = i + 1; j < lines.length; j++) {
		const c = lines[j]!;
		if (c.trim() === "") { if (opts.stopAtBlankLines) break; continue; }
		const indent = getIndentationLevel(c, opts.tabSize);
		if (indent <= base) break;
		while (stack.length && stack[stack.length - 1]! >= indent) stack.pop();
		stack.push(indent);
		if (opts.maxChildDepth > 0 && stack.length > opts.maxChildDepth) continue;
		out.push({ index: j, depth: stack.length });
	}
	return out;
}

/** Every whole-tree match of `query` in a note's text, in order, up to `limit` (0: all). */
export function searchTree(content: string, query: string, options: Partial<TreeMatchOptions> = {}): TreeMatch[] {
	const opts: TreeMatchOptions = { ...DEFAULT_TREE_OPTIONS, ...options };
	const words = queryWords(query, opts.caseSensitive);
	if (!words.length) return [];
	const patterns = words.map((w) => new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(w)}`, opts.caseSensitive ? "u" : "iu"));
	// Cheap whole-note check first: most notes have none of the words.
	if (!patterns.every((re) => re.test(content))) return [];

	const lines = content.split(/\r?\n/);
	const start = opts.skipFrontmatter ? getFrontmatterEndIndex(lines) : 0;
	const o: TreeMatchOptions = { ...opts, minLineIndex: start };
	// The nearest heading at or above each line.
	const headingAt: number[] = [];
	let fence = false;
	let last = -1;
	for (let i = 0; i < lines.length; i++) {
		if (/^\s*(```|~~~)/.test(lines[i]!)) fence = !fence;
		else if (!fence && i >= start && HEADING.test(lines[i]!)) last = i;
		headingAt.push(last);
	}
	const has = (i: number) => patterns.map((re) => re.test(lines[i]!));

	const out: TreeMatch[] = [];
	for (let i = start; i < lines.length; i++) {
		if (lines[i]!.trim() === "") continue;
		const on = has(i);
		if (!on.some(Boolean)) continue;
		const whole = on.every(Boolean);
		if (!whole) {
			// Spread down a branch: the heading and every ancestor hold the rest, and this line adds a word they
			// lack (so the parent with "duty" is not listed again for each child with "breach").
			const context = ancestorsOf(lines, i, Infinity, o);
			if (headingAt[i]! >= 0 && headingAt[i] !== i) context.push(headingAt[i]!);
			const inContext = words.map((_, k) => context.some((j) => patterns[k]!.test(lines[j]!)));
			if (!on.every((v, k) => v || inContext[k])) continue;
			if (!on.some((v, k) => v && !inContext[k])) continue;
		}
		out.push(build(lines, i, whole, headingAt[i]!, patterns, o));
		if (opts.limit > 0 && out.length >= opts.limit) break;
	}
	return out;
}

function build(lines: string[], i: number, whole: boolean, heading: number, patterns: RegExp[], opts: TreeMatchOptions): TreeMatch {
	const ancestors = ancestorsOf(lines, i, opts.ancestorLevels, opts);
	const showHeading = opts.showHeading && heading >= 0 && heading !== i && !ancestors.includes(heading);
	const off = showHeading ? 1 : 0;
	const line = (index: number, depth: number, match = false): TreeLine => {
		const text = displayLine(lines[index]!);
		const ranges = rangesIn(text, patterns);
		return { text, depth, ...(match ? { match } : {}), ...(ranges.length ? { ranges } : {}) };
	};
	const out: TreeLine[] = [];
	if (showHeading) out.push(line(heading, 0));
	ancestors.forEach((a, k) => out.push(line(a, k + off)));
	const depth = ancestors.length + off;
	out.push(line(i, depth, true));
	for (const c of childrenOf(lines, i, opts)) out.push(line(c.index, depth + c.depth));
	return { line: i, text: displayLine(lines[i]!), whole, lines: out };
}
