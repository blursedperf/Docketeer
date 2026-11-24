import { EditorSelection, StateField, Transaction } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { redo, undo } from '@codemirror/commands';
import type { App } from './app';
import type { TFile } from './files';

export interface EditorPosition { line: number; ch: number; }
export interface EditorRange { from: EditorPosition; to: EditorPosition; }
export interface EditorSelectionRange { anchor: EditorPosition; head: EditorPosition; }

/** What an editor shows: the app and the note. The value of `editorInfoField`. */
export interface MarkdownFileInfo {
	app: App;
	file: TFile | null;
	editor?: Editor;
}

/** Read the note an editor state belongs to: `state.field(editorInfoField, false)?.file`. */
export const editorInfoField = StateField.define<MarkdownFileInfo | null>({
	create: () => null,
	update: (v) => v,
});

/** The smallest change turning `a` into `b`. */
export function minimalChange(a: string, b: string): { from: number; to: number; insert: string } | null {
	if (a === b) return null;
	let start = 0;
	const max = Math.min(a.length, b.length);
	while (start < max && a.charCodeAt(start) === b.charCodeAt(start)) start++;
	let endA = a.length;
	let endB = b.length;
	while (endA > start && endB > start && a.charCodeAt(endA - 1) === b.charCodeAt(endB - 1)) { endA--; endB--; }
	return { from: start, to: endA, insert: b.slice(start, endB) };
}

/** A line/character API over a CodeMirror view. `cm` is the view itself, for CodeMirror extensions. */
export class Editor {
	constructor(public cm: EditorView) {}

	private clampOffset(n: number): number { return Math.max(0, Math.min(this.cm.state.doc.length, n)); }

	posToOffset(pos: EditorPosition): number {
		const doc = this.cm.state.doc;
		const lineNo = Math.max(1, Math.min(doc.lines, pos.line + 1));
		const line = doc.line(lineNo);
		return Math.min(line.to, line.from + Math.max(0, pos.ch));
	}

	offsetToPos(offset: number): EditorPosition {
		const line = this.cm.state.doc.lineAt(this.clampOffset(offset));
		return { line: line.number - 1, ch: this.clampOffset(offset) - line.from };
	}

	getValue(): string { return this.cm.state.doc.toString(); }

	setValue(text: string): void {
		this.cm.dispatch({ changes: { from: 0, to: this.cm.state.doc.length, insert: text } });
	}

	/** Replace the whole text, changing only what differs (keeps the cursor and undo history sensible). */
	replaceWhole(text: string, remote = false): void {
		const change = minimalChange(this.getValue(), text);
		if (!change) return;
		this.cm.dispatch({ changes: change, annotations: remote ? [Transaction.remote.of(true), Transaction.addToHistory.of(true)] : [] });
	}

	getLine(line: number): string {
		const doc = this.cm.state.doc;
		if (line < 0 || line >= doc.lines) return '';
		return doc.line(line + 1).text;
	}

	setLine(n: number, text: string): void {
		const line = this.cm.state.doc.line(n + 1);
		this.cm.dispatch({ changes: { from: line.from, to: line.to, insert: text } });
	}

	lineCount(): number { return this.cm.state.doc.lines; }
	lastLine(): number { return this.cm.state.doc.lines - 1; }

	getRange(from: EditorPosition, to: EditorPosition): string {
		return this.cm.state.sliceDoc(this.posToOffset(from), this.posToOffset(to));
	}

	getCursor(which: 'from' | 'to' | 'head' | 'anchor' = 'head'): EditorPosition {
		const r = this.cm.state.selection.main;
		const off = which === 'from' ? r.from : which === 'to' ? r.to : which === 'anchor' ? r.anchor : r.head;
		return this.offsetToPos(off);
	}

	setCursor(pos: EditorPosition | number, ch?: number): void {
		const p = typeof pos === 'number' ? { line: pos, ch: ch ?? 0 } : pos;
		this.cm.dispatch({ selection: EditorSelection.cursor(this.posToOffset(p)) });
	}

	getSelection(): string {
		const r = this.cm.state.selection.main;
		return this.cm.state.sliceDoc(r.from, r.to);
	}

	somethingSelected(): boolean { return !this.cm.state.selection.main.empty; }

	setSelection(anchor: EditorPosition, head?: EditorPosition): void {
		this.cm.dispatch({ selection: EditorSelection.single(this.posToOffset(anchor), this.posToOffset(head ?? anchor)) });
	}

	listSelections(): EditorSelectionRange[] {
		return this.cm.state.selection.ranges.map((r) => ({ anchor: this.offsetToPos(r.anchor), head: this.offsetToPos(r.head) }));
	}

	setSelections(ranges: EditorSelectionRange[], main?: number): void {
		this.cm.dispatch({ selection: EditorSelection.create(ranges.map((r) => EditorSelection.range(this.posToOffset(r.anchor), this.posToOffset(r.head))), main) });
	}

	replaceSelection(text: string): void {
		this.cm.dispatch(this.cm.state.replaceSelection(text));
	}

	replaceRange(text: string, from: EditorPosition, to?: EditorPosition, _origin?: string): void {
		const a = this.posToOffset(from);
		const b = to ? this.posToOffset(to) : a;
		this.cm.dispatch({ changes: { from: Math.min(a, b), to: Math.max(a, b), insert: text } });
	}

	scrollIntoView(range: EditorRange, center = false): void {
		const from = this.posToOffset(range.from);
		this.cm.dispatch({ effects: EditorView.scrollIntoView(from, { y: center ? 'center' : 'nearest' }) });
	}

	scrollTo(_x?: number | null, y?: number | null): void {
		if (typeof y === 'number') this.cm.scrollDOM.scrollTop = y;
	}

	getScrollInfo(): { top: number; left: number } {
		return { top: this.cm.scrollDOM.scrollTop, left: this.cm.scrollDOM.scrollLeft };
	}

	wordAt(pos: EditorPosition): EditorRange | null {
		const r = this.cm.state.wordAt(this.posToOffset(pos));
		return r ? { from: this.offsetToPos(r.from), to: this.offsetToPos(r.to) } : null;
	}

	focus(): void { this.cm.focus(); }
	blur(): void { this.cm.contentDOM.blur(); }
	hasFocus(): boolean { return this.cm.hasFocus; }
	undo(): void { undo(this.cm); }
	redo(): void { redo(this.cm); }
	refresh(): void { this.cm.requestMeasure(); }

	/** Apply several changes and an optional selection as one undoable step. */
	transaction(tx: { changes?: { text: string; from: EditorPosition; to?: EditorPosition }[]; selection?: { from: EditorPosition; to?: EditorPosition } }): void {
		this.cm.dispatch({
			changes: tx.changes?.map((c) => ({ from: this.posToOffset(c.from), to: c.to ? this.posToOffset(c.to) : this.posToOffset(c.from), insert: c.text })),
			selection: tx.selection ? EditorSelection.single(this.posToOffset(tx.selection.from), this.posToOffset(tx.selection.to ?? tx.selection.from)) : undefined,
		});
	}
}
