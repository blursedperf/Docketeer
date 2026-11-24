import type { App } from './app';
import type { Editor, EditorPosition } from './editor';
import type { TFile } from './files';
import type { Instruction } from './ui';

export interface EditorSuggestTriggerInfo {
	start: EditorPosition;
	end: EditorPosition;
	query: string;
}

export interface EditorSuggestContext extends EditorSuggestTriggerInfo {
	editor: Editor;
	file: TFile | null;
}

/**
 * A popup of suggestions at the cursor while typing. `onTrigger` decides, on each edit, whether it
 * opens; Up/Down move, Enter chooses, Escape closes.
 */
export abstract class EditorSuggest<T> {
	app: App;
	context: EditorSuggestContext | null = null;
	limit = 100;
	suggestEl: HTMLElement;
	private _listEl: HTMLElement;
	private _instructionsEl: HTMLElement;
	private _items: T[] = [];
	private _selected = 0;
	private _generation = 0;
	isOpen = false;

	constructor(app: App) {
		this.app = app;
		this.suggestEl = createDiv({ cls: 'suggestion-container' });
		this._listEl = this.suggestEl.createDiv({ cls: 'suggestion' });
		this._instructionsEl = this.suggestEl.createDiv({ cls: 'prompt-instructions' });
		this._instructionsEl.hide();
		this.suggestEl.addEventListener('mousedown', (e) => e.preventDefault());
	}

	abstract onTrigger(cursor: EditorPosition, editor: Editor, file: TFile | null): EditorSuggestTriggerInfo | null;
	abstract getSuggestions(context: EditorSuggestContext): T[] | Promise<T[]>;
	abstract renderSuggestion(value: T, el: HTMLElement): void;
	abstract selectSuggestion(value: T, evt: MouseEvent | KeyboardEvent): void;

	setInstructions(instructions: Instruction[]): void {
		this._instructionsEl.empty();
		this._instructionsEl.toggle(instructions.length > 0);
		for (const i of instructions) {
			const el = this._instructionsEl.createDiv({ cls: 'prompt-instruction' });
			el.createSpan({ cls: 'prompt-instruction-command', text: i.command });
			el.createSpan({ text: i.purpose });
		}
	}

	/** Show suggestions for `context` (called by the app when `onTrigger` matches). */
	async update(context: EditorSuggestContext): Promise<void> {
		this.context = context;
		const gen = ++this._generation;
		const items = await this.getSuggestions(context);
		if (gen !== this._generation || this.context !== context) return;
		this._items = items.slice(0, this.limit);
		if (this._items.length === 0) {
			this.close();
			return;
		}
		this._listEl.empty();
		this._items.forEach((item, i) => {
			const el = this._listEl.createDiv({ cls: 'suggestion-item' });
			this.renderSuggestion(item, el);
			el.addEventListener('mousemove', () => this._select(i, false));
			el.addEventListener('click', (e) => this._choose(i, e));
		});
		this._selected = 0;
		this._select(0, false);
		this.open();
		this._position();
	}

	open(): void {
		if (this.isOpen) return;
		this.isOpen = true;
		document.body.appendChild(this.suggestEl);
		this.app.setActiveSuggest(this);
	}

	close(): void {
		this._generation++;
		this.context = null;
		if (!this.isOpen) return;
		this.isOpen = false;
		this.suggestEl.detach();
		this.app.setActiveSuggest(null);
	}

	private _position() {
		const ctx = this.context;
		if (!ctx) return;
		const coords = ctx.editor.cm.coordsAtPos(ctx.editor.posToOffset(ctx.end));
		if (!coords) return;
		const r = this.suggestEl.getBoundingClientRect();
		let top = coords.bottom + 4;
		if (top + r.height > window.innerHeight - 8) top = Math.max(8, coords.top - r.height - 4);
		const left = Math.max(8, Math.min(coords.left, window.innerWidth - r.width - 8));
		this.suggestEl.setCssStyles({ left: `${left}px`, top: `${top}px` });
	}

	private _select(i: number, scroll = true) {
		const els = this._listEl.querySelectorAll('.suggestion-item');
		els[this._selected]?.removeClass('is-selected');
		this._selected = (i + this._items.length) % Math.max(1, this._items.length);
		const el = els[this._selected] as HTMLElement | undefined;
		el?.addClass('is-selected');
		if (scroll) el?.scrollIntoView({ block: 'nearest' });
	}

	private _choose(i: number, e: MouseEvent | KeyboardEvent) {
		const item = this._items[i];
		if (item === undefined) return;
		this.selectSuggestion(item, e);
	}

	/** Keys while open; returns true when handled. */
	handleKey(key: string, e: KeyboardEvent): boolean {
		if (!this.isOpen) return false;
		switch (key) {
			case 'ArrowDown': this._select(this._selected + 1); return true;
			case 'ArrowUp': this._select(this._selected - 1); return true;
			case 'Enter': this._choose(this._selected, e); return true;
			case 'Escape': this.close(); return true;
			default: return false;
		}
	}
}
