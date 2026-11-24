import { type App, type Editor, type EditorPosition, EditorSuggest, type EditorSuggestContext, type EditorSuggestTriggerInfo, TFile, fuzzyScore } from '@quire/api';

type Item = { kind: 'file'; file: TFile; score: number } | { kind: 'heading'; file: TFile; heading: string; level: number } | { kind: 'new'; name: string };

/**
 * `[[` link completion: notes and files by name (fuzzy), then after "#" the headings of the chosen
 * note. Choosing one writes the link and closes it.
 */
export class LinkSuggest extends EditorSuggest<Item> {
	constructor(app: App) {
		super(app);
		this.limit = 50;
		this.setInstructions([{ command: '↑↓', purpose: 'to navigate' }, { command: '↵', purpose: 'to insert' }, { command: '#', purpose: 'for a heading' }, { command: 'esc', purpose: 'to dismiss' }]);
	}

	onTrigger(cursor: EditorPosition, editor: Editor): EditorSuggestTriggerInfo | null {
		const before = editor.getLine(cursor.line).slice(0, cursor.ch);
		const m = /!?\[\[([^\]\[\n|]*)$/.exec(before);
		if (!m) return null;
		const query = m[1] ?? '';
		return { start: { line: cursor.line, ch: cursor.ch - query.length }, end: cursor, query };
	}

	getSuggestions(ctx: EditorSuggestContext): Item[] {
		const { vault, metadataCache } = this.app;
		const hash = ctx.query.indexOf('#');
		if (hash !== -1) {
			const name = ctx.query.slice(0, hash);
			const want = ctx.query.slice(hash + 1).toLowerCase();
			const file = name ? metadataCache.getFirstLinkpathDest(name, ctx.file?.path ?? '') : ctx.file;
			if (!file) return [];
			return (metadataCache.getFileCache(file)?.headings ?? [])
				.filter((h) => h.heading.toLowerCase().includes(want))
				.map((h) => ({ kind: 'heading' as const, file, heading: h.heading, level: h.level }));
		}
		const items: Item[] = [];
		for (const file of vault.getFiles()) {
			if (file === ctx.file) continue;
			const label = file.extension === 'md' ? file.path.slice(0, -3) : file.path;
			const score = fuzzyScore(ctx.query, label);
			if (score !== null) items.push({ kind: 'file', file, score: score + (file.extension === 'md' ? 1 : 0) });
		}
		items.sort((a, b) => (b as { score: number }).score - (a as { score: number }).score || (a as { file: TFile }).file.path.localeCompare((b as { file: TFile }).file.path));
		const q = ctx.query.trim();
		if (q && !vault.getMarkdownFiles().some((f) => f.basename.toLowerCase() === q.toLowerCase())) items.push({ kind: 'new', name: q });
		return items;
	}

	renderSuggestion(item: Item, el: HTMLElement): void {
		el.addClass('mod-complex');
		if (item.kind === 'new') {
			el.createDiv({ cls: 'suggestion-content', text: item.name });
			el.createDiv({ cls: 'suggestion-note', text: 'new note' });
			return;
		}
		if (item.kind === 'heading') {
			const c = el.createDiv({ cls: 'suggestion-content' });
			c.createSpan({ cls: 'suggestion-prefix', text: `${'#'.repeat(item.level)} ` });
			c.createSpan({ text: item.heading });
			return;
		}
		el.createDiv({ cls: 'suggestion-content', text: item.file.extension === 'md' ? item.file.basename : item.file.name });
		if (item.file.parent && !item.file.parent.isRoot()) el.createDiv({ cls: 'suggestion-note', text: item.file.parent.path });
	}

	selectSuggestion(item: Item): void {
		const ctx = this.context;
		if (!ctx) return;
		const { editor } = ctx;
		const source = ctx.file?.path ?? '';
		let target: string;
		if (item.kind === 'new') target = item.name;
		else if (item.kind === 'heading') {
			const name = ctx.query.slice(0, ctx.query.indexOf('#'));
			target = `${name}#${item.heading}`;
		} else target = this.app.metadataCache.fileToLinktext(item.file, source);
		// Close the link unless "]]" already follows (from auto-paired brackets or editing an old link).
		const after = editor.getLine(ctx.end.line).slice(ctx.end.ch);
		const closing = after.startsWith(']]') ? '' : ']]';
		editor.replaceRange(target + closing, ctx.start, ctx.end);
		const ch = ctx.start.ch + target.length + 2;
		editor.setCursor({ line: ctx.start.line, ch });
		this.close();
	}
}
