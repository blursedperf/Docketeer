/**
 * Slash commands: "/" at the start of a line or after a space opens a menu of things to insert (headings,
 * lists, a task, a table, a code block, a quote, a divider, a link, an embed, a footnote, the date, and law
 * scaffolds). Typing filters it ("/tab" → Table); Enter inserts. It never opens inside a word ("and/or"),
 * in code, or in the properties.
 */
import { syntaxTree } from '@codemirror/language';
import { type App, type Editor, type EditorPosition, EditorSuggest, type EditorSuggestContext, type EditorSuggestTriggerInfo, fuzzyScore, setIcon } from '@quire/api';

/** Where the cursor goes in a template, and (optionally) where a selection from there ends. */
const CURSOR = '\u2038';
const SELECT_END = '\u2041';

export interface SlashItem {
	id: string;
	name: string;
	icon: string;
	/** Other words that find it ("h2", "grid", "checkbox"). */
	aliases?: string[];
	/** Shown at the right: what it inserts, or its key. */
	hint?: string;
	/**
	 * `line`: replaces the start of the current line (a heading, a list item). `block`: whole lines, put on a line
	 * of their own. `inline`: at the cursor.
	 */
	kind: 'line' | 'block' | 'inline';
	/** The text to insert, with CURSOR where the cursor goes (at the end if none). */
	text?: (app: App) => string;
	/** Or run something instead (after the "/query" is removed). */
	run?: (app: App, editor: Editor) => void;
	/** Only offered when this is true. */
	when?: (app: App) => boolean;
}

const today = () => new Date().toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });

/** A table with `cols` columns and `rows` empty rows; "Column 1" is selected, so typing names it. */
const table = (cols: number, rows: number) => {
	const head = `| ${Array.from({ length: cols }, (_, i) => (i === 0 ? `${CURSOR}Column 1${SELECT_END}` : `Column ${i + 1}`)).join(' | ')} |`;
	const rule = `| ${Array.from({ length: cols }, () => '---').join(' | ')} |`;
	const body = Array.from({ length: rows }, () => `| ${Array.from({ length: cols }, () => ' ').join(' | ')} |`);
	return [head, rule, ...body].join('\n');
};

