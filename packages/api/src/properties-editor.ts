/**
 * Properties (YAML frontmatter) in live preview, edited in place: each property is a row with its name and a
 * field for its value, chosen by what the value is (a list of chips, a checkbox, a number, a date or text).
 * Names and values are suggested from the ones used in the homebase's other notes. "+ Add property" adds a row;
 * a new property's field is the kind that name usually has elsewhere.
 *
 * Every change is written into the note's YAML at once (comments and order kept). "Edit as YAML", or moving the
 * cursor into the block, shows the YAML as written; YAML that does not parse is always shown as written, so the
 * mistake can be seen.
 */
import { type EditorState, type Extension, StateField } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, WidgetType } from '@codemirror/view';
import { type Document, isMap, isScalar, parseDocument } from 'yaml';
import { setIcon } from './icons';
import { InputSuggest } from './input-suggest';
import { type PropertyType, parseFrontMatter, propertyType, splitFrontMatter } from './metadata';

/** Where suggestions come from: the homebase's notes. */
export interface PropertySource {
	keys(): { key: string; type: PropertyType }[];
	values(key: string): string[];
}

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

// -------------------------------------------------------------------------------------------------
// Changing the YAML

export type PropertyEdit =
	| { op: 'set'; key: string; value: unknown }
	| { op: 'rename'; from: string; to: string }
	| { op: 'delete'; key: string };

/** A value for the YAML: a date field's "2026-11-26" stays a plain string, as it was typed. */
function emptyValue(type: PropertyType): unknown {
	return type === 'list' ? [] : type === 'checkbox' ? false : null;
}

/** `yaml` (the frontmatter, without its fences) with `edit` made; comments, order and the other values kept. */
export function editFrontmatter(yaml: string, edit: PropertyEdit): string {
	const doc: Document = parseDocument(yaml);
	if (doc.errors.length) throw new Error('The properties are not valid YAML.');
	if (!isMap(doc.contents)) doc.contents = doc.createNode({}) as typeof doc.contents;
	const map = doc.contents as unknown as { items: { key: unknown; value: unknown }[] };
	switch (edit.op) {
		case 'set': doc.set(edit.key, edit.value); break;
		case 'delete': doc.delete(edit.key); break;
		case 'rename': {
			if (edit.to === edit.from) break;
			if (doc.has(edit.to)) throw new Error(`There is already a property called "${edit.to}".`);
			const pair = map.items.find((p) => (isScalar(p.key) ? p.key.value : p.key) === edit.from);
			if (pair) pair.key = doc.createNode(edit.to);
			break;
		}
	}
	if (map.items.length === 0) return '';
	return doc.toString({ lineWidth: 0, nullStr: '' });
}

/** Make `edit` in the note shown in `view`, as one undoable change. Returns false when it could not be made. */
function apply(view: EditorView, edit: PropertyEdit): boolean {
	const range = frontmatterRange(view.state);
	if (!range) return false;
	const text = view.state.sliceDoc(range.from, range.to);
	const yaml = splitFrontMatter(`${text}\n`).yaml ?? '';
	let next: string;
	try { next = editFrontmatter(yaml, edit); } catch { return false; }
	const block = `---\n${next}${next && !next.endsWith('\n') ? '\n' : ''}---`;
	if (block === text) return true;
	view.dispatch({ changes: { from: range.from, to: range.to, insert: block }, userEvent: 'input.property' });
	return true;
}

// -------------------------------------------------------------------------------------------------
// The table

/**
 * The field to focus once the table is drawn again after a change (each change redraws it): a property's name
 * or value, or a new row.
 */
let pendingFocus: { key: string; part: 'key' | 'value' } | { part: 'add' } | null = null;

class PropertiesWidget extends WidgetType {
	constructor(readonly entries: [string, unknown][], readonly source: PropertySource | undefined) { super(); }

	override eq(other: WidgetType): boolean {
		return other instanceof PropertiesWidget && JSON.stringify(other.entries) === JSON.stringify(this.entries);
	}

	toDOM(view: EditorView): HTMLElement {
		const box = createDiv({ cls: 'metadata-container cm-properties', attr: { role: 'group', 'aria-label': 'Properties' } });
		const rows = box.createDiv({ cls: 'metadata-properties' });
		for (const [key, value] of this.entries) this.row(view, rows, key, value);
		const foot = box.createDiv({ cls: 'metadata-add' });
		const add = foot.createEl('button', { cls: 'metadata-add-button', text: '+ Add property' });
		add.addEventListener('click', () => this.newRow(view, rows));
		const yamlBtn = foot.createEl('button', { cls: 'metadata-yaml-button clickable-icon', attr: { 'aria-label': 'Edit as YAML', title: 'Edit as YAML' } });
		setIcon(yamlBtn, 'code');
		yamlBtn.addEventListener('click', () => {
			const range = frontmatterRange(view.state);
			view.dispatch({ selection: { anchor: range && range.to > 4 ? view.state.doc.line(2).from : 0 } });
			view.focus();
		});
		box.addEventListener('mousedown', (e) => { if (e.target === box) e.preventDefault(); });

		const focus = pendingFocus;
		if (focus) {
			pendingFocus = null;
			requestAnimationFrame(() => {
				if (focus.part === 'add') { this.newRow(view, rows); return; }
				const row = [...rows.querySelectorAll<HTMLElement>('.metadata-property')].find((r) => r.dataset.key === focus.key);
				const field = focus.part === 'key' ? row?.querySelector<HTMLElement>('.metadata-property-key input') : row?.querySelector<HTMLElement>('.metadata-property-value input');
				field?.focus();
			});
		}
		return box;
	}

