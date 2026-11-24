import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown, markdownKeymap, markdownLanguage } from '@codemirror/lang-markdown';
import { HighlightStyle, indentOnInput, syntaxHighlighting } from '@codemirror/language';
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search';
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { EditorState, type Extension, RangeSetBuilder } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, drawSelection, dropCursor, keymap, rectangularSelection } from '@codemirror/view';
import { tags as t } from '@lezer/highlight';
import type { MarkdownConfig } from '@lezer/markdown';

/** YAML frontmatter at the very top of a note, parsed as one block (not as a setext heading). */
const frontmatter: MarkdownConfig = {
	defineNodes: [{ name: 'Frontmatter', block: true, style: t.meta }],
	parseBlock: [{
		name: 'Frontmatter',
		before: 'HorizontalRule',
		parse(cx, line) {
			if (cx.lineStart !== 0 || line.text !== '---') return false;
			const start = cx.lineStart;
			while (cx.nextLine()) {
				if (line.text === '---' || line.text === '...') {
					const end = cx.lineStart + line.text.length;
					cx.nextLine();
					cx.addElement(cx.elt('Frontmatter', start, end));
					return true;
				}
			}
			cx.addElement(cx.elt('Frontmatter', start, cx.lineStart));
			return true;
		},
	}],
};

/** Markdown syntax as CSS classes, styled by the theme. */
export const quireHighlight = HighlightStyle.define([
	{ tag: t.heading1, class: 'cm-header cm-header-1' },
	{ tag: t.heading2, class: 'cm-header cm-header-2' },
	{ tag: t.heading3, class: 'cm-header cm-header-3' },
	{ tag: t.heading4, class: 'cm-header cm-header-4' },
	{ tag: t.heading5, class: 'cm-header cm-header-5' },
	{ tag: t.heading6, class: 'cm-header cm-header-6' },
	{ tag: t.strong, class: 'cm-strong' },
	{ tag: t.emphasis, class: 'cm-em' },
	{ tag: t.strikethrough, class: 'cm-strikethrough' },
	{ tag: t.link, class: 'cm-link' },
	{ tag: t.url, class: 'cm-url' },
	{ tag: t.monospace, class: 'cm-inline-code' },
	{ tag: t.quote, class: 'cm-quote' },
	{ tag: t.list, class: 'cm-list' },
	{ tag: t.processingInstruction, class: 'cm-formatting' },
	{ tag: t.contentSeparator, class: 'cm-hr' },
	{ tag: t.comment, class: 'cm-comment' },
	{ tag: t.meta, class: 'cm-meta' },
	{ tag: t.labelName, class: 'cm-label' },
	{ tag: t.keyword, class: 'cm-keyword' },
	{ tag: t.string, class: 'cm-string' },
	{ tag: t.number, class: 'cm-number' },
	{ tag: t.atom, class: 'cm-atom' },
	{ tag: t.variableName, class: 'cm-variable' },
	{ tag: t.typeName, class: 'cm-type' },
	{ tag: t.propertyName, class: 'cm-property' },
	{ tag: t.operator, class: 'cm-operator' },
]);

const wikilinkMark = Decoration.mark({ class: 'cm-wikilink' });
const footnoteRefMark = Decoration.mark({ class: 'cm-footnote-ref' });
const footnoteDefMark = Decoration.mark({ class: 'cm-footnote-def' });
const highlightMark = Decoration.mark({ class: 'cm-highlight' });
const commentMark = Decoration.mark({ class: 'cm-comment cm-percent-comment' });
const frontmatterLine = Decoration.line({ class: 'cm-frontmatter' });
const frontmatterEnd = Decoration.line({ class: 'cm-frontmatter cm-frontmatter-end' });
const commentLine = Decoration.line({ class: 'cm-comment-line' });

/** Style [[links]], [^footnotes], ==highlights== and the frontmatter block. */
const inlineMarks = ViewPlugin.fromClass(class {
	decorations: DecorationSet;
	constructor(view: EditorView) { this.decorations = this.build(view); }
	update(u: ViewUpdate) { if (u.docChanged || u.viewportChanged) this.decorations = this.build(u.view); }
	build(view: EditorView): DecorationSet {
		const builder = new RangeSetBuilder<Decoration>();
		const doc = view.state.doc;
		const ranges: { from: number; to: number; deco: Decoration }[] = [];
		// Frontmatter lines.
		if (doc.lines > 1 && doc.line(1).text === '---') {
			for (let n = 2; n <= Math.min(doc.lines, 500); n++) {
				if (doc.line(n).text === '---' || doc.line(n).text === '...') {
					for (let k = 1; k <= n; k++) { const l = doc.line(k); ranges.push({ from: l.from, to: l.from, deco: k === n ? frontmatterEnd : frontmatterLine }); }
					break;
				}
			}
		}
		// %% comments %% (may span lines).
		const all = doc.toString();
		const cre = /%%[\s\S]*?(?:%%|$)/g;
		for (let m = cre.exec(all); m; m = cre.exec(all)) {
			if (m[0].length > 0) ranges.push({ from: m.index, to: m.index + m[0].length, deco: commentMark });
			// A comment over several lines reads as a block: a rule beside every line of it.
			const first = doc.lineAt(m.index);
			const last = doc.lineAt(m.index + m[0].length);
			if (last.number > first.number) for (let n = first.number; n <= last.number; n++) { const l = doc.line(n); ranges.push({ from: l.from, to: l.from, deco: commentLine }); }
			if (m[0].length === 0) cre.lastIndex++;
		}
		for (const { from, to } of view.visibleRanges) {
			const text = doc.sliceString(from, to);
			const re = /(!?\[\[[^\]\n]+\]\])|(\[\^[^\]\s]+\](:)?)|(==[^=\n]+==)/g;
			for (let m = re.exec(text); m; m = re.exec(text)) {
				const a = from + m.index;
				const b = a + m[0].length;
				if (m[1]) ranges.push({ from: a, to: b, deco: wikilinkMark });
				else if (m[2]) {
					const line = doc.lineAt(a);
					ranges.push({ from: a, to: b, deco: m[3] && a === line.from ? footnoteDefMark : footnoteRefMark });
				} else ranges.push({ from: a, to: b, deco: highlightMark });
			}
		}
		ranges.sort((x, y) => x.from - y.from || x.to - y.to);
		for (const r of ranges) builder.add(r.from, r.to, r.deco);
		return builder.finish();
	}
}, { decorations: (v) => v.decorations });

