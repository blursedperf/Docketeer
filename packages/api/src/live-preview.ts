/**
 * Live preview: Markdown is shown formatted while you write. Formatting marks are hidden, links show
 * their text, bullets, task boxes and rules are drawn. Only what the cursor (or a selection) touches shows
 * its Markdown as written, so it can be edited: one **bold** word, one link, one list marker — the rest of
 * its line stays formatted. Line-start marks (# and >) and rules show on the lines that hold the cursor.
 *
 * List items are laid out as in reading view: each level indented by --list-indent, the marker in the
 * space before the text, and wrapped lines under the text (not under the marker).
 *
 * Footnotes ([^1]) are left exactly as written: the AGLC4 plugin underlines and edits footnote syntax.
 */
import { syntaxTree } from '@codemirror/language';
import type { SyntaxNode } from '@lezer/common';
import type { EditorState, Extension } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, WidgetType } from '@codemirror/view';
import { isImage } from './attachments';
import { isMedia } from './media';
import { propertiesPreview } from './properties-editor';
import { tablePreview } from './tables-editor';

export interface LivePreviewOptions {
	/** Open a link clicked in the formatted text. */
	onOpenLink(link: { type: 'wiki' | 'url'; target: string }, newLeaf: boolean): void;
	/**
	 * Whether an `![[embed]]` shows something below its line (a picture or a player whose file exists). Only
	 * then is its text hidden; an embed of a missing file stays as written, so it can be seen and fixed.
	 * Without it, pictures and recordings are assumed to show.
	 */
	embedShows?(target: string): boolean;
}

const hide = Decoration.replace({});
/**
 * Hidden syntax with text straight after it ("]]." or "**,"). A replacement leaves CodeMirror's widget buffers
 * (inline images) in the line, where the browser may break it, so the full stop wraps onto a line of its own.
 * A hidden mark leaves nothing to break at. Only on lines not being edited, so the cursor never meets it.
 */
const hideInline = Decoration.mark({ class: 'cm-lp-hidden' });
/** A line holding only embeds (and spaces). */
const EMBEDS_ONLY = /^\s*(?:!\[\[[^\]\n]+\]\]\s*)+$/;

/** Reading view's bullets, by level: disc, circle, square, then again. */
const BULLETS = ['•', '◦', '▪'];

class BulletWidget extends WidgetType {
	constructor(readonly depth: number) { super(); }
	override eq(o: BulletWidget): boolean { return o.depth === this.depth; }
	toDOM(): HTMLElement {
		const s = document.createElement('span');
		s.className = 'cm-lp-bullet cm-lp-list-slot';
		s.textContent = BULLETS[(this.depth - 1) % BULLETS.length]!;
		return s;
	}
}

/** A list item's indentation, drawn as its levels (whatever mix of tabs and spaces it was typed with). */
class IndentWidget extends WidgetType {
	constructor(readonly levels: number) { super(); }
	override eq(o: IndentWidget): boolean { return o.levels === this.levels; }
	toDOM(): HTMLElement {
		const s = document.createElement('span');
		s.className = 'cm-lp-list-indent';
		s.style.setProperty('--lp-levels', String(this.levels));
		return s;
	}
}

class CheckboxWidget extends WidgetType {
	constructor(readonly checked: boolean, readonly pos: number) { super(); }
	override eq(o: CheckboxWidget): boolean { return o.checked === this.checked && o.pos === this.pos; }
	toDOM(view: EditorView): HTMLElement {
		// In the list marker's place, as a bullet is.
		const slot = document.createElement('span');
		slot.className = 'cm-lp-list-slot cm-lp-task-slot';
		const box = slot.appendChild(document.createElement('input'));
		box.type = 'checkbox';
		box.className = 'cm-lp-task';
		box.checked = this.checked;
		box.addEventListener('mousedown', (e) => e.preventDefault());
		box.addEventListener('click', (e) => {
			e.preventDefault();
			// The marker is "[ ]" or "[x]" at pos: change the middle character.
			view.dispatch({ changes: { from: this.pos + 1, to: this.pos + 2, insert: this.checked ? ' ' : 'x' }, userEvent: 'input.toggle' });
		});
		return slot;
	}
	override ignoreEvent(): boolean { return false; }
}