/** The built-in items, in the order shown before anything is typed. */
export const SLASH_ITEMS: SlashItem[] = [
	{ id: 'h1', name: 'Heading 1', icon: 'heading-1', aliases: ['h1', 'title'], hint: '#', kind: 'line', text: () => '# ' },
	{ id: 'h2', name: 'Heading 2', icon: 'heading-2', aliases: ['h2', 'section'], hint: '##', kind: 'line', text: () => '## ' },
	{ id: 'h3', name: 'Heading 3', icon: 'heading-3', aliases: ['h3', 'subsection'], hint: '###', kind: 'line', text: () => '### ' },
	{ id: 'bullet', name: 'Bulleted list', icon: 'list', aliases: ['ul', 'bullets', 'unordered'], hint: '-', kind: 'line', text: () => '- ' },
	{ id: 'numbered', name: 'Numbered list', icon: 'list-ordered', aliases: ['ol', 'ordered', 'numbers'], hint: '1.', kind: 'line', text: () => '1. ' },
	{ id: 'task', name: 'Task', icon: 'check-square', aliases: ['todo', 'checkbox', 'checklist'], hint: '- [ ]', kind: 'line', text: () => '- [ ] ' },
	{ id: 'quote', name: 'Quote', icon: 'quote', aliases: ['blockquote', 'excerpt'], hint: '>', kind: 'line', text: () => '> ' },
	{ id: 'table', name: 'Table', icon: 'table', aliases: ['grid', 'columns'], hint: '3 × 2', kind: 'block', text: () => table(3, 2) },
	{ id: 'table2', name: 'Table, two columns', icon: 'table', aliases: ['grid', 'compare', 'versus'], hint: '2 × 3', kind: 'block', text: () => table(2, 3) },
	{ id: 'code', name: 'Code block', icon: 'code', aliases: ['fence', 'pre'], hint: '```', kind: 'block', text: () => `\`\`\`\n${CURSOR}\n\`\`\`` },
	{ id: 'divider', name: 'Divider', icon: 'minus', aliases: ['hr', 'rule', 'line', 'separator'], hint: '---', kind: 'block', text: () => `---\n${CURSOR}` },
	{ id: 'link', name: 'Link to a note', icon: 'link', aliases: ['wikilink', 'reference'], hint: '[[', kind: 'inline', text: () => `[[${CURSOR}]]` },
	{ id: 'embed', name: 'Embed a recording, PDF or picture', icon: 'paperclip', aliases: ['attachment', 'image', 'audio', 'video', 'pdf'], hint: '![[', kind: 'inline', text: () => `![[${CURSOR}]]` },
	{
		id: 'footnote', name: 'Footnote', icon: 'superscript', aliases: ['citation', 'cite', 'aglc'], hint: '[^1]', kind: 'inline',
		// The AGLC4 plugin's footnote numbers and renumbers; without it, a plain footnote.
		run: (app, editor) => {
			if (app.commands.findCommand('aglc-citations:insert-footnote')) { app.commands.executeCommandById('aglc-citations:insert-footnote'); return; }
			const used = [...editor.getValue().matchAll(/\[\^(\d+)\]/g)].map((m) => Number(m[1]));
			const n = (used.length ? Math.max(...used) : 0) + 1;
			const cursor = editor.getCursor();
			editor.replaceRange(`[^${n}]`, cursor);
			const end = editor.lineCount() - 1;
			const last = editor.getLine(end);
			editor.replaceRange(`${last.trim() ? '\n' : ''}\n[^${n}]: `, { line: end, ch: last.length });
			editor.setCursor({ line: editor.lineCount() - 1, ch: `[^${n}]: `.length });
		},
	},
	{ id: 'highlight', name: 'Highlight', icon: 'highlighter', aliases: ['mark'], hint: '==', kind: 'inline', text: () => `==${CURSOR}==` },
	{ id: 'comment', name: 'Comment (hidden when reading)', icon: 'message-square', aliases: ['note to self', 'private'], hint: '%%', kind: 'inline', text: () => `%% ${CURSOR} %%` },
	{ id: 'date', name: "Today's date", icon: 'calendar', aliases: ['today', 'now'], hint: today(), kind: 'inline', text: () => today() },
	{
		id: 'timestamp', name: 'Timestamp in the recording', icon: 'clock', aliases: ['time', 'lecture'], hint: 'Alt+T', kind: 'inline',
		when: (app) => app.media.current() !== null, run: (app) => app.commands.executeCommandById('media:insert-timestamp'),
	},
	{ id: 'case-brief', name: 'Case brief', icon: 'scale', aliases: ['brief', 'facts', 'ratio', 'case'], hint: 'Facts … Obiter', kind: 'block', text: () => `## Facts\n\n${CURSOR}\n\n## Issues\n\n## Held\n\n## Ratio\n\n## Obiter\n` },
	{ id: 'irac', name: 'IRAC answer', icon: 'list-checks', aliases: ['problem question', 'issue rule', 'answer'], hint: 'Issue … Conclusion', kind: 'block', text: () => `## Issue\n\n${CURSOR}\n\n## Rule\n\n## Application\n\n## Conclusion\n` },
];

/** Put `text` in place of `from`..`to`; the cursor goes to CURSOR (or the end), selecting to SELECT_END if there is one. */
export function insertTemplate(editor: Editor, text: string, from: EditorPosition, to: EditorPosition): void {
	const at = text.indexOf(CURSOR);
	const withoutCursor = text.replace(CURSOR, '');
	const end = withoutCursor.indexOf(SELECT_END);
	const clean = withoutCursor.replace(SELECT_END, '');
	editor.replaceRange(clean, from, to);
	const posAt = (offset: number): EditorPosition => {
		const before = clean.slice(0, offset).split('\n');
		return { line: from.line + before.length - 1, ch: before.length === 1 ? from.ch + before[0]!.length : before[before.length - 1]!.length };
	};
	const anchor = posAt(at === -1 ? clean.length : at);
	if (end !== -1 && at !== -1) editor.setSelection(anchor, posAt(end));
	else editor.setCursor(anchor);
}

/**
 * Items for `query`, best first: names that start with it, then a word of a name or alias that does, then loose
 * (fuzzy) matches. Equal ones keep the menu's order.
 */
export function rankSlashItems(query: string, items: SlashItem[]): SlashItem[] {
	const q = query.trim().toLowerCase();
	if (!q) return items;
	const scored: { item: SlashItem; score: number; i: number }[] = [];
	items.forEach((item, i) => {
		const texts = [item.name, ...(item.aliases ?? [])].map((t) => t.toLowerCase());
		let score: number | null = null;
		if (texts[0]!.startsWith(q)) score = 3000;
		else if (texts.some((t) => t.split(/[\s,]+/).some((w) => w.startsWith(q)))) score = 2000;
		else {
			for (const t of texts) {
				const f = fuzzyScore(q, t);
				if (f !== null && (score === null || f > score)) score = Math.min(f, 1000);
			}
		}
		if (score !== null) scored.push({ item, score, i });
	});
	return scored.sort((a, b) => b.score - a.score || a.i - b.i).map((s) => s.item);
}

