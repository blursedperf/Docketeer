/**
 * Tables in the editor. In live preview a table stays drawn as a table, also while you type in it: each cell is
 * edited in place (showing its Markdown while it has the cursor) and every keystroke is written back to the note
 * with the columns lined up. Tab / Shift+Tab and the arrow keys move between cells, Enter goes down a row (adding one
 * at the foot), Escape leaves the table; the arrow keys enter it from the lines around it. The + at the right edge
 * and foot add a column or a row. In source mode the Markdown shows, and Tab and Shift+Tab go to the next and
 * previous cell, tidying the table. Commands add and delete rows and columns (see TableOp) in both.
 */
import { Annotation, type EditorState, type Extension, Prec, StateField } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, WidgetType, keymap } from '@codemirror/view';
import { redo, undo } from '@codemirror/commands';
import { renderInlineInto } from './markdown-render';
import { type Table, addColumn, addRow, allTables, cellStart, columnAt, deleteColumn, deleteRow, formatTable, parseTable, tableAt } from './tables';

export type TableOp = 'row-below' | 'row-above' | 'column-right' | 'column-left' | 'delete-row' | 'delete-column' | 'format' | 'next-cell' | 'previous-cell';

interface Here { from: number; to: number; table: Table; row: number; col: number }

const lines = (state: EditorState) => state.doc.toString().split('\n');

/** The table at the cursor: its lines (0-based), contents, and the cell (row -1 for the header). */
export function tableHere(state: EditorState): Here | null {
	const n = state.doc.lineAt(state.selection.main.head).number - 1;
	const all = lines(state);
	const at = tableAt(all, n);
	if (!at) return null;
	const line = state.doc.line(n + 1);
	const table = parseTable(all.slice(at.from, at.to + 1));
	const row = n === at.from || n === at.from + 1 ? -1 : n - at.from - 2;
	const col = Math.min(table.header.length - 1, columnAt(line.text, state.selection.main.head - line.from));
	return { ...at, table, row, col };
}

/** Write `t` over lines `from`..`to` and put the cursor in cell (`row`, `col`) (row -1: the header). */
function write(view: EditorView, from: number, to: number, t: Table, row: number, col: number): void {
	const doc = view.state.doc;
	const text = formatTable(t);
	const start = doc.line(from + 1).from;
	const end = doc.line(to + 1).to;
	const lineNo = row < 0 ? 0 : row + 2;
	const before = text.slice(0, lineNo).reduce((sum, l) => sum + l.length + 1, 0);
	const anchor = start + before + cellStart(text[lineNo]!, col);
	view.dispatch({ changes: { from: start, to: end, insert: text.join('\n') }, selection: { anchor }, scrollIntoView: true, userEvent: 'input.table' });
}

/** Do `op` on the table at the cursor; false when the cursor is not in one. */
export function tableOp(view: EditorView, op: TableOp): boolean {
	const h = tableHere(view.state);
	if (!h) return false;
	const { from, to, table: t, row, col } = h;
	const cols = t.header.length;
	switch (op) {
		case 'row-below': write(view, from, to, addRow(t, row), row + 1, col); break;
		case 'row-above': write(view, from, to, addRow(t, Math.max(-1, row - 1)), Math.max(0, row), col); break;
		case 'column-right': write(view, from, to, addColumn(t, col), row, col + 1); break;
		case 'column-left': write(view, from, to, addColumn(t, col - 1), row, col); break;
		case 'delete-row': if (row >= 0) write(view, from, to, deleteRow(t, row), Math.min(row, t.rows.length - 2), col); break;
		case 'delete-column': if (cols > 1) write(view, from, to, deleteColumn(t, col), row, Math.min(col, cols - 2)); break;
		case 'format': write(view, from, to, t, row, col); break;
		case 'next-cell':
			if (col < cols - 1) write(view, from, to, t, row, col + 1);
			else if (row < t.rows.length - 1) write(view, from, to, t, row + 1, 0);
			else write(view, from, to, addRow(t, row), row + 1, 0); // past the last cell: a new row
			break;
		case 'previous-cell':
			if (col > 0) write(view, from, to, t, row, col - 1);
			else if (row > -1) write(view, from, to, t, row - 1, cols - 1);
			else write(view, from, to, t, row, col);
			break;
	}
	return true;
}

