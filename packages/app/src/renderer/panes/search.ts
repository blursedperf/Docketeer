import { ItemView, TFile, type WorkspaceLeaf, debounce, getAllTags, setIcon } from '@quire/api';
import { groupHeader, lineAround, openAt, renderMarked } from './common';

export const SEARCH_VIEW = 'search';

/** A parsed query: words and "phrases" that must all appear, -words that must not, and filters. */
export interface Query {
	terms: string[];
	exclude: string[];
	paths: string[];
	tags: string[];
}

export function parseQuery(input: string): Query {
	const q: Query = { terms: [], exclude: [], paths: [], tags: [] };
	for (const m of input.matchAll(/(-?)(?:(path|file|tag):)?(?:"([^"]*)"|(\S+))/g)) {
		const neg = m[1] === '-';
		const op = m[2];
		const value = (m[3] ?? m[4] ?? '').trim();
		if (!value) continue;
		if (op === 'path' || op === 'file') q.paths.push(value.toLowerCase());
		else if (op === 'tag') q.tags.push(`#${value.replace(/^#/, '').toLowerCase()}`);
		else (neg ? q.exclude : q.terms).push(value);
	}
	return q;
}

export interface FileResult {
	file: TFile;
	matches: [number, number][];
}

/** Search every note: offsets of each match in each note that satisfies the query. */
export async function searchNotes(app: { vault: { getMarkdownFiles(): TFile[]; cachedRead(f: TFile): Promise<string> }; metadataCache: { getFileCache(f: TFile): Parameters<typeof getAllTags>[0] | null } }, q: Query, matchCase: boolean): Promise<FileResult[]> {
	const norm = (s: string) => (matchCase ? s : s.toLowerCase());
	const out: FileResult[] = [];
	for (const file of app.vault.getMarkdownFiles()) {
		if (q.paths.length && !q.paths.every((p) => file.path.toLowerCase().includes(p))) continue;
		if (q.tags.length) {
			const cache = app.metadataCache.getFileCache(file);
			const tags = (cache ? getAllTags(cache) ?? [] : []).map((t) => t.toLowerCase());
			if (!q.tags.every((t) => tags.some((x) => x === t || x.startsWith(`${t}/`)))) continue;
		}
		const raw = await app.vault.cachedRead(file);
		const text = norm(raw);
		if (q.exclude.some((t) => text.includes(norm(t)))) continue;
		const matches: [number, number][] = [];
		let all = true;
		for (const term of q.terms) {
			const t = norm(term);
			let found = false;
			for (let i = text.indexOf(t); i !== -1; i = text.indexOf(t, i + t.length)) {
				matches.push([i, i + t.length]);
				found = true;
			}
			if (!found) { all = false; break; }
		}
		if (!all) continue;
		if (q.terms.length === 0 && q.paths.length === 0 && q.tags.length === 0) continue;
		out.push({ file, matches: matches.sort((a, b) => a[0] - b[0]) });
	}
	return out.sort((a, b) => b.matches.length - a.matches.length || a.file.path.localeCompare(b.file.path));
}

/** Full-text search of the homebase, in the left sidebar. */
export class SearchView extends ItemView {
	private inputEl!: HTMLInputElement;
	private summaryEl!: HTMLElement;
	private resultsEl!: HTMLElement;
	private matchCase = false;
	private collapsed = new Set<string>();
	private generation = 0;
	private readonly run = debounce(() => { void this.search(); }, 200, true);

	constructor(leaf: WorkspaceLeaf) {
		super(leaf);
		this.icon = 'search';
	}

	getViewType(): string { return SEARCH_VIEW; }
	getDisplayText(): string { return 'Search'; }

	override getState(): Record<string, unknown> { return { query: this.inputEl?.value ?? '', matchCase: this.matchCase }; }
	override async setState(state: unknown): Promise<void> {
		const s = state as { query?: string; matchCase?: boolean } | null;
		if (typeof s?.matchCase === 'boolean') this.matchCase = s.matchCase;
		if (typeof s?.query === 'string' && this.inputEl) { this.inputEl.value = s.query; this.run(); }
	}

