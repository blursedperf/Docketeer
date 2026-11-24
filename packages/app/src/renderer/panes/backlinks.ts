import { ItemView, Notice, TFile, type WorkspaceLeaf, debounce, escapeRegExp } from '@quire/api';
import { groupHeader, lineAround, openAt, renderMarked } from './common';

export const BACKLINK_VIEW = 'backlink';

/** Notes that link to the active note, and notes that mention its name without a link. */
export class BacklinksView extends ItemView {
	private file: TFile | null = null;
	private bodyEl!: HTMLElement;
	private showUnlinked = true;
	private readonly refresh = debounce(() => { void this.render(); }, 300, true);

	constructor(leaf: WorkspaceLeaf) {
		super(leaf);
		this.icon = 'link';
	}

	getViewType(): string { return BACKLINK_VIEW; }
	getDisplayText(): string { return this.file ? `Backlinks: ${this.file.basename}` : 'Backlinks'; }

	override getState(): Record<string, unknown> { return { showUnlinked: this.showUnlinked }; }
	override async setState(state: unknown): Promise<void> {
		const s = state as { showUnlinked?: boolean } | null;
		if (typeof s?.showUnlinked === 'boolean') this.showUnlinked = s.showUnlinked;
	}

	override async onOpen(): Promise<void> {
		this.contentEl.addClass('backlinks-pane');
		this.bodyEl = this.contentEl.createDiv({ cls: 'pane-results' });
		this.registerEvent(this.app.workspace.on('file-open', () => this.follow()));
		this.registerEvent(this.app.metadataCache.on('resolved', () => this.refresh()));
		this.registerEvent(this.app.vault.on('rename', () => this.refresh()));
		this.follow();
	}

	private follow() {
		const f = this.app.workspace.getActiveFile();
		const file = f && f.extension === 'md' ? f : null;
		if (file !== this.file) { this.file = file; this.leaf.updateHeader(); }
		void this.render();
	}

	private async render(): Promise<void> {
		const file = this.file;
		this.bodyEl.empty();
		if (!file) { this.bodyEl.createDiv({ cls: 'pane-empty', text: 'Open a note to see what links to it.' }); return; }
		const { vault, metadataCache } = this.app;

		// Linked mentions.
		const linked = [...metadataCache.getBacklinksForFile(file)].filter(([p]) => p !== file.path).sort((a, b) => a[0].localeCompare(b[0]));
		const count = linked.reduce((n, [, l]) => n + l.length, 0);
		const linkedBody = createDiv({ cls: 'pane-group-body' });
		groupHeader(this.bodyEl, 'Linked mentions', count, true, (o) => linkedBody.toggle(o)).addClass('pane-section');
		this.bodyEl.appendChild(linkedBody);
		if (linked.length === 0) linkedBody.createDiv({ cls: 'pane-empty', text: 'No notes link here.' });
		for (const [path, links] of linked) {
			const src = vault.getFileByPath(path);
			if (!src) continue;
			const text = await vault.cachedRead(src);
			linkedBody.createDiv({ cls: 'pane-file', text: src.basename, attr: { title: src.path } }).addEventListener('click', (e) => openAt(this.app, src, {}, e));
			for (const l of links) {
				const from = l.position.start.offset;
				const to = l.position.end.offset;
				const line = lineAround(text, from, to);
				const row = linkedBody.createDiv({ cls: 'pane-match' });
				renderMarked(row, line.text, [[from - line.start, to - line.start]]);
				row.addEventListener('click', (e) => openAt(this.app, src, { from, to }, e));
			}
		}

		// Unlinked mentions: the note's name as a whole word, outside links, code and frontmatter.
		const unlinkedBody = createDiv({ cls: 'pane-group-body' });
		const head = groupHeader(this.bodyEl, 'Unlinked mentions', null, this.showUnlinked, (o) => {
			this.showUnlinked = o;
			unlinkedBody.toggle(o);
			this.app.workspace.requestSaveLayout();
		});
		head.addClass('pane-section');
		this.bodyEl.appendChild(unlinkedBody);
		unlinkedBody.toggle(this.showUnlinked);
		const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(file.basename)}(?![\\p{L}\\p{N}])`, 'giu');
		let found = 0;
		for (const src of vault.getMarkdownFiles()) {
			if (src === file) continue;
			const text = await vault.cachedRead(src);
			const cache = metadataCache.getFileCache(src);
			const skip: [number, number][] = [
				...(cache?.links ?? []), ...(cache?.embeds ?? []),
			].map((l) => [l.position.start.offset, l.position.end.offset] as [number, number]);
			if (cache?.frontmatterPosition) skip.push([0, cache.frontmatterPosition.end.offset]);
			for (const m of text.matchAll(/```[\s\S]*?```|`[^`\n]*`/g)) skip.push([m.index, m.index + m[0].length]);
			const hits = [...text.matchAll(re)].filter((m) => !skip.some(([a, b]) => m.index >= a && m.index < b));
			if (hits.length === 0) continue;
			found += hits.length;
			unlinkedBody.createDiv({ cls: 'pane-file', text: src.basename, attr: { title: src.path } }).addEventListener('click', (e) => openAt(this.app, src, {}, e));
			for (const m of hits.slice(0, 10)) {
				const from = m.index;
				const to = from + m[0].length;
				const line = lineAround(text, from, to);
				const row = unlinkedBody.createDiv({ cls: 'pane-match' });
				const snippet = row.createDiv({ cls: 'pane-match-text' });
				renderMarked(snippet, line.text, [[from - line.start, to - line.start]]);
				snippet.addEventListener('click', (e) => openAt(this.app, src, { from, to }, e));
				const btn = row.createEl('button', { cls: 'pane-link-button', text: 'Link' });
				btn.addEventListener('click', () => { void this.link(src, from, to, m[0]); });
			}
		}
		if (found === 0) unlinkedBody.createDiv({ cls: 'pane-empty', text: 'No unlinked mentions.' });
		head.querySelector('.tree-item-flair')?.detach();
		head.createDiv({ cls: 'tree-item-flair', text: String(found) });
	}

	/** Turn a mention into a [[link]] (keeping the text as written when it differs from the name). */
	private async link(src: TFile, from: number, to: number, written: string) {
		const file = this.file;
		if (!file) return;
		const target = this.app.metadataCache.fileToLinktext(file, src.path);
		const insert = written === target ? `[[${target}]]` : `[[${target}|${written}]]`;
		const editor = this.app.workspace.editorForFile(src);
		const apply = (text: string) => (text.slice(from, to) === written ? text.slice(0, from) + insert + text.slice(to) : null);
		if (editor) {
			const next = apply(editor.getValue());
			if (next === null) { new Notice('The note changed; refresh and try again.'); return; }
			editor.replaceWhole(next);
			await this.app.workspace.saveFile(src);
		} else {
			let ok = true;
			await this.app.vault.process(src, (t) => { const n = apply(t); if (n === null) { ok = false; return t; } return n; });
			if (!ok) { new Notice('The note changed; refresh and try again.'); return; }
		}
		this.refresh();
	}
}

