import { type EditorState, type Extension, RangeSetBuilder, StateField } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, WidgetType } from '@codemirror/view';
import { setIcon } from './icons';

/** What an embed shows below its line: a picture, or a player made by `create`. */
export type EmbedTarget =
	| { kind: 'image'; src: string }
	| { kind: 'media'; key: string; create(width: number | null): { el: HTMLElement; dispose(): void } };

/** Turns an embed's target (a [[link]] target or a ![](path)) into what to show, or null. */
export type EmbedResolver = (target: string, wikilink: boolean) => EmbedTarget | null;

/** What a right-click on a picture or player does: given the embed's place in the text. */
export type EmbedMenu = (e: MouseEvent, embed: { from: number; to: number }) => void;

/** Where the embed drawn as `dom` is written: the `index`-th embed on the widget's line. */
function embedRange(view: EditorView, dom: HTMLElement): { from: number; to: number } | null {
	let pos: number;
	try { pos = view.posAtDOM(dom); } catch { return null; }
	const line = view.state.doc.lineAt(Math.min(pos, view.state.doc.length));
	const all = [...line.text.matchAll(EMBED)];
	const m = all[Number(dom.dataset.index ?? 0)] ?? all[0];
	return m ? { from: line.from + m.index, to: line.from + m.index + m[0].length } : null;
}

/**
 * A picture's or player's own controls: a button (on hover, or by keyboard) that shows the embed's text with
 * the cursor in it, even when live preview hides the line it is on, and its right-click menu.
 */
function addControls(view: EditorView, wrap: HTMLElement, index: number, menu: EmbedMenu | undefined) {
	wrap.dataset.index = String(index);
	const edit = wrap.createEl('button', { cls: 'cm-embed-edit clickable-icon', attr: { 'aria-label': 'Show the embed\'s text', title: 'Show the embed\'s text' } });
	setIcon(edit, 'code');
	edit.addEventListener('mousedown', (e) => e.preventDefault());
	edit.addEventListener('click', (e) => {
		e.preventDefault();
		e.stopPropagation();
		const r = embedRange(view, wrap);
		if (!r) return;
		// Inside the brackets: the embed, and the line it is on, show as written while the cursor is there.
		const inside = view.state.sliceDoc(r.from, r.from + 3) === '![[' ? r.from + 3 : r.from + 2;
		view.dispatch({ selection: { anchor: inside }, scrollIntoView: true, userEvent: 'select' });
		view.focus();
	});
	wrap.addEventListener('contextmenu', (e) => {
		const r = embedRange(view, wrap);
		if (!r || !menu) return;
		e.preventDefault();
		e.stopPropagation();
		menu(e, r);
	});
}

class ImageWidget extends WidgetType {
	constructor(readonly src: string, readonly alt: string, readonly width: number | null, readonly index: number, readonly menu?: EmbedMenu) { super(); }
	override eq(other: WidgetType): boolean { return other instanceof ImageWidget && other.src === this.src && other.width === this.width; }
	toDOM(view: EditorView): HTMLElement {
		const wrap = document.createElement('div');
		wrap.className = 'cm-image-embed';
		const img = document.createElement('img');
		img.src = this.src;
		img.alt = this.alt;
		img.draggable = false;
		if (this.width) img.style.width = `${this.width}px`;
		wrap.appendChild(img);
		addControls(view, wrap, this.index, this.menu);
		return wrap;
	}
	override ignoreEvent(): boolean { return false; }
}

const disposers = new WeakMap<HTMLElement, () => void>();

/**
 * A player. Equal widgets keep their DOM, so a recording goes on playing while the note is edited; the
 * player is disposed only when its embed goes away or changes.
 */
class MediaWidget extends WidgetType {
	constructor(readonly target: Extract<EmbedTarget, { kind: 'media' }>, readonly width: number | null, readonly index: number, readonly menu?: EmbedMenu) { super(); }
	override eq(other: WidgetType): boolean { return other instanceof MediaWidget && other.target.key === this.target.key && other.width === this.width; }
	toDOM(view: EditorView): HTMLElement {
		const wrap = document.createElement('div');
		wrap.className = 'cm-media-embed';
		const { el, dispose } = this.target.create(this.width);
		wrap.appendChild(el);
		addControls(view, wrap, this.index, this.menu);
		disposers.set(wrap, dispose);
		return wrap;
	}
	override destroy(dom: HTMLElement): void {
		disposers.get(dom)?.();
		disposers.delete(dom);
	}
	/** The player's controls handle their own clicks and keys. */
	override ignoreEvent(): boolean { return true; }
}

const EMBED = /!\[\[([^\]\n|]+)(?:\|([^\]\n]*))?\]\]|!\[([^\]\n]*)\]\(([^)\s]+)\)/g;

function build(state: EditorState, resolve: EmbedResolver, menu?: EmbedMenu): DecorationSet {
	const builder = new RangeSetBuilder<Decoration>();
	const doc = state.doc;
	for (let n = 1; n <= doc.lines; n++) {
		const line = doc.line(n);
		if (!line.text.includes('![')) continue;
		const widgets: WidgetType[] = [];
		let index = -1;
		for (const m of line.text.matchAll(EMBED)) {
			index++;
			const wiki = m[1] !== undefined;
			const target = (wiki ? m[1]! : decodeURIComponentSafe(m[4]!)).trim();
			const found = resolve(target, wiki);
			if (!found) continue;
			const size = wiki ? /^(\d+)(?:x\d+)?$/.exec((m[2] ?? '').trim()) : null;
			const width = size ? Number(size[1]) : null;
			if (found.kind === 'image') widgets.push(new ImageWidget(found.src, wiki ? (m[2] && !size ? m[2] : target) : m[3] ?? '', width, index, menu));
			else widgets.push(new MediaWidget(found, width, index, menu));
		}
		for (const w of widgets) builder.add(line.to, line.to, Decoration.widget({ widget: w, block: true, side: 1 }));
	}
	return builder.finish();
}

function decodeURIComponentSafe(s: string): string {
	try { return decodeURIComponent(s); } catch { return s; }
}

/** Show embedded pictures and players below their lines in the editor. */
export function fileEmbeds(resolve: EmbedResolver, menu?: EmbedMenu): Extension {
	return StateField.define<DecorationSet>({
		create: (state) => build(state, resolve, menu),
		update: (deco, tr) => (tr.docChanged ? build(tr.state, resolve, menu) : deco),
		provide: (f) => EditorView.decorations.from(f),
	});
}
