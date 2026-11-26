/**
 * The note's name as a title above its text (in the editor and the reading view). It is not part of the
 * file: editing it and pressing Enter (or moving away) renames the file, and links follow. Esc puts the
 * name back; Enter or ↓ goes into the text; ↑ on the first line of the text comes back up.
 */
import { type Extension, Prec, StateEffect, StateField } from '@codemirror/state';
import { Decoration, EditorView, WidgetType, keymap } from '@codemirror/view';

export interface TitleHandlers {
	/** Rename the note to `name`; resolves whether it was renamed. */
	rename(name: string): Promise<boolean>;
	/** Leave the title for the text. */
	toText(): void;
}

/** Set (or clear, with null) the title shown above the text. */
export const setTitle = StateEffect.define<string | null>();

/**
 * The editable title (also used by the reading view): a name, styled as a title, that wraps onto more lines as a
 * heading would (a text area as tall as its text) but is edited as one line: Enter renames, and line breaks
 * pasted in become spaces.
 */
export function titleElement(name: string, h: TitleHandlers): HTMLElement {
	const wrap = document.createElement('div');
	wrap.className = 'inline-title-wrap';
	const el = document.createElement('textarea');
	el.rows = 1;
	el.className = 'inline-title';
	el.spellcheck = false;
	el.autocomplete = 'off';
	el.setAttribute('aria-label', 'Note name: edit to rename the note');
	el.value = name;
	wrap.appendChild(el);
	// As tall as its text, at whatever width it is given: by the browser where it can (field-sizing), otherwise
	// measured, again whenever the width changes (not the height, which fitting changes).
	const sized = typeof CSS !== 'undefined' && CSS.supports('field-sizing', 'content');
	const fit = () => { if (sized) return; el.style.height = 'auto'; if (el.scrollHeight) el.style.height = `${el.scrollHeight}px`; };
	if (!sized) {
		let width = 0;
		new ResizeObserver(() => {
			const w = el.clientWidth;
			if (w === width) return;
			width = w;
			requestAnimationFrame(fit);
		}).observe(el);
	}
	el.addEventListener('input', () => {
		if (/[\r\n]/.test(el.value)) { const at = el.selectionStart; el.value = el.value.replace(/[\r\n]+/g, ' '); el.setSelectionRange(at, at); }
		fit();
	});
	let committing = false;
	const current = () => el.value.replace(/\s+/g, ' ').trim();
	const commit = async () => {
		if (committing) return;
		const next = current();
		if (!next || next === name) { el.value = name; fit(); return; }
		committing = true;
		const ok = await h.rename(next).catch(() => false);
		committing = false;
		if (!ok) { el.value = name; fit(); }
	};
	el.addEventListener('keydown', (e) => {
		e.stopPropagation(); // the editor's keys do not apply here
		if (e.isComposing) return;
		if (e.key === 'Enter' || e.key === 'ArrowDown') {
			e.preventDefault();
			void commit();
			h.toText();
		} else if (e.key === 'Escape') {
			e.preventDefault();
			el.value = name;
			fit();
			h.toText();
		}
	});
	el.addEventListener('blur', () => { void commit(); });
	return wrap;
}

class TitleWidget extends WidgetType {
	constructor(readonly name: string, readonly h: TitleHandlers) { super(); }
	override eq(other: TitleWidget): boolean { return other.name === this.name; }
	/** About one line of title text and its margin, so positions below are right before it is measured. */
	override get estimatedHeight(): number { return 58; }
	toDOM(): HTMLElement { return titleElement(this.name, this.h); }
	/** The title handles its own typing and clicks; the editor leaves them alone. */
	override ignoreEvent(): boolean { return true; }
}

/** The title above the text, with ↑ on the first line going up into it. */
export function inlineTitle(h: TitleHandlers): Extension {
	const field = StateField.define<string | null>({
		create: () => null,
		update(value, tr) {
			for (const e of tr.effects) if (e.is(setTitle)) value = e.value;
			return value;
		},
		provide: (f) => EditorView.decorations.from(f, (name) => (name === null ? Decoration.none
			: Decoration.set([Decoration.widget({ widget: new TitleWidget(name, h), block: true, side: -1 }).range(0)]))),
	});
	// Before the editor's own ↑ (which moves within the text).
	const up = Prec.high(keymap.of([{
		key: 'ArrowUp',
		run: (view) => {
			const sel = view.state.selection.main;
			if (!sel.empty || view.state.doc.lineAt(sel.head).number !== 1 || view.state.field(field) === null) return false;
			const el = view.dom.querySelector<HTMLTextAreaElement>('textarea.inline-title');
			if (!el) return false;
			el.focus();
			el.setSelectionRange(el.value.length, el.value.length);
			return true;
		},
	}]));
	return [field, up];
}