class RuleWidget extends WidgetType {
	override eq(): boolean { return true; }
	toDOM(): HTMLElement {
		const s = document.createElement('span');
		s.className = 'cm-lp-hr';
		return s;
	}
}

/** Lines that hold the cursor or part of a selection: shown as written. */
function activeLines(state: EditorState): Set<number> {
	const lines = new Set<number>();
	for (const r of state.selection.ranges) {
		const a = state.doc.lineAt(r.from).number;
		const b = state.doc.lineAt(r.to).number;
		for (let n = a; n <= b; n++) lines.add(n);
	}
	return lines;
}

function build(view: EditorView, opts: LivePreviewOptions): DecorationSet {
	const { state } = view;
	const doc = state.doc;
	const active = activeLines(state);
	const ranges = state.selection.ranges;
	/** Whether the cursor or a selection touches from..to (its edges included): then it shows as written. */
	const touches = (from: number, to: number) => ranges.some((r) => r.from <= to && r.to >= from);
	const lineActive = (pos: number) => active.has(doc.lineAt(pos).number);
	// %% comments %% are shown as written.
	const comments: [number, number][] = [];
	const all = doc.toString();
	for (const m of all.matchAll(/%%[\s\S]*?(?:%%|$)/g)) if (m[0].length) comments.push([m.index, m.index + m[0].length]);
	const inComment = (pos: number) => comments.some(([a, b]) => pos >= a && pos < b);
	const items: { from: number; to: number; deco: Decoration }[] = [];
	const lines = new Map<number, { cls: string[]; style: string[] }>();
	const add = (from: number, to: number, deco: Decoration) => {
		if (!(to > from || (to === from && (deco.spec as { widget?: unknown }).widget))) return;
		// Hidden syntax with text straight after it: a mark, not a replacement (see hideInline). The cursor never
		// meets it, as what it belongs to shows as written once the cursor touches it.
		if (deco === hide && to < doc.length && /\S/.test(doc.sliceString(to, to + 1))) deco = hideInline;
		items.push({ from, to, deco });
	};
	const line = (pos: number, cls: string, style?: string) => {
		const at = doc.lineAt(pos).from;
		const l = lines.get(at) ?? { cls: [], style: [] };
		if (!l.cls.includes(cls)) l.cls.push(cls);
		if (style) l.style.push(style);
		lines.set(at, l);
	};

	for (const { from, to } of view.visibleRanges) {
		syntaxTree(state).iterate({
			from,
			to,
			enter: (node) => {
				const name = node.name;
				if (name === 'Frontmatter' || name === 'FencedCode' || name === 'CodeBlock' || name === 'Table') return false;
				// Top-level headings have a rule under them, as in reading view (also while being edited).
				if (name === 'ATXHeading1' || name === 'ATXHeading2') line(node.from, name === 'ATXHeading1' ? 'cm-lp-h1' : 'cm-lp-h2');
				if (inComment(node.from)) return;
				switch (name) {
					case 'HeaderMark': {
						if (lineActive(node.from)) break;
						// "# " before the heading text.
						const after = doc.sliceString(node.to, node.to + 1) === ' ' ? 1 : 0;
						add(node.from, node.to + after, hide);
						break;
					}
					case 'EmphasisMark':
					case 'StrikethroughMark':
					case 'CodeMark': {
						const parent = node.node.parent;
						if (!parent || parent.name === 'FencedCode') break;
						if (!touches(parent.from, parent.to)) add(node.from, node.to, hide);
						break;
					}
					case 'QuoteMark': {
						line(node.from, 'cm-lp-quote');
						if (lineActive(node.from)) break;
						const after = doc.sliceString(node.to, node.to + 1) === ' ' ? 1 : 0;
						add(node.from, node.to + after, hide);
						break;
					}
					case 'ListMark':
						listItem(node.node);
						break;
					case 'TaskMarker': {
						const checked = /x/i.test(doc.sliceString(node.from, node.to));
						if (checked) add(node.to, doc.lineAt(node.to).to, Decoration.mark({ class: 'cm-lp-task-done' }));
						if (touches(node.from, node.to)) break;
						add(node.from, node.to, Decoration.replace({ widget: new CheckboxWidget(checked, node.from) }));
						// The space after the box: the box fills the marker's place, as a bullet does.
						if (doc.sliceString(node.to, node.to + 1) === ' ') add(node.to, node.to + 1, hide);
						break;
					}
					case 'HorizontalRule':
						if (!lineActive(node.from)) add(node.from, node.to, Decoration.replace({ widget: new RuleWidget() }));
						break;
					case 'Link': {
						if (touches(node.from, node.to)) return false;
						// [text](url "title"): show the text as a link.
						const marks = node.node.getChildren('LinkMark');
						const url = node.node.getChild('URL');
						if (marks.length >= 2 && url) {
							const open = marks[0]!;
							const close = marks[1]!;
							const href = doc.sliceString(url.from, url.to);
							add(open.from, open.to, hide);
							add(open.to, close.from, Decoration.mark({ class: 'cm-lp-link', attributes: { 'data-href': href, 'data-kind': /^[a-z][a-z0-9+.-]*:/i.test(href) ? 'url' : 'wiki' } }));
							add(close.from, node.to, hide);
						}
						return false;
					}
					case 'Image': {
						if (touches(node.from, node.to)) return false;
						const url = node.node.getChild('URL');
						if (url && (isImage(doc.sliceString(url.from, url.to)) || isMedia(doc.sliceString(url.from, url.to)))) add(node.from, node.to, hide);
						return false;
					}
				}
				return undefined;
			},
		});

		// Things the Markdown parser does not know: [[wikilinks]], ![[embeds]], ==highlights==.
		const text = doc.sliceString(from, to);
		for (const m of text.matchAll(/(!?)\[\[([^\]\n|]+)(?:\|([^\]\n]*))?\]\]|==([^=\n]+)==/g)) {
			const start = from + m.index;
			const end = start + m[0].length;
			if (inComment(start) || insideCode(state, start)) continue;
			if (m[4] !== undefined) {
				if (touches(start, end)) continue;
				add(start, start + 2, hide);
				add(end - 2, end, hide);
				continue;
			}
			const target = m[2]!.trim();
			if (m[1] === '!') {
				// A picture or a player shows below the line: hide its embed text, and when the line holds
				// nothing else, the empty line too (the player then sits where the line was). That line shows
				// again while it holds the cursor.
				const bare = target.replace(/[#^].*$/, '');
				const shows = opts.embedShows ? opts.embedShows(target) : isImage(bare) || isMedia(bare);
				if (!shows) continue;
				const l = doc.lineAt(start);
				if (EMBEDS_ONLY.test(l.text)) {
					if (lineActive(start)) continue;
					// Nothing else on the line: hide it without widget buffers, so it takes no height at all.
					add(start, end, hideInline);
					line(start, 'cm-lp-embed-line');
				} else if (!touches(start, end)) add(start, end, hide);
				continue;
			}
			if (touches(start, end)) continue;
			const textFrom = m[3] !== undefined ? start + 2 + m[2]!.length + 1 : start + 2;
			add(start, textFrom, hide);
			add(textFrom, end - 2, Decoration.mark({ class: 'cm-lp-link cm-lp-wikilink', attributes: { 'data-href': target, 'data-kind': 'wiki' } }));
			add(end - 2, end, hide);
		}
	}

	/**
	 * A list item's line: its indentation drawn as levels, its marker in the space before the text (a bullet
	 * for the level, the number as written, or the task box), and wrapped lines under the text. The marker
	 * shows as written while the cursor touches it, in the same space, so the text does not move.
	 */
	function listItem(mark: SyntaxNode) {
		const item = mark.parent;
		const list = item?.parent;
		if (!item || !list || (list.name !== 'BulletList' && list.name !== 'OrderedList')) return;
		const l = doc.lineAt(mark.from);
		const lead = doc.sliceString(l.from, mark.from);
		// Inside a quote ("> - item") the quote's own marks come first: leave the line's layout alone.
		if (/\S/.test(lead)) {
			if (list.name === 'BulletList' && !touches(mark.from, mark.to) && !item.getChild('Task')) add(mark.from, mark.to, Decoration.replace({ widget: new BulletWidget(1) }));
			return;
		}
		let depth = 0;
		for (let n: SyntaxNode | null = list; n; n = n.parent) if (n.name === 'BulletList' || n.name === 'OrderedList') depth++;
		const task = list.name === 'BulletList' && !!item.getChild('Task');
		line(l.from, 'cm-lp-li', `--lp-depth: ${depth}`);
		if (lead.length > 0) add(l.from, mark.from, Decoration.replace({ widget: new IndentWidget(depth - 1) }));
		const space = doc.sliceString(mark.to, mark.to + 1) === ' ' ? 1 : 0;
		if (touches(mark.from, mark.to) || list.name === 'OrderedList') {
			// As written ("- ", "1. "), in the marker's space.
			add(mark.from, mark.to + space, Decoration.mark({ class: `cm-lp-list-slot${list.name === 'OrderedList' ? ' cm-lp-list-number' : ''}` }));
		} else if (task) add(mark.from, mark.to + space, hide);
		else add(mark.from, mark.to + space, Decoration.replace({ widget: new BulletWidget(depth) }));
	}

	for (const [pos, l] of lines) {
		const spec: { class: string; attributes?: Record<string, string> } = { class: l.cls.join(' ') };
		if (l.style.length) spec.attributes = { style: l.style.join('; ') };
		items.push({ from: pos, to: pos, deco: Decoration.line(spec) });
	}
	// CodeMirror orders them (line decorations, widgets and marks at one position) itself.
	return Decoration.set(items.map((it) => it.deco.range(it.from, it.to)), true);
}

