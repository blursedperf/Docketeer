/**
 * Citing in a note: the styles, and footnotes that pick the right form (full, Ibid, or a later reference
 * with "(n X)") from the footnotes already there.
 */
import { AGLC4 } from './aglc4';
import type { CitationStyle, Source } from './types';

export type { CitationStyle, FieldDef, Source, SourceKind, SourceKindDef } from './types';
export { AGLC4 } from './aglc4';

export const CITATION_STYLES: Record<string, CitationStyle> = { aglc4: AGLC4 };

export interface NoteFootnote { label: string; number: number; ref: number; text: string }

/** Footnotes in order of their references (numbered from 1), with their text. */
export function noteFootnotes(text: string): NoteFootnote[] {
	const defs = new Map<string, string>();
	for (const m of text.matchAll(/^ {0,3}\[\^([^\]\n]+)\]:[ \t]*(.*)$/gm)) defs.set(m[1]!, m[2]!);
	const seen = new Set<string>();
	const out: NoteFootnote[] = [];
	for (const m of text.matchAll(/\[\^([^\]\n]+)\](?!:)/g)) {
		// A definition line's own label is not a reference.
		const lineStart = text.lastIndexOf('\n', m.index - 1) + 1;
		if (/^ {0,3}$/.test(text.slice(lineStart, m.index)) && text[m.index + m[0].length] === ':') continue;
		if (seen.has(m[1]!)) continue;
		seen.add(m[1]!);
		out.push({ label: m[1]!, number: out.length + 1, ref: m.index, text: defs.get(m[1]!) ?? '' });
	}
	return out;
}

const plain = (s: string) => s.replace(/[*_]/g, '').replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim().toLowerCase();

/** Whether footnote text cites `s` (its full citation, or its short form referring back). */
function cites(style: CitationStyle, s: Source, fn: string): boolean {
	const t = plain(fn);
	return t.includes(plain(style.stem(s))) || (t.startsWith(plain(style.shortForm(s))) && /\(n \d+\)/.test(t));
}

/**
 * The footnote text for citing `s` at `cursor`: Ibid when the footnote before cites only this source
 * (following earlier Ibids back), a later reference "(n X)" when an earlier footnote cited it, else the
 * full citation. With a final full stop.
 */
export function planCitation(style: CitationStyle, text: string, cursor: number, s: Source, pin?: string): { form: 'full' | 'ibid' | 'subsequent'; body: string; n?: number } {
	const before = noteFootnotes(text).filter((f) => f.ref < cursor);
	const end = (b: string) => (/[.!?]$/.test(b) ? b : `${b}.`);
	const prev = before[before.length - 1];
	if (prev) {
		// Follow "Ibid" back to the footnote it repeats.
		let i = before.length - 1;
		while (i > 0 && /^ibid\b/i.test(before[i]!.text.trim())) i--;
		const src = before[i]!;
		const single = !/;/.test(src.text);
		if (single && cites(style, s, src.text)) return { form: 'ibid', body: end(style.ibid(s, pin)) };
	}
	const first = before.find((f) => plain(f.text).includes(plain(style.stem(s))));
	if (first) return { form: 'subsequent', body: end(style.subsequent(s, first.number, pin)), n: first.number };
	return { form: 'full', body: end(style.full(s, pin)) };
}

/**
 * Where to put a new footnote: the reference at `cursor` and the definition after the note's last
 * footnote (or at the end). Returns the changes in the original text's offsets, and the label.
 */
export function footnoteChanges(text: string, cursor: number, body: string): { label: string; changes: { from: number; to?: number; insert: string }[] } {
	const used = [...text.matchAll(/\[\^(\d+)\]/g)].map((m) => Number(m[1]));
	const label = String((used.length ? Math.max(...used) : 0) + 1);
	const trimmedEnd = text.replace(/\s+$/, '').length;
	const lastDef = /(?:^|\n) {0,3}\[\^[^\]\n]+\]:[^\n]*$/.test(text.slice(0, trimmedEnd));
	const sep = trimmedEnd === 0 ? '' : lastDef ? '\n' : '\n\n';
	return {
		label,
		changes: [
			{ from: cursor, insert: `[^${label}]` },
			{ from: trimmedEnd, to: text.length, insert: `${sep}[^${label}]: ${body}\n` },
		],
	};
}