	/** A property's row: its name (renamed by editing it), its value's field, and a button that removes it. */
	private row(view: EditorView, parent: HTMLElement, key: string, value: unknown) {
		const row = parent.createDiv({ cls: 'metadata-property', attr: { 'data-key': key } });
		const type = propertyType(value);
		const keyCell = row.createDiv({ cls: 'metadata-property-key' });
		const keyInput = keyCell.createEl('input', { type: 'text', cls: 'metadata-property-key-input', value: key, attr: { 'aria-label': 'Property name', spellcheck: 'false' } });
		this.suggestKeys(keyInput, () => commitKey());
		const commitKey = () => {
			const to = keyInput.value.trim();
			if (!to || to === key) { keyInput.value = key; return; }
			pendingFocus = { key: to, part: 'value' };
			if (!apply(view, { op: 'rename', from: key, to })) { pendingFocus = null; keyInput.value = key; keyInput.addClass('is-invalid'); }
		};
		keyInput.addEventListener('change', commitKey);
		keyInput.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') { e.preventDefault(); commitKey(); if (keyInput.value === key) focusValue(row); }
			else if (e.key === 'Escape') { keyInput.value = key; keyInput.blur(); view.focus(); }
		});
		const cell = row.createDiv({ cls: `metadata-property-value mod-${type}` });
		this.valueField(view, cell, key, value, type);
		const remove = row.createEl('button', { cls: 'metadata-property-remove clickable-icon', attr: { 'aria-label': `Remove ${key}`, title: 'Remove property' } });
		setIcon(remove, 'x');
		remove.addEventListener('click', () => { apply(view, { op: 'delete', key }); view.focus(); });
	}

	/** The field for a value, by its kind. Each commits when it is left or Enter is pressed. */
	private valueField(view: EditorView, cell: HTMLElement, key: string, value: unknown, type: PropertyType) {
		const set = (v: unknown, refocus = false) => {
			if (refocus) pendingFocus = { key, part: 'value' };
			apply(view, { op: 'set', key, value: v });
		};
		const leave = (input: HTMLInputElement, e: KeyboardEvent, commit: () => void) => {
			if (e.key === 'Enter') { e.preventDefault(); commit(); input.blur(); view.focus(); }
			else if (e.key === 'Escape') { e.preventDefault(); input.blur(); view.focus(); }
		};
		switch (type) {
			case 'checkbox': {
				const box = cell.createEl('input', { type: 'checkbox', attr: { 'aria-label': key } });
				box.checked = value === true;
				box.addEventListener('change', () => set(box.checked));
				return;
			}
			case 'number': {
				const input = cell.createEl('input', { type: 'number', value: String(value ?? ''), attr: { 'aria-label': key } });
				const commit = () => { const n = input.value.trim() === '' ? null : Number(input.value); if (n === null || Number.isFinite(n)) set(n); };
				input.addEventListener('change', commit);
				input.addEventListener('keydown', (e) => leave(input, e, commit));
				return;
			}
			case 'date': {
				const input = cell.createEl('input', { type: 'date', value: value instanceof Date ? value.toISOString().slice(0, 10) : String(value ?? ''), attr: { 'aria-label': key } });
				input.addEventListener('change', () => set(input.value || null));
				input.addEventListener('keydown', (e) => leave(input, e, () => set(input.value || null)));
				return;
			}
			case 'list': {
				const items = (value as unknown[]).map((v) => String(v ?? ''));
				const chips = cell.createDiv({ cls: 'metadata-chips' });
				items.forEach((item, i) => {
					const chip = chips.createSpan({ cls: 'metadata-chip', text: item });
					const x = chip.createEl('button', { cls: 'metadata-chip-remove', text: '×', attr: { 'aria-label': `Remove ${item}` } });
					x.addEventListener('click', () => set(items.filter((_, j) => j !== i), true));
				});
				const input = chips.createEl('input', { type: 'text', cls: 'metadata-chip-input', attr: { 'aria-label': `Add to ${key}`, placeholder: items.length ? '' : 'Add…', spellcheck: 'false' } });
				const addItem = () => {
					const parts = input.value.split(',').map((p) => p.trim()).filter((p) => p && !items.includes(p));
					if (parts.length) set([...items, ...parts], true);
					input.value = '';
				};
				new InputSuggest(input, { source: () => (this.source?.values(key) ?? []).filter((v) => !items.includes(v)), onChoose: addItem });
				input.addEventListener('keydown', (e) => {
					if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addItem(); }
					else if (e.key === 'Backspace' && input.value === '' && items.length) set(items.slice(0, -1), true);
					else if (e.key === 'Escape') { input.blur(); view.focus(); }
				});
				input.addEventListener('blur', () => { if (input.value.trim()) addItem(); });
				return;
			}
			default: {
				const text = value === null || value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
				const input = cell.createEl('input', { type: 'text', value: text, attr: { 'aria-label': key } });
				if (typeof value === 'object' && value !== null) { input.readOnly = true; input.title = 'Edit as YAML to change this value'; return; }
				const commit = () => { if (input.value !== text) set(input.value === '' ? null : input.value); };
				new InputSuggest(input, { source: () => this.source?.values(key) ?? [], onChoose: commit });
				input.addEventListener('change', commit);
				input.addEventListener('keydown', (e) => leave(input, e, commit));
			}
		}
	}

	private suggestKeys(input: HTMLInputElement, onChoose: () => void) {
		new InputSuggest(input, {
			source: () => {
				const have = new Set(this.entries.map(([k]) => k));
				return (this.source?.keys() ?? []).map((k) => k.key).filter((k) => !have.has(k));
			},
			onChoose,
		});
	}

	/** A row for a new property: its name first; its value's field comes once it has one. */
	private newRow(view: EditorView, rows: HTMLElement) {
		const existing = rows.querySelector<HTMLInputElement>('.metadata-property.is-new input');
		if (existing) { existing.focus(); return; }
		const row = rows.createDiv({ cls: 'metadata-property is-new' });
		const keyInput = row.createDiv({ cls: 'metadata-property-key' }).createEl('input', { type: 'text', attr: { 'aria-label': 'New property name', placeholder: 'Name', spellcheck: 'false' } });
		row.createDiv({ cls: 'metadata-property-value' });
		let done = false;
		const commit = () => {
			if (done) return;
			const key = keyInput.value.trim();
			if (!key) { done = true; row.remove(); return; }
			if (this.entries.some(([k]) => k === key)) { keyInput.addClass('is-invalid'); return; }
			done = true;
			const type = this.source?.keys().find((k) => k.key === key)?.type ?? 'text';
			pendingFocus = { key, part: 'value' };
			if (!apply(view, { op: 'set', key, value: emptyValue(type) })) { pendingFocus = null; row.remove(); }
		};
		this.suggestKeys(keyInput, commit);
		keyInput.addEventListener('keydown', (e) => {
			if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); commit(); }
			else if (e.key === 'Escape') { done = true; row.remove(); view.focus(); }
		});
		keyInput.addEventListener('blur', () => { if (!keyInput.value.trim()) { done = true; row.remove(); } else commit(); });
		keyInput.focus();
	}

	/** The fields handle their own clicks and keys. */
	override ignoreEvent(): boolean { return true; }

	/** A suggestion popup of a field that goes with the table. */
	override destroy(): void {
		document.querySelectorAll('.mod-input-suggest').forEach((el) => el.remove());
	}
}

