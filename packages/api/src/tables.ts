/**
 * Markdown (GFM) tables as data: find the one at a line, read it, change it, and write it back tidily with its
 * columns lined up. Pure (no editor, no DOM), tested on its own; tables-editor.ts draws and edits them.
 *
 *   | Case | Year |
 *   | --- | ---: |
 *   | Mabo | 1992 |
 */

export type Align = 'left' | 'center' | 'right' | null;

export interface Table {
	header: string[];
	aligns: Align[];
	rows: string[][];
}

const DELIMITER = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/;

/** The cells of one table line ("| a | b |" → ["a", "b"]); `\|` stays in a cell. */
export function splitRow(line: string): string[] {
	let s = line.trim();
	if (s.startsWith('|')) s = s.slice(1);
	if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
	const cells: string[] = [];
	let cell = '';
	for (let i = 0; i < s.length; i++) {
		const ch = s[i]!;
		if (ch === '\\' && s[i + 1] === '|') { cell += '\\|'; i++; continue; }
		if (ch === '|') { cells.push(cell.trim()); cell = ''; continue; }
		cell += ch;
	}
	cells.push(cell.trim());
	return cells;
}

/** Whether `line` could be a row of a table (it has a pipe outside code). */
export function isTableLine(line: string): boolean {
	return /\|/.test(line) && line.trim() !== '';
}

/** Whether lines[i] and lines[i + 1] start a table: a row, then a delimiter row with as many cells. */
function startsTable(lines: string[], i: number): boolean {
	const head = lines[i];
	const delim = lines[i + 1];
	if (head === undefined || delim === undefined || !isTableLine(head) || !DELIMITER.test(delim)) return false;
	return splitRow(head).length === splitRow(delim).length;
}

/** The table that line `n` (0-based) is part of: its first and last line, or null. */
export function tableAt(lines: string[], n: number): { from: number; to: number } | null {
	if (!isTableLine(lines[n] ?? '')) return null;
	let from = n;
	while (from > 0 && isTableLine(lines[from - 1]!)) from--;
	// The header is the line before the delimiter row.
	for (let h = from; h <= n; h++) {
		if (startsTable(lines, h)) {
			let to = h + 1;
			while (to + 1 < lines.length && isTableLine(lines[to + 1]!)) to++;
			return n >= h ? { from: h, to } : null;
		}
	}
	return null;
}

/** Every table in `lines`, top to bottom. */
export function allTables(lines: string[]): { from: number; to: number }[] {
	const out: { from: number; to: number }[] = [];
	for (let i = 0; i < lines.length - 1; i++) {
		if (!startsTable(lines, i)) continue;
		let to = i + 1;
		while (to + 1 < lines.length && isTableLine(lines[to + 1]!)) to++;
		out.push({ from: i, to });
		i = to;
	}
	return out;
}

export function parseTable(lines: string[]): Table {
	const header = splitRow(lines[0] ?? '');
	const aligns = splitRow(lines[1] ?? '').map((d): Align => {
		const l = d.startsWith(':');
		const r = d.endsWith(':');
		return l && r ? 'center' : r ? 'right' : l ? 'left' : null;
	});
	const width = header.length;
	const rows = lines.slice(2).map((l) => {
		const cells = splitRow(l);
		return Array.from({ length: width }, (_, i) => cells[i] ?? '');
	});
	return { header, aligns: Array.from({ length: width }, (_, i) => aligns[i] ?? null), rows };
}

/** Characters a cell takes on screen, roughly (wide characters count twice). */
function width(s: string): number {
	let w = 0;
	for (const ch of s) w += /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/.test(ch) ? 2 : 1;
	return w;
}

/** The table written back with its columns lined up. */
export function formatTable(t: Table): string[] {
	const cols = t.header.length;
	const widths = Array.from({ length: cols }, (_, c) => Math.max(3, width(t.header[c] ?? ''), ...t.rows.map((r) => width(r[c] ?? ''))));
	const pad = (s: string, c: number) => {
		const gap = widths[c]! - width(s);
		if (t.aligns[c] === 'right') return ' '.repeat(gap) + s;
		if (t.aligns[c] === 'center') return ' '.repeat(Math.floor(gap / 2)) + s + ' '.repeat(Math.ceil(gap / 2));
		return s + ' '.repeat(gap);
	};
	const line = (cells: string[]) => `| ${cells.map((s, c) => pad(s, c)).join(' | ')} |`;
	const delim = `| ${widths.map((w, c) => {
		const a = t.aligns[c];
		if (a === 'center') return `:${'-'.repeat(w - 2)}:`;
		if (a === 'right') return `${'-'.repeat(w - 1)}:`;
		if (a === 'left') return `:${'-'.repeat(w - 1)}`;
		return '-'.repeat(w);
	}).join(' | ')} |`;
	return [line(t.header), delim, ...t.rows.map(line)];
}

/** A new empty row after body row `after` (-1: first). */
export function addRow(t: Table, after: number): Table {
	const rows = [...t.rows];
	rows.splice(after + 1, 0, t.header.map(() => ''));
	return { ...t, rows };
}

/** A new empty column after column `after` (-1: first). */
export function addColumn(t: Table, after: number, name = ''): Table {
	const at = after + 1;
	const ins = <T>(list: T[], v: T) => { const out = [...list]; out.splice(at, 0, v); return out; };
	return { header: ins(t.header, name), aligns: ins(t.aligns, null as Align), rows: t.rows.map((r) => ins(r, '')) };
}

export function deleteRow(t: Table, row: number): Table {
	return { ...t, rows: t.rows.filter((_, i) => i !== row) };
}

export function deleteColumn(t: Table, col: number): Table {
	if (t.header.length <= 1) return t;
	const del = <T>(list: T[]) => list.filter((_, i) => i !== col);
	return { header: del(t.header), aligns: del(t.aligns), rows: t.rows.map(del) };
}

/** The column the character at `ch` in a table line is in (0-based). */
export function columnAt(line: string, ch: number): number {
	let col = -1;
	const lead = line.length - line.trimStart().length;
	const starts = line.trimStart().startsWith('|');
	if (!starts) col = 0;
	for (let i = 0; i < Math.min(ch, line.length); i++) {
		if (line[i] === '\\' && line[i + 1] === '|') { i++; continue; }
		if (line[i] === '|' && i >= lead) col++;
	}
	return Math.max(0, col);
}

/** Where the text of column `col` starts in a formatted table line ("| ab | cd |", 1 → 7). */
export function cellStart(line: string, col: number): number {
	let seen = line.trimStart().startsWith('|') ? -1 : 0;
	if (seen === 0 && col === 0) return line.length - line.trimStart().length;
	for (let i = 0; i < line.length; i++) {
		if (line[i] === '\\' && line[i + 1] === '|') { i++; continue; }
		if (line[i] !== '|') continue;
		seen++;
		if (seen === col) {
			let j = i + 1;
			while (line[j] === ' ') j++;
			return Math.min(j, line.length);
		}
	}
	return line.length;
}