	override async onOpen(): Promise<void> {
		this.contentEl.addClass('search-pane');
		const box = this.contentEl.createDiv({ cls: 'pane-toolbar' });
		this.inputEl = box.createEl('input', { cls: 'pane-search-input', attr: { type: 'search', placeholder: 'Search: words, "phrase", -not, path:, tag:', spellcheck: 'false' } });
		this.inputEl.addEventListener('input', () => this.run());
		this.inputEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') { this.run.cancel(); void this.search(); } });
		const caseBtn = box.createDiv({ cls: 'clickable-icon', attr: { 'aria-label': 'Match case', title: 'Match case' } });
		setIcon(caseBtn, 'case-sensitive');
		caseBtn.toggleClass('is-active', this.matchCase);
		caseBtn.addEventListener('click', () => { this.matchCase = !this.matchCase; caseBtn.toggleClass('is-active', this.matchCase); void this.search(); });
		this.summaryEl = this.contentEl.createDiv({ cls: 'pane-summary' });
		this.resultsEl = this.contentEl.createDiv({ cls: 'pane-results' });
		this.registerEvent(this.app.vault.on('modify', () => { if (this.inputEl.value.trim()) this.run(); }));
		this.registerEvent(this.app.vault.on('delete', () => { if (this.inputEl.value.trim()) this.run(); }));
		this.registerEvent(this.app.vault.on('rename', () => { if (this.inputEl.value.trim()) this.run(); }));
	}

	/** Put `query` in the box and search (from the command or a tag click). */
	setQuery(query: string): void {
		this.inputEl.value = query;
		this.run.cancel();
		void this.search();
	}

	override focus(): void {
		this.inputEl?.focus();
		this.inputEl?.select();
	}

	async search(): Promise<void> {
		const gen = ++this.generation;
		const query = this.inputEl.value;
		this.app.workspace.requestSaveLayout();
		if (!query.trim()) {
			this.summaryEl.setText('');
			this.resultsEl.empty();
			return;
		}
		const results = await searchNotes(this.app, parseQuery(query), this.matchCase);
		if (gen !== this.generation) return;
		const total = results.reduce((n, r) => n + r.matches.length, 0);
		this.summaryEl.setText(results.length ? `${total} ${total === 1 ? 'match' : 'matches'} in ${results.length} ${results.length === 1 ? 'note' : 'notes'}` : 'No matches.');
		this.resultsEl.empty();
		for (const r of results.slice(0, 200)) await this.renderFile(r);
	}

	private async renderFile(r: FileResult): Promise<void> {
		const group = this.resultsEl.createDiv({ cls: 'pane-group' });
		const body = createDiv({ cls: 'pane-group-body' });
		const open = !this.collapsed.has(r.file.path);
		const head = groupHeader(group, r.file.basename, r.matches.length || null, open, (o) => {
			if (o) this.collapsed.delete(r.file.path); else this.collapsed.add(r.file.path);
			body.toggle(o);
		});
		head.title = r.file.path;
		group.appendChild(body);
		body.toggle(open);
		if (r.matches.length === 0) {
			const row = body.createDiv({ cls: 'pane-match' });
			row.setText(r.file.path);
			row.addEventListener('click', (e) => openAt(this.app, r.file, {}, e));
			return;
		}
		const text = await this.app.vault.cachedRead(r.file);
		// One row per line, with every match on that line marked.
		const seen = new Set<number>();
		let shown = 0;
		for (const [from, to] of r.matches) {
			const line = lineAround(text, from, to);
			if (seen.has(line.start)) continue;
			seen.add(line.start);
			if (++shown > 20) { body.createDiv({ cls: 'pane-more', text: `… ${r.matches.length - 20} more` }); break; }
			const onLine = r.matches.filter(([a, b]) => a >= line.start && b <= line.start + line.text.length).map(([a, b]) => [a - line.start, b - line.start] as [number, number]);
			const row = body.createDiv({ cls: 'pane-match' });
			renderMarked(row, line.text, onLine);
			row.addEventListener('click', (e) => openAt(this.app, r.file, { from, to }, e));
		}
	}
}
