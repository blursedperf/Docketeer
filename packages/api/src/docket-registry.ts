/**
 * What the Docket shows: panels (Mod+number), search providers and result actions. Core and plugins add
 * to it; each `add…` returns a function that removes the entry again (plugins call it on unload).
 */
import { Events } from './events';
import type { TFile } from './files';

/** How to open a result: in this pane, a new pane to the right, or below. */
export type OpenWhere = 'current' | 'right' | 'below';

export interface SearchResult {
	/** Unique within its provider. */
	id: string;
	/** Group heading: Notes, Headings, Commands, Authorities, Tags, Settings … */
	type: string;
	title: string;
	detail?: string;
	/** Parts of `detail` to highlight (the matched words in a line of text). */
	detailRanges?: [number, number][];
	icon?: string;
	/** Higher is better; providers score their own results. */
	score?: number;
	/** The note it belongs to, if any (for locked-note filtering and note actions). */
	file?: TFile;
	/** Shortcut text to show (commands). */
	hint?: string;
	open?(where: OpenWhere): unknown;
	/** Markdown to insert at the cursor (Shift+Enter): a link or a citation. */
	insert?(): string | null;
}

export interface SearchQuery {
	/** The text after any prefix. */
	text: string;
	/** Only this group is wanted ("show all"): providers may return more of it. */
	only?: string;
	/** "", ">", "@", "#", "/" or "?". */
	prefix: string;
}

export type SearchResults = SearchResult[] | { results: SearchResult[]; totals?: Record<string, number> };

export interface SearchProvider {
	id: string;
	title: string;
	/** Prefixes it answers ("" is the unprefixed search). */
	prefixes: string[];
	/**
	 * Results for the query. A provider may return only its best results with `totals` saying how many
	 * there are in each group, so "show all" can say "12 of 340" without building them all.
	 */
	search(q: SearchQuery): SearchResults | Promise<SearchResults>;
	source?: string;
}

export interface ResultAction {
	id: string;
	title: string;
	icon?: string;
	appliesTo(result: SearchResult): boolean;
	run(result: SearchResult): unknown;
	source?: string;
}

export interface DocketPanel {
	id: string;
	title: string;
	icon?: string;
	/** Position for Mod+1 … Mod+9; plugins without one take the next free number, or none. */
	order?: number;
	/**
	 * Fill `el` (called each time the panel is shown). `focus` is what the Docket opened on, such as the
	 * case name under the cursor for the Authorities panel. Items marked `data-docket-item` can be reached
	 * with the arrow keys.
	 */
	render(el: HTMLElement, opts: { focus?: string }): void | Promise<void>;
	/** Called when the panel is hidden. */
	hide?(): void;
	source?: string;
}

export class DocketRegistry extends Events {
	panels = new Map<string, DocketPanel>();
	providers = new Map<string, SearchProvider>();
	actions = new Map<string, ResultAction>();

	private add<T extends { id: string }>(map: Map<string, T>, item: T): () => void {
		if (map.has(item.id)) throw new Error(`Already registered: ${item.id}`);
		map.set(item.id, item);
		this.trigger('changed');
		return () => {
			if (map.get(item.id) === item) map.delete(item.id);
			this.trigger('changed');
		};
	}

	addPanel(p: DocketPanel): () => void { return this.add(this.panels, p); }
	addSearchProvider(p: SearchProvider): () => void { return this.add(this.providers, p); }
	addResultAction(a: ResultAction): () => void { return this.add(this.actions, a); }

	/** Panels in Mod+number order: those with an order first, then the rest by when they were added. */
	orderedPanels(): DocketPanel[] {
		const all = [...this.panels.values()];
		return [...all.filter((p) => p.order !== undefined).sort((a, b) => a.order! - b.order!), ...all.filter((p) => p.order === undefined)];
	}

	actionsFor(r: SearchResult): ResultAction[] {
		return [...this.actions.values()].filter((a) => { try { return a.appliesTo(r); } catch { return false; } });
	}
}