function insideCode(state: EditorState, pos: number): boolean {
	let n: { name: string; parent: unknown } | null = syntaxTree(state).resolveInner(pos, 1) as unknown as { name: string; parent: unknown };
	while (n) {
		if (n.name === 'InlineCode' || n.name === 'FencedCode' || n.name === 'CodeBlock' || n.name === 'Frontmatter') return true;
		n = n.parent as typeof n;
	}
	return false;
}

/** The live preview extension. */
export function livePreview(opts: LivePreviewOptions): Extension {
	const plugin = ViewPlugin.fromClass(class {
		decorations: DecorationSet;
		constructor(view: EditorView) { this.decorations = build(view, opts); }
		update(u: ViewUpdate) {
			if (u.docChanged || u.viewportChanged || u.selectionSet || syntaxTree(u.startState) !== syntaxTree(u.state)) {
				this.decorations = build(u.view, opts);
			}
		}
	}, { decorations: (v) => v.decorations });

	const clicks = EditorView.domEventHandlers({
		mousedown(e) {
			// A plain click on a formatted link opens it (Ctrl/Cmd for a new tab).
			// Ctrl/Cmd-click is the editor's own link handler (it works in source mode too).
			if (e.button !== 0 || e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) return false;
			const el = (e.target as HTMLElement).closest<HTMLElement>('.cm-lp-link');
			if (!el?.dataset.href) return false;
			e.preventDefault();
			opts.onOpenLink({ type: el.dataset.kind === 'url' ? 'url' : 'wiki', target: el.dataset.href }, false);
			return true;
		},
	});

	return [plugin, clicks, propertiesPreview(), tablePreview(), EditorView.editorAttributes.of({ class: 'is-live-preview' })];
}
