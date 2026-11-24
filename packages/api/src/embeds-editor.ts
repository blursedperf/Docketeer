import { type EditorState, type Extension, RangeSetBuilder, StateField } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, WidgetType } from '@codemirror/view';

/** Turns an embed's target (a [[link]] target or a ![](path)) into an image URL, or null. */
export type ImageResolver = (target: string, wikilink: boolean) => string | null;

class ImageWidget extends WidgetType {
	constructor(readonly src: string, readonly alt: string, readonly width: number | null) { super(); }
	override eq(other: ImageWidget): boolean { return other.src === this.src && other.width === this.width; }
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

const EMBED = /!\[\[([^\]\n|]+)(?:\|([^\]\n]*))?\]\]|!\[([^\]\n]*)\]\(([^)\s]+)\)/g;

function build(state: EditorState, resolve: ImageResolver): DecorationSet {
	const builder = new RangeSetBuilder<Decoration>();
	const doc = state.doc;
	for (let n = 1; n <= doc.lines; n++) {
		const line = doc.line(n);
		if (!line.text.includes('![')) continue;
		const widgets: ImageWidget[] = [];
		for (const m of line.text.matchAll(EMBED)) {
			const wiki = m[1] !== undefined;
			const target = (wiki ? m[1]! : decodeURIComponentSafe(m[4]!)).trim();
			const src = resolve(target, wiki);
			if (!src) continue;
			const size = wiki ? /^(\d+)(?:x\d+)?$/.exec((m[2] ?? '').trim()) : null;
			widgets.push(new ImageWidget(src, wiki ? (m[2] && !size ? m[2] : target) : m[3] ?? '', size ? Number(size[1]) : null));
		}
		for (const w of widgets) builder.add(line.to, line.to, Decoration.widget({ widget: w, block: true, side: 1 }));
	}
	return builder.finish();
}

function decodeURIComponentSafe(s: string): string {
	try { return decodeURIComponent(s); } catch { return s; }
}

/** Show embedded images below their lines in the editor. */
export function imageEmbeds(resolve: ImageResolver): Extension {
	return StateField.define<DecorationSet>({
		create: (state) => build(state, resolve),
		update: (deco, tr) => (tr.docChanged ? build(tr.state, resolve) : deco),
		provide: (f) => EditorView.decorations.from(f),
	});
}
