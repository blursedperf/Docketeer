import { type EditorState, type Extension, RangeSetBuilder, StateField } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, WidgetType } from '@codemirror/view';

/** What an embed shows below its line: a picture, or a player made by `create`. */
export type EmbedTarget =
	| { kind: 'image'; src: string }
	| { kind: 'media'; key: string; create(width: number | null): { el: HTMLElement; dispose(): void } };

/** Turns an embed's target (a [[link]] target or a ![](path)) into what to show, or null. */
export type EmbedResolver = (target: string, wikilink: boolean) => EmbedTarget | null;

class ImageWidget extends WidgetType {
	constructor(readonly src: string, readonly alt: string, readonly width: number | null) { super(); }
	override eq(other: WidgetType): boolean { return other instanceof ImageWidget && other.src === this.src && other.width === this.width; }
	toDOM(): HTMLElement {
		const wrap = document.createElement('div');
		wrap.className = 'cm-image-embed';
		const img = document.createElement('img');
		img.src = this.src;
		img.alt = this.alt;
		img.draggable = false;
		if (this.width) img.style.width = `${this.width}px`;
		wrap.appendChild(img);
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
	constructor(readonly target: Extract<EmbedTarget, { kind: 'media' }>, readonly width: number | null) { super(); }
	override eq(other: WidgetType): boolean { return other instanceof MediaWidget && other.target.key === this.target.key && other.width === this.width; }
	toDOM(): HTMLElement {
		const wrap = document.createElement('div');
		wrap.className = 'cm-media-embed';
		const { el, dispose } = this.target.create(this.width);
		wrap.appendChild(el);
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

function build(state: EditorState, resolve: EmbedResolver): DecorationSet {
	const builder = new RangeSetBuilder<Decoration>();
	const doc = state.doc;
	for (let n = 1; n <= doc.lines; n++) {
		const line = doc.line(n);
		if (!line.text.includes('![')) continue;
		const widgets: WidgetType[] = [];
		for (const m of line.text.matchAll(EMBED)) {
			const wiki = m[1] !== undefined;
			const target = (wiki ? m[1]! : decodeURIComponentSafe(m[4]!)).trim();
			const found = resolve(target, wiki);
			if (!found) continue;
			const size = wiki ? /^(\d+)(?:x\d+)?$/.exec((m[2] ?? '').trim()) : null;
			const width = size ? Number(size[1]) : null;
			if (found.kind === 'image') widgets.push(new ImageWidget(found.src, wiki ? (m[2] && !size ? m[2] : target) : m[3] ?? '', width));
			else widgets.push(new MediaWidget(found, width));
		}
		for (const w of widgets) builder.add(line.to, line.to, Decoration.widget({ widget: w, block: true, side: 1 }));
	}
	return builder.finish();
}

function decodeURIComponentSafe(s: string): string {
	try { return decodeURIComponent(s); } catch { return s; }
}

/** Show embedded pictures and players below their lines in the editor. */
export function fileEmbeds(resolve: EmbedResolver): Extension {
	return StateField.define<DecorationSet>({
		create: (state) => build(state, resolve),
		update: (deco, tr) => (tr.docChanged ? build(tr.state, resolve) : deco),
		provide: (f) => EditorView.decorations.from(f),
	});
}