/** Tab and Shift+Tab in a table: the next and previous cell. Elsewhere they do what they did. */
export function tableKeymap(): Extension {
	return Prec.high(keymap.of([
		{ key: 'Tab', run: (v) => (tableHere(v.state) ? tableOp(v, 'next-cell') : false) },
		{ key: 'Shift-Tab', run: (v) => (tableHere(v.state) ? tableOp(v, 'previous-cell') : false) },
	]));
}

// -------------------------------------------------------------------------------------------------
// Live preview: tables drawn as tables, edited in place

/** A change made from a cell (typing, or the selection following the cell): the cell keeps the keyboard. */
const fromCell = Annotation.define<boolean>();

/** A cell's Markdown as typed into it: one line, with | kept as text. */
const toSource = (typed: string) => typed.replace(/\r?\n/g, ' ').replace(/(?<!\\)\|/g, '\\|');
/** A cell's Markdown as shown while editing it (\| shows as |). */
const toTyped = (raw: string) => raw.replace(/\\\|/g, '|');

/** The table the widget `wrap` draws, as it is in the note now. */
function tableOf(view: EditorView, wrap: HTMLElement): { from: number; to: number; table: Table } | null {
	let pos: number;
	try { pos = view.posAtDOM(wrap); } catch { return null; }
	const all = lines(view.state);
	const at = tableAt(all, view.state.doc.lineAt(pos).number - 1);
	return at ? { ...at, table: parseTable(all.slice(at.from, at.to + 1)) } : null;
}

const cellEl = (wrap: HTMLElement, row: number, col: number) => wrap.querySelector<HTMLElement>(`[data-row="${row}"][data-col="${col}"]`);
const cellPos = (el: HTMLElement) => ({ row: Number(el.dataset.row), col: Number(el.dataset.col) });

/** Put the keyboard in a cell, the caret at its end (or at `offset`). */
/** Tables being redrawn inside an editor update: their cells' focus must not dispatch until the update is over. */
const redrawing = new WeakSet<HTMLElement>();

function focusCell(wrap: HTMLElement, row: number, col: number, offset?: number): boolean {
	const el = cellEl(wrap, row, col);
	if (!el) return false;
	el.focus({ preventScroll: true });
	el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
	const text = el.firstChild;
	const sel = window.getSelection();
	if (sel) {
		const r = document.createRange();
		if (text && text.nodeType === Node.TEXT_NODE) r.setStart(text, Math.min(offset ?? text.textContent!.length, text.textContent!.length));
		else r.selectNodeContents(el);
		r.collapse(offset === 0);
		sel.removeAllRanges();
		sel.addRange(r);
	}
	return true;
}

/** Where the caret is in a focused cell's text. */
function caretOffset(el: HTMLElement): number {
	const sel = window.getSelection();
	if (!sel || !sel.rangeCount || !el.contains(sel.anchorNode)) return el.textContent?.length ?? 0;
	const r = document.createRange();
	r.selectNodeContents(el);
	r.setEnd(sel.anchorNode!, sel.anchorOffset);
	return r.toString().length;
}

/** Fill `wrap` with the table: header and body cells, each editable, showing its Markdown rendered until edited. */
function draw(wrap: HTMLElement, t: Table): void {
	wrap.querySelector('table')?.remove();
	const table = document.createElement('table');
	wrap.prepend(table);
	const cell = (tag: 'th' | 'td', raw: string, row: number, col: number) => {
		const el = document.createElement(tag);
		el.contentEditable = 'plaintext-only';
		el.spellcheck = true;
		el.dataset.row = String(row);
		el.dataset.col = String(col);
		el.dataset.raw = raw;
		if (t.aligns[col]) el.style.textAlign = t.aligns[col]!;
		if (raw) renderInlineInto(el, raw);
		el.setAttribute('aria-label', row < 0 ? `Column ${col + 1} heading` : `Row ${row + 1}, column ${col + 1}`);
		return el;
	};
	const head = table.createTHead().insertRow();
	t.header.forEach((c, i) => head.appendChild(cell('th', c, -1, i)));
	const body = table.createTBody();
	t.rows.forEach((r, ri) => { const tr = body.insertRow(); r.forEach((c, i) => tr.appendChild(cell('td', c, ri, i))); });
}

