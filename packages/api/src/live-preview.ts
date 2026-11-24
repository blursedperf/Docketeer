/**
 * Live preview: Markdown is shown formatted while you write. Formatting marks are hidden, links show
 * their text, bullets, task boxes and rules are drawn — everywhere except on the lines that hold the
 * cursor or a selection, which show the Markdown as written so it can be edited.
 *
 * Footnotes ([^1]) are left exactly as written: the AGLC4 plugin underlines and edits footnote syntax.
 */
import { syntaxTree } from '@codemirror/language';
import type { EditorState, Extension } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, WidgetType } from '@codemirror/view';
import { isImage } from './attachments';
import { isMedia } from './media';

export interface LivePreviewOptions {
	/** Open a link clicked in the formatted text. */
	onOpenLink(link: { type: 'wiki' | 'url'; target: string }, newLeaf: boolean): void;
}

const hide = Decoration.replace({});

class BulletWidget extends WidgetType {
	override eq(): boolean { return true; }
	toDOM(): HTMLElement {
		const s = document.createElement('span');
		s.className = 'cm-lp-bullet';
		s.textContent = '•';
		return s;
	}
}

class CheckboxWidget extends WidgetType {
	constructor(readonly checked: boolean, readonly pos: number) { super(); }
	override eq(o: CheckboxWidget): boolean { return o.checked === this.checked && o.pos === this.pos; }
	toDOM(view: EditorView): HTMLElement {
		const box = document.createElement('input');
		box.type = 'checkbox';
		box.className = 'cm-lp-task';
		box.checked = this.checked;
		box.addEventListener('mousedown', (e) => e.preventDefault());
		box.addEventListener('click', (e) => {
			e.preventDefault();
			// The marker is "[ ]" or "[x]" at pos: change the middle character.
			view.dispatch({ changes: { from: this.pos + 1, to: this.pos + 2, insert: this.checked ? ' ' : 'x' }, userEvent: 'input.toggle' });
		});
		return box;
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

function build(view: EditorView): DecorationSet {
	const { state } = view;
	const doc = state.doc;
	const active = activeLines(state);
	// %% comments %% are shown as written, like the active lines.
	const comments: [number, number][] = [];
	const all = doc.toString();
	for (const m of all.matchAll(/%%[\s\S]*?(?:%%|$)/g)) if (m[0].length) comments.push([m.index, m.index + m[0].length]);
	const isActive = (pos: number) => active.has(doc.lineAt(pos).number) || comments.some(([a, b]) => pos >= a && pos < b);
	const items: { from: number; to: number; deco: Decoration }[] = [];
	const lineClasses = new Map<number, string>();
	const add = (from: number, to: number, deco: Decoration) => { if (to > from || (to === from && (deco.spec as { widget?: unknown }).widget)) items.push({ from, to, deco }); };
	const lineClass = (pos: number, cls: string) => { lineClasses.set(doc.lineAt(pos).from, cls); };

	for (const { from, to } of view.visibleRanges) {
		syntaxTree(state).iterate({
			from,
			to,
			enter: (node) => {
				const name = node.name;
				if (name === 'Frontmatter' || name === 'FencedCode' || name === 'CodeBlock' || name === 'Table') return false;
				if (isActive(node.from)) return;
				switch (name) {
					case 'HeaderMark': {
						// "# " before the heading text.
						const after = doc.sliceString(node.to, node.to + 1) === ' ' ? 1 : 0;
						add(node.from, node.to + after, hide);
						break;
					}
					case 'EmphasisMark':
					case 'StrikethroughMark':
					case 'CodeMark':
						if (node.node.parent?.name !== 'FencedCode') add(node.from, node.to, hide);
						break;
					case 'QuoteMark': {
						const after = doc.sliceString(node.to, node.to + 1) === ' ' ? 1 : 0;
						add(node.from, node.to + after, hide);
						lineClass(node.from, 'cm-lp-quote');
						break;
					}
					case 'ListMark':
						if (node.node.parent?.parent?.name === 'BulletList') {
							const item = node.node.parent;
							// A task item draws its checkbox instead of the bullet.
							if (item && item.getChild('Task')) { add(node.from, node.to + 1, hide); break; }
							add(node.from, node.to, Decoration.replace({ widget: new BulletWidget() }));
						}
						break;
					case 'TaskMarker': {
						const checked = /x/i.test(doc.sliceString(node.from, node.to));
						add(node.from, node.to, Decoration.replace({ widget: new CheckboxWidget(checked, node.from) }));
						if (checked) add(node.to, doc.lineAt(node.to).to, Decoration.mark({ class: 'cm-lp-task-done' }));
						break;
					}
					case 'HorizontalRule':
						add(node.from, node.to, Decoration.replace({ widget: new RuleWidget() }));
						break;
					case 'Link': {
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
			if (isActive(start) || insideCode(state, start)) continue;
			if (m[4] !== undefined) {
				add(start, start + 2, hide);
				add(end - 2, end, hide);
				continue;
			}
			const target = m[2]!.trim();
			if (m[1] === '!') {
				// A picture or a player shows below the line: hide its embed text.
				const bare = target.replace(/[#^].*$/, '');
				if (isImage(bare) || isMedia(bare)) add(start, end, hide);
				continue;
			}
			const textFrom = m[3] !== undefined ? start + 2 + m[2]!.length + 1 : start + 2;
			add(start, textFrom, hide);
			add(textFrom, end - 2, Decoration.mark({ class: 'cm-lp-link cm-lp-wikilink', attributes: { 'data-href': target, 'data-kind': 'wiki' } }));
			add(end - 2, end, hide);
		}
	}

	for (const [pos, cls] of lineClasses) items.push({ from: pos, to: pos, deco: Decoration.line({ class: cls }) });
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
		constructor(view: EditorView) { this.decorations = build(view); }
		update(u: ViewUpdate) {
			if (u.docChanged || u.viewportChanged || u.selectionSet || syntaxTree(u.startState) !== syntaxTree(u.state)) {
				this.decorations = build(u.view);
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

	return [plugin, clicks, EditorView.editorAttributes.of({ class: 'is-live-preview' })];
}
