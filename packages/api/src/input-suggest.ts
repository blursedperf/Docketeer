/**
 * Suggestions under a text field: the same popup as the editor's, for a field outside the editor (a property's
 * name or value). It opens when the field is focused or typed in; ↑↓ choose, Enter or Tab takes the chosen one,
 * Escape closes it. Typing something not in the list and pressing Enter keeps what was typed.
 */
import { fuzzyScore } from './util';

export interface InputSuggestOptions {
	/** Everything that could be suggested, best first (filtered by what is typed). */
	source(): string[];
	/** A suggestion was taken (the field already holds it). */
	onChoose(value: string): void;
	/** At most this many shown. */
	limit?: number;
}

export class InputSuggest {
	readonly el: HTMLElement;
	private list: HTMLElement;
	private items: string[] = [];
	private selected = -1;
	isOpen = false;

	constructor(readonly input: HTMLInputElement, private opts: InputSuggestOptions) {
		this.el = createDiv({ cls: 'suggestion-container mod-input-suggest' });
		this.list = this.el.createDiv({ cls: 'suggestion' });
		// Clicking a suggestion must not take the focus from the field (which would commit it first).
		this.el.addEventListener('mousedown', (e) => e.preventDefault());
		input.setAttribute('autocomplete', 'off');
		input.setAttribute('aria-autocomplete', 'list');
		input.addEventListener('focus', () => this.refresh());
		input.addEventListener('input', () => this.refresh());
		input.addEventListener('blur', () => this.close());
		input.addEventListener('keydown', (e) => this.onKey(e), true);
	}

	/** The suggestions for what is in the field now. */
	matches(): string[] {
		const q = this.input.value.trim();
		const all = this.opts.source();
		if (!q) return all.slice(0, this.opts.limit ?? 30);
		const scored: { v: string; s: number }[] = [];
		for (const v of all) {
			if (v === q) continue;
			const s = fuzzyScore(q, v);
			if (s !== null) scored.push({ v, s });
		}
		// Stable: equal scores keep the source's order (most used first).
		return scored.sort((a, b) => b.s - a.s).slice(0, this.opts.limit ?? 30).map((x) => x.v);
	}

	refresh(): void {
		this.items = this.matches();
		if (this.items.length === 0 || document.activeElement !== this.input) { this.close(); return; }
		this.list.empty();
		this.items.forEach((v, i) => {
			const row = this.list.createDiv({ cls: 'suggestion-item' });
			row.createDiv({ cls: 'suggestion-content', text: v });
			row.addEventListener('mousemove', () => this.select(i));
			row.addEventListener('click', () => this.choose(i));
		});
		// Nothing chosen until an arrow key is pressed: Enter keeps what was typed.
		this.selected = -1;
		if (!this.isOpen) { document.body.appendChild(this.el); this.isOpen = true; }
		this.position();
	}

	close(): void {
		if (!this.isOpen) return;
		this.isOpen = false;
		this.el.detach();
	}

	private position() {
		const r = this.input.getBoundingClientRect();
		const h = this.el.getBoundingClientRect().height;
		const top = r.bottom + h + 8 > window.innerHeight ? Math.max(8, r.top - h - 4) : r.bottom + 4;
		this.el.setCssStyles({ left: `${Math.max(8, r.left)}px`, top: `${top}px`, minWidth: `${Math.max(180, r.width)}px` });
	}

	private select(i: number) {
		const rows = this.list.querySelectorAll('.suggestion-item');
		rows[this.selected]?.removeClass('is-selected');
		this.selected = i;
		const row = rows[i] as HTMLElement | undefined;
		row?.addClass('is-selected');
		row?.scrollIntoView({ block: 'nearest' });
	}

	private choose(i: number) {
		const v = this.items[i];
		if (v === undefined) return;
		this.input.value = v;
		this.close();
		this.opts.onChoose(v);
	}

	private onKey(e: KeyboardEvent) {
		if (!this.isOpen) {
			if (e.key === 'ArrowDown' && !e.altKey) { e.preventDefault(); this.refresh(); }
			return;
		}
		const n = this.items.length;
		switch (e.key) {
			case 'ArrowDown': e.preventDefault(); e.stopImmediatePropagation(); this.select((this.selected + 1) % n); break;
			case 'ArrowUp': e.preventDefault(); e.stopImmediatePropagation(); this.select((this.selected - 1 + n) % n); break;
			case 'Enter':
			case 'Tab':
				if (this.selected >= 0) { e.preventDefault(); e.stopImmediatePropagation(); this.choose(this.selected); } else this.close();
				break;
			case 'Escape': e.preventDefault(); e.stopImmediatePropagation(); this.close(); break;
		}
	}
}