function focusValue(row: HTMLElement) {
	row.querySelector<HTMLElement>('.metadata-property-value input')?.focus();
}

function build(state: EditorState, source: PropertySource | undefined): DecorationSet {
	const range = frontmatterRange(state);
	if (!range) return Decoration.none;
	// Being edited: the YAML as written. A cursor at the very start is where a note opens, not editing.
	const editing = state.selection.ranges.some((r) => !(r.empty && r.head === 0) && r.from <= range.to && r.to >= range.from);
	if (editing) return Decoration.none;
	const fm = parseFrontMatter(state.doc.sliceString(0, Math.min(state.doc.length, 20000)));
	if (!fm) return Decoration.none;
	return Decoration.set([Decoration.replace({ widget: new PropertiesWidget(Object.entries(fm), source), block: true }).range(range.from, range.to)]);
}

/** Show a note's properties as a table to edit, except while the YAML is being edited. */
export function propertiesPreview(source?: PropertySource): Extension {
	return StateField.define<DecorationSet>({
		create: (state) => build(state, source),
		update: (deco, tr) => (tr.docChanged || tr.selection ? build(tr.state, source) : deco),
		provide: (f) => EditorView.decorations.from(f),
	});
}

/**
 * Add a property to the note in `view`: a new row in its table, the name field focused. A note without
 * properties gets an empty block first.
 */
export function addProperty(view: EditorView): void {
	const button = view.dom.querySelector<HTMLElement>('.cm-properties .metadata-add-button');
	if (button) { button.click(); return; }
	const range = frontmatterRange(view.state);
	pendingFocus = { part: 'add' };
	// The cursor goes below the block, so the table (not the YAML) shows.
	if (!range) {
		view.dispatch({ changes: { from: 0, insert: '---\n---\n' }, selection: { anchor: view.state.selection.main.head + 8 }, userEvent: 'input.property' });
	} else {
		view.dispatch({ selection: { anchor: Math.min(view.state.doc.length, range.to + 1) } });
	}
}