export class SlashSuggest extends EditorSuggest<SlashItem> {
	constructor(app: App, private items: () => SlashItem[] = () => SLASH_ITEMS) {
		super(app);
		this.limit = 30;
		this.setInstructions([{ command: '↑↓', purpose: 'to navigate' }, { command: '↵', purpose: 'to insert' }, { command: 'esc', purpose: 'to dismiss' }]);
	}

	onTrigger(cursor: EditorPosition, editor: Editor): EditorSuggestTriggerInfo | null {
		const before = editor.getLine(cursor.line).slice(0, cursor.ch);
		const m = /(^|\s)\/([\p{L}\p{N} ]{0,24})$/u.exec(before);
		if (!m) return null;
		const query = m[2] ?? '';
		// A space right after the slash is prose ("this / that"), not a command.
		if (query.startsWith(' ')) return null;
		// Inside inline code still being typed (an odd number of backticks before): code, not a command.
		if (((before.slice(0, m.index).match(/`/g) ?? []).length) % 2 === 1) return null;
		const pos = editor.posToOffset({ line: cursor.line, ch: cursor.ch - query.length - 1 });
		if (inCodeOrProperties(editor, pos)) return null;
		return { start: { line: cursor.line, ch: cursor.ch - query.length - 1 }, end: cursor, query };
	}

	getSuggestions(ctx: EditorSuggestContext): SlashItem[] {
		const available = this.items().filter((i) => !i.when || i.when(this.app));
		return rankSlashItems(ctx.query, available);
	}

	renderSuggestion(item: SlashItem, el: HTMLElement): void {
		el.addClass('mod-complex', 'slash-item');
		setIcon(el.createDiv({ cls: 'slash-item-icon' }), item.icon);
		el.createDiv({ cls: 'suggestion-content', text: item.name });
		if (item.hint) el.createDiv({ cls: 'suggestion-note', text: item.hint });
	}

	selectSuggestion(item: SlashItem): void {
		const ctx = this.context;
		if (!ctx) return;
		this.close();
		applySlashItem(this.app, ctx.editor, item, ctx.start, ctx.end);
	}
}

/** Replace the "/query" from `start` to `end` with `item`. */
export function applySlashItem(app: App, editor: Editor, item: SlashItem, start: EditorPosition, end: EditorPosition): void {
	const line = editor.getLine(start.line);
	const before = line.slice(0, start.ch);
	const after = line.slice(end.ch);
	if (item.run) {
		editor.replaceRange('', start, end);
		editor.setCursor(start);
		item.run(app, editor);
		return;
	}
	const text = item.text!(app);
	if (item.kind === 'inline') {
		insertTemplate(editor, text, start, end);
		return;
	}
	if (item.kind === 'line') {
		// The line becomes that kind of line: its own list, quote or heading marks are replaced.
		const marks = /^\s*(?:#{1,6}\s+|[-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d+[.)]\s+|>\s*)?/;
		const indent = /^\s*/.exec(before)![0];
		// The text before the slash, without the space typed before it when nothing follows.
		const head = after ? before.replace(marks, '') : before.replace(marks, '').trimEnd();
		const rest = head + after;
		const cursorAt = head.length;
		const full = `${indent}${text}${rest}`;
		editor.replaceRange(full, { line: start.line, ch: 0 }, { line: start.line, ch: line.length });
		editor.setCursor({ line: start.line, ch: indent.length + text.length + cursorAt });
		return;
	}
	// A block: on lines of its own, after any text before the slash, and before any text after it.
	const lead = before.trim() ? `${before.trimEnd()}\n\n` : before;
	const tail = after.trim() ? `\n\n${after.trimStart()}` : after;
	editor.replaceRange('', { line: start.line, ch: 0 }, { line: start.line, ch: line.length });
	insertTemplate(editor, `${lead}${text}${tail}`, { line: start.line, ch: 0 }, { line: start.line, ch: 0 });
}

function inCodeOrProperties(editor: Editor, pos: number): boolean {
	const state = editor.cm.state;
	const first = state.doc.line(1).text;
	if (first === '---') {
		for (let n = 2; n <= Math.min(state.doc.lines, 500); n++) {
			const l = state.doc.line(n);
			if (l.text === '---' || l.text === '...') { if (pos <= l.to) return true; break; }
		}
	}
	let node: { name: string; parent: unknown } | null = syntaxTree(state).resolveInner(pos, -1) as unknown as { name: string; parent: unknown };
	while (node) {
		if (['InlineCode', 'FencedCode', 'CodeBlock', 'CodeText', 'Frontmatter', 'URL'].includes(node.name)) return true;
		node = node.parent as typeof node;
	}
	return false;
}
