/**
 * Tables in the editor. In live preview, a table the cursor is not in is drawn as a table: click a cell to edit it
 * (the Markdown shows, with the cursor in that cell), and the + at its right edge and foot add a column or a row.
 * In a table being edited (live preview or source mode), Tab and Shift+Tab go to the next and previous cell, tidying
 * the table; Tab in the last cell adds a row. Commands add and delete rows and columns (see TableOp).
 */
import { type EditorState, type Extension, Prec, StateField } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, WidgetType, keymap } from '@codemirror/view';
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
// Live preview: tables drawn as tables

class TableWidget extends WidgetType {
	constructor(readonly source: string, readonly fromLine: number) { super(); }
	override eq(other: WidgetType): boolean { return other instanceof TableWidget && other.source === this.source && other.fromLine === this.fromLine; }

	toDOM(view: EditorView): HTMLElement {
		const t = parseTable(this.source.split('\n'));
		const wrap = document.createElement('div');
		wrap.className = 'cm-table-widget';
		const table = wrap.appendChild(document.createElement('table'));
		const goTo = (row: number, col: number) => (e: Event) => {
			e.preventDefault();
			const line = view.state.doc.line(this.fromLine + 1 + (row < 0 ? 0 : row + 2));
			view.dispatch({ selection: { anchor: line.from + cellStart(line.text, col) } });
			view.focus();
		};
		const head = table.createTHead().insertRow();
		t.header.forEach((c, i) => {
			const th = document.createElement('th');
			if (t.aligns[i]) th.style.textAlign = t.aligns[i]!;
			renderInlineInto(th, c);
			th.addEventListener('mousedown', goTo(-1, i));
			head.appendChild(th);
		});
		const body = table.createTBody();
		t.rows.forEach((r, ri) => {
			const tr = body.insertRow();
			r.forEach((c, i) => {
				const td = tr.insertCell();
				if (t.aligns[i]) td.style.textAlign = t.aligns[i]!;
				renderInlineInto(td, c);
				td.addEventListener('mousedown', goTo(ri, i));
			});
		});
		// The mouse's way to grow it: + at the right edge (a column) and at the foot (a row).
		const change = (next: Table) => (e: Event) => {
			e.preventDefault();
			e.stopPropagation();
			const doc = view.state.doc;
			const start = doc.line(this.fromLine + 1).from;
			const end = doc.line(this.fromLine + this.source.split('\n').length).to;
			view.dispatch({ changes: { from: start, to: end, insert: formatTable(next).join('\n') }, userEvent: 'input.table' });
		};
		const addCol = wrap.appendChild(document.createElement('button'));
		addCol.className = 'cm-table-add cm-table-add-column';
		addCol.type = 'button';
		addCol.textContent = '+';
		addCol.title = 'Add a column';
		addCol.setAttribute('aria-label', 'Add a column');
		addCol.addEventListener('mousedown', change(addColumn(t, t.header.length - 1)));
		const addR = wrap.appendChild(document.createElement('button'));
		addR.className = 'cm-table-add cm-table-add-row';
		addR.type = 'button';
		addR.textContent = '+';
		addR.title = 'Add a row';
		addR.setAttribute('aria-label', 'Add a row');
		addR.addEventListener('mousedown', change(addRow(t, t.rows.length - 1)));
		return wrap;
	}

	override ignoreEvent(): boolean { return true; }
}

function build(state: EditorState): DecorationSet {
	const all = lines(state);
	const decos = [];
	for (const t of allTables(all)) {
		const from = state.doc.line(t.from + 1).from;
		const to = state.doc.line(t.to + 1).to;
		// Being edited: the Markdown as written (with Tab between cells).
		if (state.selection.ranges.some((r) => r.from <= to && r.to >= from)) continue;
		decos.push(Decoration.replace({ widget: new TableWidget(all.slice(t.from, t.to + 1).join('\n'), t.from), block: true }).range(from, to));
	}
	return Decoration.set(decos);
}

/** Draw tables as tables in live preview, except the one being edited. */
export function tablePreview(): Extension {
	return StateField.define<DecorationSet>({
		create: build,
		update: (deco, tr) => (tr.docChanged || tr.selection ? build(tr.state) : deco),
		provide: (f) => EditorView.decorations.from(f),
	});
}
