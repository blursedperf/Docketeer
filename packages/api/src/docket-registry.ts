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
	/**
	 * Lines shown under the title in place of `detail`, each indented by its `depth`: a match with the outline
	 * around it. The row grows to fit them. `match` marks the line found; `ranges` highlight within a line.
	 */
	tree?: SearchResultLine[];
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
	/**
	 * Rows that can be put in another order by dragging: dropping one on another of the same `group` calls the
	 * dragged row's `move` with the index of the row it was dropped on.
	 */
	reorder?: { group: string; index: number; move(to: number): unknown };
}

export interface SearchResultLine { text: string; depth: number; match?: boolean; ranges?: [number, number][] }

export interface SearchQuery {
	/** The text after any prefix. */
	text: string;
	/** Only this group is wanted ("show all"): providers may return more of it. */
	only?: string;
	/** "", ">", "@", "#", "/", "?", "+", or a plugin's own prefix. */
	prefix: string;
}

export type SearchResults = SearchResult[] | { results: SearchResult[]; totals?: Record<string, number> };

export interface SearchProvider {
	id: string;
	title: string;
	/**
	 * Prefixes it answers ("" is the unprefixed search). A plugin may add its own: one character that is not a
	 * letter, digit or one of the Docket's ("~"); it is then listed in the cheat sheet (`?`) under its title.
	 */
	prefixes: string[];
	/** What the Docket says when this provider's prefix has nothing yet, or no matches ("Type words to …"). */
	empty?: string;
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

/** An action offered for a row (→ or Mod+.), or in a list of actions. */
export interface DocketAction { title: string; icon?: string; run(): unknown }

export interface DocketRowOptions {
	/** A second line of smaller text, or text after the title. */
	detail?: string | null;
	icon?: string | null;
	/** Shown at the row's end: "overdue", "3×". */
	badge?: string;
	italic?: boolean;
	/** Indent, in levels. */
	level?: number;
	/** The row's actions, offered by → (or Mod+.). */
	actions?: () => DocketAction[];
	/** Extra classes for the row. */
	cls?: string;
	/** A fuller name for screen readers and the tooltip. */
	label?: string;
}

/**
 * What a panel draws with, so its rows look and move like the Docket's own: ↑↓ between rows, Enter or a click
 * runs one (Mod+Enter: to the right; Shift+Enter: insert), → offers its actions.
 */
export interface DocketPanelUI {
	row(parent: HTMLElement, title: string, run: (where: OpenWhere | 'insert') => unknown, options?: DocketRowOptions): HTMLElement;
	/** A titled section; rows go in the element it returns. */
	section(parent: HTMLElement, title: string, count?: number): HTMLElement;
	/** A line saying there is nothing to show. */
	empty(parent: HTMLElement, text: string): void;
	/** Draw the panel again (keeping the selected row). */
	refresh(): Promise<void>;
	/** A list of actions in place of the panel (Escape goes back). */
	showActions(title: string, actions: DocketAction[]): void;
	/** Close the Docket (as Escape does). */
	close(): void;
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
	render(el: HTMLElement, opts: { focus?: string; ui?: DocketPanelUI }): void | Promise<void>;
	/** Called when the panel is hidden. */
	hide?(): void;
	source?: string;
}

/** How the user arranged the Docket's tabs (saved by the app in .quire/panels.json). */
export interface PanelArrangement { order: string[]; hidden: string[] }

/** `panels` (in their default order) with those named in `order` first, in that order; the rest keep theirs. */
export function arrangePanels<T extends { id: string }>(panels: T[], order: string[]): T[] {
	const at = new Map(order.map((id, i) => [id, i]));
	return panels.map((p, i) => ({ p, key: at.has(p.id) ? at.get(p.id)! : order.length + i })).sort((a, b) => a.key - b.key).map((x) => x.p);
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

	/** Open the Docket on the panel `id` (a plugin's full id: "plugin-id:panel"). */
	showPanel(id: string): void { this.trigger('show-panel', id); }

	/** Open the Docket with `text` in its search ("~" for a plugin's own prefix, ready to type after). */
	search(text: string): void { this.trigger('search', text); }

	/** Draw the panel `id` again if it is the one shown (its data changed). */
	refreshPanel(id: string): void { this.trigger('refresh-panel', id); }
	addSearchProvider(p: SearchProvider): () => void { return this.add(this.providers, p); }
	addResultAction(a: ResultAction): () => void { return this.add(this.actions, a); }

	/** Panels in Mod+number order: those with an order first, then the rest by when they were added. */
	/** The user's arrangement of the tabs: panel ids in the order chosen, and the ids not shown as tabs. */
	arrangement: PanelArrangement = { order: [], hidden: [] };

	setArrangement(a: PanelArrangement): void {
		this.arrangement = { order: [...a.order], hidden: [...a.hidden] };
		this.trigger('changed');
	}

	/** Every panel, shown or not: in the order chosen, then the rest in their default order. */
	allPanels(): DocketPanel[] {
		const all = [...this.panels.values()];
		const byDefault = [...all.filter((p) => p.order !== undefined).sort((a, b) => a.order! - b.order!), ...all.filter((p) => p.order === undefined)];
		return arrangePanels(byDefault, this.arrangement.order);
	}

	/** The panels shown as tabs (Mod+1 … Mod+9), in order. A hidden panel can still be opened by its id. */
	orderedPanels(): DocketPanel[] {
		const hidden = new Set(this.arrangement.hidden);
		return this.allPanels().filter((p) => !hidden.has(p.id));
	}

	actionsFor(r: SearchResult): ResultAction[] {
		return [...this.actions.values()].filter((a) => { try { return a.appliesTo(r); } catch { return false; } });
	}
}