/** The [[link]] or URL at a document offset. */
export function linkAt(state: EditorState, pos: number): { type: 'wiki' | 'url'; target: string } | null {
	const line = state.doc.lineAt(pos);
	const text = line.text;
	const at = pos - line.from;
	const wiki = /!?\[\[([^\]\n|]+)(?:\|[^\]\n]*)?\]\]/g;
	for (let m = wiki.exec(text); m; m = wiki.exec(text)) {
		if (at >= m.index && at <= m.index + m[0].length) return { type: 'wiki', target: m[1]!.trim() };
	}
	const md = /\[[^\]\n]*\]\(([^)\s]+)\)/g;
	for (let m = md.exec(text); m; m = md.exec(text)) {
		if (at >= m.index && at <= m.index + m[0].length) {
			const target = m[1]!;
			return /^[a-z][a-z0-9+.-]*:/i.test(target) ? { type: 'url', target } : { type: 'wiki', target: decodeURIComponent(target) };
		}
	}
	const url = /\bhttps?:\/\/[^\s)>\]]+/g;
	for (let m = url.exec(text); m; m = url.exec(text)) {
		if (at >= m.index && at <= m.index + m[0].length) return { type: 'url', target: m[0] };
	}
	return null;
}

/** Auto-paired brackets and quotes (its own compartment, so the setting applies to open notes). */
export function bracketExtensions(on: boolean): Extension {
	return on ? [closeBrackets(), keymap.of(closeBracketsKeymap)] : [];
}

export interface SetupOptions {
	onFollowLink(link: { type: 'wiki' | 'url'; target: string }, newLeaf: boolean): void;
	/** Files pasted or dropped at `pos`; return true when handled. */
	onFiles?(files: File[], pos: number): boolean;
	/** A note dragged from the file tree, dropped at `pos`; return true when handled. */
	onDropPath?(path: string, pos: number): boolean;
	spellcheck: boolean;
	closeBrackets: boolean;
}

/** The editor's built-in extensions. */
export function baseExtensions(opts: SetupOptions): Extension[] {
	return [
		history(),
		drawSelection(),
		dropCursor(),
		rectangularSelection(),
		indentOnInput(),
		EditorState.allowMultipleSelections.of(true),
		highlightSelectionMatches(),
		search({ top: true }),
		markdown({ base: markdownLanguage, addKeymap: true, extensions: [frontmatter] }),
		syntaxHighlighting(quireHighlight),
		EditorView.lineWrapping,
		EditorView.contentAttributes.of({ spellcheck: opts.spellcheck ? 'true' : 'false', autocorrect: 'off', autocapitalize: 'off' }),
		inlineMarks,
		keymap.of([
			...markdownKeymap,
			...defaultKeymap,
			...historyKeymap,
			...searchKeymap,
			indentWithTab,
		]),
		EditorView.domEventHandlers({
			paste(e, view) {
				const files = [...(e.clipboardData?.files ?? [])];
				if (files.length === 0 || !opts.onFiles) return false;
				e.preventDefault();
				return opts.onFiles(files, view.state.selection.main.head);
			},
			drop(e, view) {
				const pos = view.posAtCoords({ x: e.clientX, y: e.clientY }) ?? view.state.selection.main.head;
				const path = e.dataTransfer?.getData('text/x-quire-path');
				if (path && opts.onDropPath) { e.preventDefault(); return opts.onDropPath(path, pos); }
				const files = [...(e.dataTransfer?.files ?? [])];
				if (files.length === 0 || !opts.onFiles) return false;
				e.preventDefault();
				return opts.onFiles(files, pos);
			},
			mousedown(e, view) {
				if (e.button !== 0 || !(e.ctrlKey || e.metaKey)) return false;
				const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
				if (pos === null) return false;
				const link = linkAt(view.state, pos);
				if (!link) return false;
				e.preventDefault();
				opts.onFollowLink(link, e.shiftKey || e.altKey);
				return true;
			},
		}),
	];
}
