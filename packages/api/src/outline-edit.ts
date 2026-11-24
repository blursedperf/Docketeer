/**
 * Outline edits on a note's text: move a section (a heading with everything under it) above or below
 * its neighbour, and promote or demote a heading with its subheadings. Pure, so it is unit-tested.
 */

export interface OutlineHeading { line: number; level: number; text: string }

/** Headings by line, skipping fenced code and frontmatter. */
export function outlineHeadings(text: string): OutlineHeading[] {
	const lines = text.split('\n');
	const out: OutlineHeading[] = [];
	let fence: string | null = null;
	let i = 0;
	if (lines[0] === '---') { i = lines.indexOf('---', 1) + 1 || 0; }
	for (; i < lines.length; i++) {
		const l = lines[i]!;
		const f = /^ {0,3}(`{3,}|~{3,})/.exec(l);
		if (f) { if (!fence) fence = f[1]!; else if (l.trim().startsWith(fence)) fence = null; continue; }
		if (fence) continue;
		const h = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(l);
		if (h) out.push({ line: i, level: h[1]!.length, text: h[2]! });
	}
	return out;
}

/** The lines a section covers: from its heading to before the next heading of the same or a higher level. */
function sectionEnd(heads: OutlineHeading[], idx: number, lineCount: number): number {
	const h = heads[idx]!;
	for (let j = idx + 1; j < heads.length; j++) if (heads[j]!.level <= h.level) return heads[j]!.line;
	return lineCount;
}

/**
 * Move the section at `line` past its previous (dir -1) or next (dir 1) sibling. Returns the new text and
 * the heading's new line, or null when there is no sibling that way.
 */
export function moveSection(text: string, line: number, dir: -1 | 1): { text: string; line: number } | null {
	const lines = text.split('\n');
	const heads = outlineHeadings(text);
	const idx = heads.findIndex((h) => h.line === line);
	if (idx < 0) return null;
	const me = heads[idx]!;
	const end = sectionEnd(heads, idx, lines.length);
	if (dir === 1) {
		const nextIdx = heads.findIndex((h, j) => j > idx && h.line >= end);
		const next = heads[nextIdx];
		if (!next || next.level !== me.level) return null;
		const nextEnd = sectionEnd(heads, nextIdx, lines.length);
		const mine = lines.slice(me.line, end);
		const theirs = lines.slice(end, nextEnd);
		const out = [...lines.slice(0, me.line), ...withBreak(theirs), ...mine, ...lines.slice(nextEnd)];
		return { text: tidyEnd(out, text), line: me.line + withBreak(theirs).length };
	}
	// Previous sibling: the nearest earlier heading of the same level with no higher heading in between.
	let prevIdx = -1;
	for (let j = idx - 1; j >= 0; j--) {
		if (heads[j]!.level < me.level) break;
		if (heads[j]!.level === me.level) { prevIdx = j; break; }
	}
	if (prevIdx < 0) return null;
	const prev = heads[prevIdx]!;
	const theirs = lines.slice(prev.line, me.line);
	const mine = lines.slice(me.line, end);
	const out = [...lines.slice(0, prev.line), ...withBreak(mine), ...theirs, ...lines.slice(end)];
	return { text: tidyEnd(out, text), line: prev.line };
}

/** A section moved before another needs a blank line after it. */
function withBreak(block: string[]): string[] {
	return block.length && block[block.length - 1]!.trim() !== '' ? [...block, ''] : block;
}

/** Keep the note's final newline (or lack of one), and don't leave doubled blank lines at the end. */
function tidyEnd(lines: string[], original: string): string {
	let out = lines.join('\n').replace(/\n{3,}/g, '\n\n');
	out = out.replace(/\n+$/, '');
	return original.endsWith('\n') ? `${out}\n` : out;
}

/** Promote (-1) or demote (+1) the heading at `line` and its subheadings. Null when a level would leave 1–6. */
export function shiftLevel(text: string, line: number, delta: -1 | 1): string | null {
	const lines = text.split('\n');
	const heads = outlineHeadings(text);
	const idx = heads.findIndex((h) => h.line === line);
	if (idx < 0) return null;
	const end = sectionEnd(heads, idx, lines.length);
	const inside = heads.filter((h) => h.line >= line && h.line < end);
	if (inside.some((h) => h.level + delta < 1 || h.level + delta > 6)) return null;
	for (const h of inside) lines[h.line] = lines[h.line]!.replace(/^#+/, '#'.repeat(h.level + delta));
	return lines.join('\n');
}

/** The fields of a case brief, in order. */
export const BRIEF_FIELDS = ['Facts', 'Issues', 'Held', 'Ratio', 'Obiter'] as const;

/** Whether a note is a case brief: `type: case-brief`, a case-brief tag, or three of the field headings. */
export function isCaseBrief(frontmatter: Record<string, unknown> | undefined, headings: { text: string }[]): boolean {
	const type = String(frontmatter?.type ?? '').toLowerCase();
	const tags = ([] as unknown[]).concat(frontmatter?.tags ?? []).map((t) => String(t).toLowerCase().replace(/^#/, ''));
	if (type === 'case-brief' || type === 'case brief' || tags.includes('case-brief')) return true;
	const names = new Set(headings.map((h) => h.text.trim().toLowerCase()));
	return BRIEF_FIELDS.filter((f) => names.has(f.toLowerCase())).length >= 3;
}

/** Add a missing field as a level-2 heading at the end (or after the last brief field). */
export function addBriefField(text: string, field: string): { text: string; line: number } {
	const body = text.replace(/\n+$/, '');
	const out = `${body}\n\n## ${field}\n\n`;
	return { text: out, line: out.split('\n').length - 3 };
}