/** Write `next` over the table at from..to (lines), the note's selection in cell (row, col). */
function writeTable(view: EditorView, from: number, to: number, next: Table, row: number, col: number, keep: boolean): void {
	const doc = view.state.doc;
	const text = formatTable(next);
	const start = doc.line(from + 1).from;
	const end = doc.line(to + 1).to;
	const lineNo = row < 0 ? 0 : row + 2;
	const before = text.slice(0, lineNo).reduce((sum, l) => sum + l.length + 1, 0);
	const anchor = start + before + cellStart(text[lineNo]!, col);
	view.dispatch({ changes: { from: start, to: end, insert: text.join('\n') }, selection: { anchor }, userEvent: 'input.table', annotations: fromCell.of(keep) });
}

class TableWidget extends WidgetType {
	constructor(readonly source: string) { super(); }
	override eq(other: WidgetType): boolean { return other instanceof TableWidget && other.source === this.source; }

	toDOM(view: EditorView): HTMLElement {
		const wrap = document.createElement('div');
		wrap.className = 'cm-table-widget';
		draw(wrap, parseTable(this.source.split('\n')));
		this.wire(view, wrap);
		return wrap;
	}

	/**
	 * The note's table changed. Typing in a cell changes only that cell (the rest is lining up), so the cells stay as
	 * they are and keep the caret; anything else (undo, a row added) draws the table again, the keyboard staying in the
	 * same cell.
	 */
	override updateDOM(wrap: HTMLElement): boolean {
		const t = parseTable(this.source.split('\n'));
		const cells = [...wrap.querySelectorAll<HTMLElement>('[data-row]')];
		const same = cells.length === t.header.length * (t.rows.length + 1) && cells.every((el) => {
			const { row, col } = cellPos(el);
			return (row < 0 ? t.header[col] : t.rows[row]?.[col]) === el.dataset.raw;
		});
		if (same) return true;
		const active = document.activeElement instanceof HTMLElement && wrap.contains(document.activeElement) ? document.activeElement : null;
		const at = active?.dataset.row !== undefined ? { ...cellPos(active), offset: caretOffset(active) } : null;
		draw(wrap, t);
		if (at) {
			const row = Math.min(at.row, t.rows.length - 1);
			const col = Math.min(at.col, t.header.length - 1);
			const el = cellEl(wrap, row, col);
			if (el) {
				el.textContent = toTyped(el.dataset.raw ?? '');
				// Focusing runs focusin at once in WebKit, inside this update: follow() waits for it to end.
				redrawing.add(wrap);
				try { focusCell(wrap, row, col, at.offset); } finally { redrawing.delete(wrap); }
			}
		}
		return true;
	}

