/**
 * Properties (YAML frontmatter) in live preview: drawn as the same key/value table as in reading view while the
 * cursor is elsewhere, and shown as written once the cursor moves into it (or the table is clicked). YAML that
 * does not parse is always shown as written, so the mistake can be seen.
 */
import { type EditorState, type Extension, StateField } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, WidgetType } from '@codemirror/view';
import { parseFrontMatter, splitFrontMatter } from './metadata';

/** The frontmatter block's range in the document, fences included, or null. */
export function frontmatterRange(state: EditorState): { from: number; to: number; firstValue: number } | null {
	const doc = state.doc;
	if (doc.lines < 2 || doc.line(1).text !== '---') return null;
	const { yaml, end } = splitFrontMatter(doc.sliceString(0, Math.min(doc.length, 20000)));
	if (yaml === null || end === 0) return null;
	// `end` is after the closing fence's line break, if any: the block ends with the fence itself.
	const closing = doc.lineAt(Math.max(0, end - 1));
	const to = closing.text.startsWith('---') ? closing.to : doc.lineAt(end).to;
	return { from: 0, to, firstValue: doc.line(2).from };
}

/** The table's rows: each key with its value as text (lists joined with commas). */
export function propertyRows(state: EditorState): [string, string][] | null {
	const fm = parseFrontMatter(state.doc.sliceString(0, Math.min(state.doc.length, 20000)));
	if (!fm || Object.keys(fm).length === 0) return null;
	return Object.entries(fm).map(([k, v]) => [k, Array.isArray(v) ? v.join(', ') : typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v ?? '')]);
}

class PropertiesWidget extends WidgetType {
	constructor(readonly rows: [string, string][], readonly firstValue: number) { super(); }
	override eq(other: WidgetType): boolean {
		return other instanceof PropertiesWidget && JSON.stringify(other.rows) === JSON.stringify(this.rows);
	}
	toDOM(view: EditorView): HTMLElement {
		const box = document.createElement('div');
		box.className = 'metadata-container cm-properties';
		box.setAttribute('role', 'button');
		box.setAttribute('aria-label', 'Properties: click to edit');
		box.title = 'Click to edit the properties';
		for (const [k, v] of this.rows) {
			const row = box.appendChild(document.createElement('div'));
			row.className = 'metadata-property';
			const key = row.appendChild(document.createElement('div'));
			key.className = 'metadata-property-key';
			key.textContent = k;
			const value = row.appendChild(document.createElement('div'));
			value.className = 'metadata-property-value';
			value.textContent = v;
		}
		box.addEventListener('mousedown', (e) => {
			e.preventDefault();
			view.dispatch({ selection: { anchor: this.firstValue } });
			view.focus();
		});
		return box;
	}
	override ignoreEvent(): boolean { return true; }
}

function build(state: EditorState): DecorationSet {
	const range = frontmatterRange(state);
	if (!range) return Decoration.none;
	// Being edited: the YAML as written. A cursor at the very start is where a note opens, not editing.
	const editing = state.selection.ranges.some((r) => !(r.empty && r.head === 0) && r.from <= range.to && r.to >= range.from);
	if (editing) return Decoration.none;
	const rows = propertyRows(state);
	if (!rows) return Decoration.none;
	return Decoration.set([Decoration.replace({ widget: new PropertiesWidget(rows, range.firstValue), block: true }).range(range.from, range.to)]);
}

/** Show a note's properties as a table, except while they are being edited. */
export function propertiesPreview(): Extension {
	return StateField.define<DecorationSet>({
		create: build,
		update: (deco, tr) => (tr.docChanged || tr.selection ? build(tr.state) : deco),
		provide: (f) => EditorView.decorations.from(f),
	});
}
