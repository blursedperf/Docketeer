/**
 * Whole-Tree Search for Docketeer: type ~ in the Docket to search outlines. Each match is shown with the heading
 * above it, its parent items and what is nested under it (tree.ts). Ported from the Obsidian plugin of the same
 * name: parser.ts is its outline logic as it was; the Docket replaces its search window.
 *
 * Only notes the app's search index says contain every word are read, so a search touches a handful of notes
 * rather than the whole homebase. Locked notes are never read (and the Docket drops any result in one).
 */
import { type OpenWhere, Plugin, type SearchResult, type TFile } from "@quire/api";
import { DEFAULT_SETTINGS, type WholeTreeSearchSettings, WholeTreeSearchSettingTab, excludedFolders, isPathExcluded, readSettings } from "./settings";
import { queryWords, searchTree } from "./tree";

/** The Docket group its results are listed under. */
export const GROUP = "In outlines";
export const PREFIX = "~";

export default class WholeTreeSearchPlugin extends Plugin {
	settings: WholeTreeSearchSettings = { ...DEFAULT_SETTINGS };

	async onload(): Promise<void> {
		this.settings = readSettings(await this.loadData());
		this.addSettingTab(new WholeTreeSearchSettingTab(this.app, this));
		this.addCommand({
			id: "open",
			name: "Whole-tree search…",
			icon: "list-tree",
			section: "Search",
			aliases: ["Search outlines", "Outline search", "Search lists"],
			callback: () => this.app.docket.search(`${PREFIX}`),
		});
		this.registerSearchProvider({
			id: "outlines",
			title: "Whole-tree search",
			prefixes: [PREFIX],
			empty: "Type words to find them in your outlines, with the lines around them. Words can be spread down one branch.",
			search: ({ text, only }) => this.search(text, only === GROUP ? 200 : this.settings.maxResults),
		});
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	/** The notes worth reading for `text`: those the index says hold every word, else (index not ready) every note. */
	private notesFor(text: string): TFile[] {
		const { vault, search } = this.app;
		const all = vault.getMarkdownFiles();
		const paths = search.isReady ? search.index.candidates(text) : null;
		if (!paths) return all;
		const set = new Set(paths);
		return all.filter((f) => set.has(f.path));
	}

	async search(text: string, limit: number): Promise<{ results: SearchResult[]; totals: Record<string, number> }> {
		const s = this.settings;
		if (text.trim().length < Math.max(1, s.minQueryLength) || !queryWords(text).length) return { results: [], totals: {} };
		const excluded = excludedFolders(s);
		const usage = this.app.search.rankContext().usage;
		const results: SearchResult[] = [];
		let total = 0;
		for (const file of this.notesFor(text)) {
			if (isPathExcluded(file.path, excluded) || this.app.isLocked(file)) continue;
			const content = await this.app.vault.cachedRead(file);
			const matches = searchTree(content, text, { ...s, limit: 0 });
			total += matches.length;
			// Notes used lately first; a match with every word on its line before one spread down a branch.
			const used = usage?.(file.path) ?? 0;
			for (const m of matches) {
				if (results.length >= limit * 4) break;
				results.push(this.result(file, m.line, m.text, m.lines, (m.whole ? 20 : 10) + used - m.line / 100000));
			}
		}
		results.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
		return { results: results.slice(0, limit), totals: { [GROUP]: total } };
	}

	private result(file: TFile, line: number, text: string, tree: SearchResult["tree"], score: number): SearchResult {
		const { app } = this;
		return {
			id: `${file.path}:${line}`, type: GROUP, title: `${file.basename}  :${line + 1}`, detail: text, tree,
			icon: "list-tree", file, score,
			open: (where: OpenWhere) => this.openAt(file, line, where),
			insert: () => `[[${app.metadataCache.fileToLinktext(file, app.workspace.getActiveFile()?.path ?? "")}]]`,
		};
	}

	/** Open the note with the cursor on the line found: here, to the right or below. */
	private async openAt(file: TFile, line: number, where: OpenWhere): Promise<void> {
		const { workspace } = this.app;
		const leaf = where === "current" ? workspace.getLeaf(this.app.config.docketNewTab !== false ? "tab" : false) : workspace.getLeaf("split", where === "right" ? "vertical" : "horizontal");
		await leaf.openFile(file, { eState: { line } });
		workspace.setActiveLeaf(leaf, { focus: true });
	}
}