	private wire(view: EditorView, wrap: HTMLElement): void {
		const cellOf = (e: Event) => (e.target as HTMLElement).closest<HTMLElement>('[data-row]');
		/** Keep the note's selection in the cell being edited, so the table commands (and Alt+Enter) act on it. */
		const follow = (el: HTMLElement) => {
			const t = tableOf(view, wrap);
			if (!t) return;
			const { row, col } = cellPos(el);
			const line = view.state.doc.line(t.from + 1 + (row < 0 ? 0 : row + 2));
			view.dispatch({ selection: { anchor: line.from + cellStart(line.text, col) }, annotations: fromCell.of(true) });
		};
		/** follow(), but after the editor update in progress when the table is being redrawn (updateDOM). */
		const followSoon = (el: HTMLElement) => {
			if (redrawing.has(wrap)) queueMicrotask(() => { if (el.isConnected) follow(el); });
			else follow(el);
		};
		wrap.addEventListener('focusin', (e) => {
			const el = cellOf(e);
			if (!el) return;
			wrap.classList.add('is-editing');
			// The cell's Markdown while it has the cursor (**bold** rather than bold).
			if (el.dataset.editing !== 'true') { el.dataset.editing = 'true'; el.textContent = toTyped(el.dataset.raw ?? ''); }
			followSoon(el);
		});
		wrap.addEventListener('focusout', (e) => {
			const el = cellOf(e);
			if (!el) return;
			delete el.dataset.editing;
			el.textContent = '';
			if (el.dataset.raw) renderInlineInto(el, el.dataset.raw);
			if (!wrap.contains(e.relatedTarget as Node | null)) wrap.classList.remove('is-editing');
		});
		wrap.addEventListener('input', (e) => {
			const el = cellOf(e);
			const t = tableOf(view, wrap);
			if (!el || !t) return;
			const { row, col } = cellPos(el);
			const raw = toSource(el.textContent ?? '');
			el.dataset.raw = raw;
			const next: Table = { ...t.table, header: [...t.table.header], rows: t.table.rows.map((r) => [...r]) };
			if (row < 0) next.header[col] = raw;
			else next.rows[row]![col] = raw;
			writeTable(view, t.from, t.to, next, row, col, true);
		});
		wrap.addEventListener('keydown', (e) => {
			const el = cellOf(e);
			const t = tableOf(view, wrap);
			if (!el || !t) return;
			const { row, col } = cellPos(el);
			const cols = t.table.header.length;
			const last = t.table.rows.length - 1;
			const mod = e.metaKey || e.ctrlKey;
			const go = (r: number, c: number, offset?: number) => { e.preventDefault(); focusCell(wrap, r, c, offset); };
			const text = el.textContent ?? '';
			const caret = caretOffset(el);
			if (mod && !e.altKey && (e.key === 'z' || e.key === 'Z' || e.key === 'y')) {
				e.preventDefault();
				if (e.key === 'y' || e.shiftKey) redo(view); else undo(view);
				return;
			}
			if (e.altKey || mod) return; // Alt+Enter and the like: the table commands, through the app's keys.
			switch (e.key) {
				case 'Tab':
					if (e.shiftKey) {
						if (col > 0) go(row, col - 1);
						else if (row > -1) go(row - 1, cols - 1);
						else e.preventDefault();
					} else if (col < cols - 1) go(row, col + 1);
					else if (row < last) go(row + 1, 0);
					else { e.preventDefault(); writeTable(view, t.from, t.to, addRow(t.table, row), row + 1, 0, false); }
					return;
				case 'Enter':
					if (e.shiftKey) { e.preventDefault(); return; }
					if (row < last) go(row + 1, col, 0);
					else { e.preventDefault(); writeTable(view, t.from, t.to, addRow(t.table, Math.max(row, last)), Math.max(row, last) + 1, col, false); }
					return;
				case 'ArrowUp':
					if (row > -1) go(row - 1, col, caret);
					else { e.preventDefault(); leave(view, t, 'before'); }
					return;
				case 'ArrowDown':
					if (row < last) go(row + 1, col, caret);
					else { e.preventDefault(); leave(view, t, 'after'); }
					return;
				case 'ArrowLeft':
					if (caret > 0 || window.getSelection()?.isCollapsed === false) return;
					if (col > 0) go(row, col - 1);
					else if (row > -1) go(row - 1, cols - 1);
					else { e.preventDefault(); leave(view, t, 'before'); }
					return;
				case 'ArrowRight':
					if (caret < text.length || window.getSelection()?.isCollapsed === false) return;
					if (col < cols - 1) go(row, col + 1, 0);
					else if (row < last) go(row + 1, 0, 0);
					else { e.preventDefault(); leave(view, t, 'after'); }
					return;
				case 'Escape':
					e.preventDefault();
					leave(view, t, 'after');
					return;
			}
		});
		// The mouse's way to grow it: + at the right edge (a column) and at the foot (a row).
		const grow = (cls: string, title: string, change: (t: Table) => Table) => {
			const b = wrap.appendChild(document.createElement('button'));
			b.className = `cm-table-add ${cls}`;
			b.type = 'button';
			b.textContent = '+';
			b.title = title;
			b.setAttribute('aria-label', title);
			b.tabIndex = -1;
			b.addEventListener('mousedown', (e) => {
				e.preventDefault();
				e.stopPropagation();
				const t = tableOf(view, wrap);
				if (!t) return;
				const doc = view.state.doc;
				view.dispatch({ changes: { from: doc.line(t.from + 1).from, to: doc.line(t.to + 1).to, insert: formatTable(change(t.table)).join('\n') }, userEvent: 'input.table', annotations: fromCell.of(true) });
			});
		};
		grow('cm-table-add-column', 'Add a column', (t) => addColumn(t, t.header.length - 1));
		grow('cm-table-add-row', 'Add a row', (t) => addRow(t, t.rows.length - 1));
	}

