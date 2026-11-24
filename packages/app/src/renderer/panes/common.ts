import { type App, type TFile, setIcon } from '@quire/api';

/** Open `file` at a place (offsets to select, or a line), in a new tab with Ctrl/Cmd. */
export function openAt(app: App, file: TFile, at: { from?: number; to?: number; line?: number; subpath?: string }, evt?: MouseEvent | KeyboardEvent): void {
	const newTab = !!evt && (evt.ctrlKey || evt.metaKey);
	void app.workspace.getLeaf(newTab ? 'tab' : false).openFile(file, { eState: at });
}

/** The line around `offset` in `text`, cut to about `width` characters, with where it starts. */
export function lineAround(text: string, from: number, to: number, width = 140): { text: string; start: number } {
	const ls = text.lastIndexOf('\n', from - 1) + 1;
	let le = text.indexOf('\n', to);
	if (le === -1) le = text.length;
	let start = ls;
	let end = le;
	if (end - start > width) {
		start = Math.max(ls, from - Math.floor(width / 3));
		end = Math.min(le, start + width);
	}
	return { text: text.slice(start, end), start };
}

/**
 * Write `text` into `el`, with the ranges (relative to `text`) wrapped in <mark>. Text only: nothing is
 * parsed as HTML.
 */
export function renderMarked(el: HTMLElement, text: string, ranges: [number, number][], prefix = '', suffix = ''): void {
	el.empty();
	if (prefix) el.appendText(prefix);
	let at = 0;
	for (const [a, b] of [...ranges].sort((x, y) => x[0] - y[0])) {
		if (b <= at) continue;
		const s = Math.max(a, at);
		if (s > at) el.appendText(text.slice(at, s));
		el.createEl('mark', { cls: 'search-match', text: text.slice(s, b) });
		at = b;
	}
	if (at < text.length) el.appendText(text.slice(at));
	if (suffix) el.appendText(suffix);
}

/** A collapsible group header used by the panes: chevron, title, count. */
export function groupHeader(parent: HTMLElement, title: string, count: number | null, open: boolean, onToggle: (open: boolean) => void): HTMLElement {
	const head = parent.createDiv({ cls: 'pane-group-header tree-item-self' });
	const chevron = head.createDiv({ cls: 'tree-item-icon collapse-icon' });
	const draw = (o: boolean) => { setIcon(chevron, o ? 'chevron-down' : 'chevron-right'); chevron.dataset.open = String(o); };
	draw(open);
	head.createDiv({ cls: 'tree-item-inner', text: title });
	if (count !== null) head.createDiv({ cls: 'tree-item-flair', text: String(count) });
	head.addEventListener('click', () => { const o = chevron.dataset.open !== 'true'; draw(o); onToggle(o); });
	return head;
}