	override ignoreEvent(): boolean { return true; }
}

/** Leave the table for the line before or after it (making an empty line after a table that ends the note). */
function leave(view: EditorView, t: { from: number; to: number }, where: 'before' | 'after'): void {
	const doc = view.state.doc;
	if (where === 'before') {
		const anchor = t.from > 0 ? doc.line(t.from).to : doc.line(1).from;
		view.dispatch({ selection: { anchor }, scrollIntoView: true, annotations: fromCell.of(true) });
	} else if (t.to + 2 <= doc.lines) {
		view.dispatch({ selection: { anchor: doc.line(t.to + 2).from }, scrollIntoView: true, annotations: fromCell.of(true) });
	} else {
		const end = doc.line(t.to + 1).to;
		view.dispatch({ changes: { from: end, insert: '\n' }, selection: { anchor: end + 1 }, scrollIntoView: true, annotations: fromCell.of(true) });
	}
	view.focus();
}

function build(state: EditorState): DecorationSet {
	const all = lines(state);
	const decos = [];
	for (const t of allTables(all)) {
		const from = state.doc.line(t.from + 1).from;
		const to = state.doc.line(t.to + 1).to;
		decos.push(Decoration.replace({ widget: new TableWidget(all.slice(t.from, t.to + 1).join('\n')), block: true }).range(from, to));
	}
	return Decoration.set(decos);
}

/** The widget drawing the table that starts at `pos`, if it is on screen. */
function widgetAt(view: EditorView, pos: number): HTMLElement | null {
	for (const w of view.contentDOM.querySelectorAll<HTMLElement>('.cm-table-widget')) {
		try { if (view.posAtDOM(w) === pos) return w; } catch { /* not in the view */ }
	}
	return null;
}

/**
 * The keyboard follows the note's selection into a table: when something puts the cursor in one (a table command,
 * a search result, undo), the matching cell takes the keyboard.
 */
const followSelection = ViewPlugin.fromClass(class {
	update(u: ViewUpdate) {
		if (!u.selectionSet || u.transactions.some((tr) => tr.annotation(fromCell))) return;
		if (!u.view.hasFocus && !u.transactions.some((tr) => tr.isUserEvent('input.table'))) return;
		const sel = u.state.selection.main;
		if (!sel.empty) return;
		const here = tableHere(u.state);
		if (!here) return;
		const start = u.state.doc.line(here.from + 1).from;
		const view = u.view;
		requestAnimationFrame(() => { const w = widgetAt(view, start); if (w) focusCell(w, here.row, here.col); });
	}
});

/** The arrow keys go into a table from the line above or below it (the cursor would jump over it otherwise). */
const enterKeys = Prec.high(keymap.of([
	{ key: 'ArrowDown', run: (v) => enter(v, true) },
	{ key: 'ArrowUp', run: (v) => enter(v, false) },
]));

function enter(view: EditorView, down: boolean): boolean {
	const sel = view.state.selection.main;
	if (!sel.empty) return false;
	const target = view.moveVertically(sel, down).head;
	const all = lines(view.state);
	for (const t of allTables(all)) {
		const from = view.state.doc.line(t.from + 1).from;
		const to = view.state.doc.line(t.to + 1).to;
		const crosses = down ? sel.head < from && target >= from : sel.head > to && target <= to;
		if (!crosses) continue;
		const w = widgetAt(view, from);
		if (!w) return false;
		const rows = t.to - t.from - 1; // body rows
		return focusCell(w, down ? -1 : rows - 1, 0);
	}
	return false;
}

/** Draw tables as tables in live preview, edited in place. */
export function tablePreview(): Extension {
	return [
		StateField.define<DecorationSet>({
			create: build,
			update: (deco, tr) => (tr.docChanged ? build(tr.state) : deco),
			provide: (f) => EditorView.decorations.from(f),
		}),
		followSelection,
		enterKeys,
	];
}
