/**
 * The Docket: a tray that drops from the top of the window with search, commands and panels, all from
 * the keyboard. Peek overlays the editor and keeps focus until dismissed; pinned docks above the editor.
 * Behind the `docket` setting until the sidebars retire (docs/docket/PLAN.md, Phase 2).
 */
import type { EditorSelection } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import {
	type App, type DocketPanel, type OpenWhere, type SearchResult,
	MarkdownView, Notice, Platform, clampHeight, contextPanel, formatHotkey, groupResults, mergeResults, parsePrefix, setIcon, topModal,
} from '@quire/api';

type Zone = 'input' | 'results' | 'panel' | 'tabs';
type Where = OpenWhere | 'insert';

/** What to say when a prefix has nothing yet. */
const EMPTY: Record<string, string> = {
	'': 'No matches.',
	'>': 'No commands match.',
	'@': 'Authorities arrive with the Authorities panel.',
	'#': 'No folders or tags match.',
	'/': 'No headings in this note match.',
	'?': 'No shortcuts match.',
};

const PREFIX_LABEL: Record<string, string> = { '': 'All', '>': 'Commands', '@': 'Authorities', '#': 'Folders & tags', '/': 'Headings', '?': 'Shortcuts' };

interface ActionItem { title: string; icon?: string; run: () => unknown }

export class Docket {
	readonly el: HTMLElement;
	private handleEl: HTMLElement;
	private inputEl: HTMLInputElement;
	private prefixEl: HTMLElement;
	private modeBtn: HTMLElement;
	private tabsEl: HTMLElement;
	private resultsEl: HTMLElement;
	private panelEl: HTMLElement;
	private liveEl: HTMLElement;
	private resizeEl: HTMLElement;

	private opened = false;
	/** Results in display order, or the actions of one result. */
	private items: SearchResult[] = [];
	private actions: ActionItem[] | null = null;
	private actionsOf: SearchResult | null = null;
	private selected = 0;
	private panelId: string;
	private panelFocus: string | undefined;
	private shownPanel: DocketPanel | null = null;
	private saved: { cm: EditorView | null; selection: EditorSelection | null; el: Element | null } | null = null;
	private seq = 0;
	/** "Show all" of one group. */
	private only: string | null = null;
	private detach: (() => void)[] = [];

	constructor(private app: App) {
		const container = document.querySelector<HTMLElement>('.app-container')!;
		this.handleEl = createDiv({ cls: 'docket-handle' });
		const handleBtn = this.handleEl.createEl('button', { cls: 'docket-handle-button', attr: { type: 'button' } });
		setIcon(handleBtn.createSpan({ cls: 'docket-handle-icon' }), 'chevron-down');
		handleBtn.createSpan({ text: 'Docket' });
		handleBtn.createEl('kbd', { cls: 'docket-handle-key', text: this.shortcutText() });
		handleBtn.addEventListener('click', () => this.toggle());

		this.el = createDiv({ cls: 'docket', attr: { role: 'dialog', 'aria-label': 'Docket', hidden: '' } });
		const head = this.el.createDiv({ cls: 'docket-head' });
		this.prefixEl = head.createSpan({ cls: 'docket-prefix', attr: { 'aria-hidden': 'true' } });
		this.inputEl = head.createEl('input', {
			cls: 'docket-input',
			attr: {
				type: 'text', role: 'combobox', 'aria-expanded': 'false', 'aria-controls': 'docket-results', 'aria-autocomplete': 'list',
				'aria-label': 'Search notes, commands and more. Type > for commands, # for folders and tags, / for headings, ? for shortcuts.',
				placeholder: 'Search, or type > # / @ ?', spellcheck: 'false', autocomplete: 'off',
			},
		});
		this.modeBtn = head.createEl('button', { cls: 'clickable-icon docket-mode', attr: { type: 'button' } });
		this.modeBtn.addEventListener('click', () => this.toggleMode());
		const closeBtn = head.createEl('button', { cls: 'clickable-icon docket-close', attr: { type: 'button', 'aria-label': 'Close the Docket (Esc)' } });
		setIcon(closeBtn, 'x');
		closeBtn.addEventListener('click', () => this.close(true));

		this.tabsEl = this.el.createDiv({ cls: 'docket-tabs', attr: { role: 'tablist', 'aria-label': 'Panels' } });
		const body = this.el.createDiv({ cls: 'docket-body' });
		this.resultsEl = body.createDiv({ cls: 'docket-results', attr: { id: 'docket-results', role: 'listbox', 'aria-label': 'Results', tabindex: '-1', hidden: '' } });
		this.panelEl = body.createDiv({ cls: 'docket-panel', attr: { role: 'tabpanel', tabindex: '-1' } });
		const foot = this.el.createDiv({ cls: 'docket-foot', attr: { 'aria-hidden': 'true' } });
		const mod = Platform.isMacOS ? '⌘' : 'Ctrl+';
		for (const [k, t] of [['↑↓', 'move'], ['↵', 'open'], [`${mod}↵`, 'right'], [Platform.isMacOS ? '⌥↵' : 'Alt+↵', 'below'], [Platform.isMacOS ? '⇧↵' : 'Shift+↵', 'insert'], ['→', 'actions'], [`${mod}1–6`, 'panels'], ['Esc', 'back']] as const) {
			const s = foot.createSpan({ cls: 'docket-foot-item' });
			s.createEl('kbd', { text: k });
			s.appendText(` ${t}`);
		}
		this.resizeEl = this.el.createDiv({ cls: 'docket-resize', attr: { role: 'separator', 'aria-orientation': 'horizontal', 'aria-label': 'Docket height', 'aria-valuemin': '20', 'aria-valuemax': '60' } });
		this.liveEl = this.el.createDiv({ cls: 'sr-only', attr: { 'aria-live': 'polite', role: 'status' } });

		container.prepend(this.handleEl, this.el);
		container.addClass('has-docket');
		this.panelId = String(app.config.docketPanel || 'core:outline');
		this.applyMode();
		this.applyHeight();

		this.inputEl.addEventListener('input', () => { this.actions = null; this.actionsOf = null; if (!this.inputEl.value) this.only = null; void this.update(); });
		this.el.addEventListener('keydown', (e) => this.onKey(e));
		this.el.addEventListener('focusin', () => { app.docketOpen = true; });
		this.el.addEventListener('focusout', () => window.setTimeout(() => this.onFocusOut(), 0));
		this.resizeEl.addEventListener('mousedown', (e) => this.startResize(e));
		const ref = app.docket.on('changed', () => { if (this.opened) this.renderTabs(); });
		this.detach.push(() => app.docket.offref(ref));
	}

	get isOpen(): boolean { return this.opened; }
	get mode(): 'peek' | 'pinned' { return this.app.config.docketMode === 'pinned' ? 'pinned' : 'peek'; }

	destroy(): void {
		if (this.opened) this.close(true);
		for (const d of this.detach) d();
		this.el.remove();
		this.handleEl.remove();
		document.querySelector('.app-container')?.removeClass('has-docket');
		this.app.docketOpen = false;
	}

	private shortcutText(): string {
		const cmd = this.app.commands.findCommand('app:docket');
		const key = cmd ? this.app.commands.hotkeysFor(cmd)[0] : undefined;
		return key ? formatHotkey(key) : '';
	}

	// -----------------------------------------------------------------------------------------------
	// Opening and closing

	/** Mod+P: open (on the panel the cursor suggests), focus it when pinned elsewhere, or close. */
	toggle(): void {
		if (!this.opened) this.open();
		else if (this.mode === 'pinned' && !this.el.contains(document.activeElement)) this.focusZone('input');
		else this.close(true);
	}

	/** Open, with the cursor in the input. Returns how long it took (ms), for the budget check. */
	open(opts: { panel?: string; query?: string } = {}): number {
		const t0 = performance.now();
		if (!this.opened) this.saveFocus();
		let panel = opts.panel;
		this.panelFocus = undefined;
		if (!panel && this.saved?.cm) {
			const cm = this.saved.cm;
			const head = cm.state.selection.main.head;
			const line = cm.state.doc.lineAt(head);
			const ctx = contextPanel(line.text, head - line.from);
			if (ctx?.panel === 'cite') panel = 'core:cite';
			else if (ctx?.panel === 'authorities') { panel = 'core:authorities'; this.panelFocus = ctx.focus; }
		}
		if (panel && this.app.docket.panels.has(panel)) this.panelId = panel;
		if (!this.app.docket.panels.has(this.panelId)) this.panelId = this.app.docket.orderedPanels()[0]?.id ?? '';
		this.opened = true;
		this.el.removeAttribute('hidden');
		this.el.addClass('is-open');
		this.handleEl.addClass('is-open');
		this.inputEl.value = opts.query ?? '';
		this.only = null;
		this.actions = null;
		this.actionsOf = null;
		this.renderTabs();
		void this.update();
		this.inputEl.focus();
		this.app.docketOpen = true;
		this.app.trigger('docket-open');
		return performance.now() - t0;
	}

	/** Close (peek, or `hide`), or in pinned mode give the keyboard back to the editor. */
	close(hide = this.mode === 'peek'): void {
		if (!this.opened) return;
		if (hide) {
			this.opened = false;
			this.shownPanel?.hide?.();
			this.shownPanel = null;
			this.el.setAttribute('hidden', '');
			this.el.removeClass('is-open');
			this.handleEl.removeClass('is-open');
		}
		this.restoreFocus();
		this.app.docketOpen = false;
	}

	private saveFocus(): void {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		const cm = view && view.getMode() === 'source' ? view.editor.cm : null;
		this.saved = { cm, selection: cm?.state.selection ?? null, el: document.activeElement };
	}

	/** Back to exactly where the user was: the editor with the same cursor and selection, or the element. */
	private restoreFocus(): void {
		const s = this.saved;
		if (!s) return;
		if (s.cm?.dom.isConnected) {
			const len = s.cm.state.doc.length;
			if (s.selection && s.selection.ranges.every((r) => r.to <= len)) s.cm.dispatch({ selection: s.selection });
			s.cm.focus();
		} else if (s.el instanceof HTMLElement && s.el.isConnected && !this.el.contains(s.el)) {
			s.el.focus();
		}
	}

	private onFocusOut(): void {
		const inside = this.el.contains(document.activeElement);
		this.app.docketOpen = inside;
		if (inside || !this.opened || this.mode !== 'peek') return;
		// Peek keeps the keyboard until dismissed: leaving it (a click elsewhere) dismisses it. A dialog or
		// menu opened from it (a confirmation) is not leaving.
		if (topModal() || document.querySelector('.menu')) return;
		this.opened = false;
		this.shownPanel?.hide?.();
		this.shownPanel = null;
		this.el.setAttribute('hidden', '');
		this.el.removeClass('is-open');
		this.handleEl.removeClass('is-open');
	}

	// -----------------------------------------------------------------------------------------------
	// Mode and height

	toggleMode(): void {
		// setConfig changes the value at once (and saves in the background).
		void this.app.setConfig('docketMode', this.mode === 'peek' ? 'pinned' : 'peek');
		this.applyMode();
		new Notice(this.mode === 'pinned' ? 'Docket pinned above the editor.' : 'Docket in peek mode: it closes when you are done.');
	}

	private applyMode(mode = this.mode): void {
		this.el.toggleClass('is-pinned', mode === 'pinned');
		this.el.toggleClass('is-peek', mode === 'peek');
		this.el.setAttribute('aria-modal', String(mode === 'peek'));
		this.modeBtn.empty();
		setIcon(this.modeBtn, mode === 'peek' ? 'pin' : 'pin-off');
		this.modeBtn.setAttribute('aria-label', mode === 'peek' ? 'Pin the Docket above the editor' : 'Unpin (peek mode)');
	}

	/** Change the height by `delta` (a fraction of the window), within 20–60 %. */
	resize(delta: number): void {
		const h = clampHeight(Number(this.app.config.docketHeight || 0.35) + delta);
		void this.app.setConfig('docketHeight', h);
		this.applyHeight(h);
	}

	private applyHeight(h = clampHeight(Number(this.app.config.docketHeight || 0.35))): void {
		this.el.style.setProperty('--docket-height', `${Math.round(h * 100)}vh`);
		this.resizeEl.setAttribute('aria-valuenow', String(Math.round(h * 100)));
	}

	private startResize(e: MouseEvent): void {
		e.preventDefault();
		const top = this.el.getBoundingClientRect().top;
		let h = Number(this.app.config.docketHeight || 0.35);
		const move = (ev: MouseEvent) => { h = clampHeight((ev.clientY - top) / window.innerHeight); this.applyHeight(h); };
		const up = () => {
			window.removeEventListener('mousemove', move);
			window.removeEventListener('mouseup', up);
			document.body.removeClass('is-resizing-docket');
			void this.app.setConfig('docketHeight', h);
		};
		document.body.addClass('is-resizing-docket');
		window.addEventListener('mousemove', move);
		window.addEventListener('mouseup', up);
	}

	// -----------------------------------------------------------------------------------------------
	// Panels

	/** Show panel number `n` (1-based, in Mod+number order). */
	showPanelNumber(n: number): boolean {
		const p = this.app.docket.orderedPanels()[n - 1];
		if (!p) return false;
		this.showPanel(p.id);
		return true;
	}

	showPanel(id: string, focus?: string): void {
		if (!this.opened) { this.open({ panel: id }); return; }
		this.panelId = id;
		this.panelFocus = focus;
		void this.app.setConfig('docketPanel', id);
		this.inputEl.value = '';
		this.actions = null;
		this.actionsOf = null;
		this.renderTabs();
		void this.update();
	}

	private renderTabs(): void {
		this.tabsEl.empty();
		this.app.docket.orderedPanels().forEach((p, i) => {
			const active = p.id === this.panelId;
			const tab = this.tabsEl.createEl('button', {
				cls: 'docket-tab',
				attr: { type: 'button', role: 'tab', id: `docket-tab-${i}`, 'aria-selected': String(active), tabindex: active ? '0' : '-1', 'data-panel': p.id },
			});
			if (i < 9) tab.createEl('kbd', { cls: 'docket-tab-key', text: String(i + 1) });
			if (p.icon) setIcon(tab.createSpan({ cls: 'docket-tab-icon' }), p.icon);
			tab.createSpan({ text: p.title });
			tab.toggleClass('is-active', active);
			tab.addEventListener('click', () => this.showPanel(p.id));
			if (active) this.panelEl.setAttribute('aria-labelledby', tab.id);
		});
	}

	private renderPanel(): void {
		const panel = this.app.docket.panels.get(this.panelId) ?? null;
		if (this.shownPanel && this.shownPanel !== panel) this.shownPanel.hide?.();
		this.shownPanel = panel;
		this.panelEl.empty();
		if (!panel) { this.panelEl.createDiv({ cls: 'docket-empty', text: 'No panels.' }); return; }
		try {
			void Promise.resolve(panel.render(this.panelEl, { focus: this.panelFocus })).catch(() => console.error(`Docket panel ${panel.id} failed`));
		} catch {
			console.error(`Docket panel ${panel.id} failed`);
		}
	}

	// -----------------------------------------------------------------------------------------------
	// Search and results

	/** Show the panel (empty input) or search the providers for the prefix. */
	async update(): Promise<void> {
		const q = parsePrefix(this.inputEl.value);
		this.prefixEl.setText(this.only ?? PREFIX_LABEL[q.prefix] ?? '');
		this.prefixEl.toggleClass('is-filtered', q.prefix !== '' || !!this.only);
		if (this.actions) { this.renderActions(); return; }
		if (!q.prefix && !q.text) {
			this.resultsEl.setAttribute('hidden', '');
			this.panelEl.removeAttribute('hidden');
			this.inputEl.setAttribute('aria-expanded', 'false');
			this.inputEl.removeAttribute('aria-activedescendant');
			this.items = [];
			this.renderPanel();
			return;
		}
		const seq = ++this.seq;
		const providers = [...this.app.docket.providers.values()].filter((p) => p.prefixes.includes(q.prefix));
		const only = this.only ?? undefined;
		const lists = await Promise.all(providers.map(async (p) => {
			try { return await p.search({ ...q, only }); } catch { console.error(`Docket search provider ${p.id} failed`); return []; }
		}));
		if (seq !== this.seq || !this.opened) return;
		const merged = mergeResults(lists);
		// Locked notes never reach the results, whichever provider found them.
		let all = merged.results.filter((r) => !(r.file && this.app.isLocked(r.file)));
		if (only) all = all.filter((r) => r.type === only);
		const groups = groupResults(all, only || q.prefix ? 200 : 5, merged.totals);
		// A "show all" row closes each group that has more.
		this.items = [];
		for (const g of groups) {
			this.items.push(...g.items);
			if (!only && g.total > g.items.length) {
				const more: SearchResult = { id: `docket:more:${g.type}`, type: g.type, title: `Show all ${g.total}`, icon: 'chevrons-down', open: () => this.showAll(g.type) };
				g.items = [...g.items, more];
				this.items.push(more);
			}
		}
		this.selected = 0;
		this.renderResults(groups, q.prefix);
	}

	private renderResults(groups: ReturnType<typeof groupResults>, prefix: string): void {
		this.panelEl.setAttribute('hidden', '');
		this.resultsEl.removeAttribute('hidden');
		this.resultsEl.empty();
		this.resultsEl.setAttribute('aria-label', 'Results');
		this.inputEl.setAttribute('aria-expanded', 'true');
		let i = 0;
		for (const g of groups) {
			const group = this.resultsEl.createDiv({ cls: 'docket-group', attr: { role: 'group', 'aria-label': g.type } });
			const head = group.createDiv({ cls: 'docket-group-title', attr: { 'aria-hidden': 'true' } });
			head.createSpan({ text: g.type });
			const shown = g.items.filter((r) => !r.id.startsWith('docket:more:')).length;
			if (g.total > shown) head.createSpan({ cls: 'docket-group-more', text: `${shown} of ${g.total}` });
			for (const r of g.items) {
				const el = this.renderOption(group, i++, r.title, r.detail, r.icon, r.hint, r.detailRanges);
				if (r.id.startsWith('docket:more:')) el.addClass('mod-more');
			}
		}
		if (!this.items.length) this.resultsEl.createDiv({ cls: 'docket-empty', text: EMPTY[prefix] ?? 'No matches.' });
		this.resultsEl.scrollTop = 0;
		this.select(0, false); // the first row is in view: no need to make the browser lay out to scroll
		const n = this.items.length;
		this.liveEl.setText(n ? `${n} result${n === 1 ? '' : 's'}` : EMPTY[prefix] ?? 'No matches.');
	}

	private renderOption(parent: HTMLElement, i: number, title: string, detail?: string, icon?: string, hint?: string, ranges?: [number, number][]): HTMLElement {
		const opt = parent.createDiv({ cls: 'docket-option', attr: { role: 'option', id: `docket-opt-${i}`, 'aria-selected': 'false' } });
		if (icon) setIcon(opt.createSpan({ cls: 'docket-option-icon' }), icon);
		const text = opt.createDiv({ cls: 'docket-option-text' });
		text.createDiv({ cls: 'docket-option-title', text: title });
		if (detail) {
			const d = text.createDiv({ cls: 'docket-option-detail' });
			let at = 0;
			for (const [a, b] of ranges ?? []) {
				if (a < at) continue;
				d.appendText(detail.slice(at, a));
				d.createEl('mark', { text: detail.slice(a, b) });
				at = b;
			}
			d.appendText(detail.slice(at));
		}
		if (hint) opt.createEl('kbd', { cls: 'docket-option-hint', text: hint });
		opt.addEventListener('mousemove', () => { if (this.selected !== i) this.select(i); });
		opt.addEventListener('click', (e) => { this.select(i); this.choose(this.whereFor(e)); });
		return opt;
	}

	private select(i: number, scroll = true): void {
		const count = this.actions ? this.actions.length : this.items.length;
		if (!count) { this.inputEl.removeAttribute('aria-activedescendant'); return; }
		this.selected = (i + count) % count;
		for (const el of Array.from(this.resultsEl.querySelectorAll('.docket-option'))) {
			const on = el.id === `docket-opt-${this.selected}`;
			el.toggleClass('is-selected', on);
			el.setAttribute('aria-selected', String(on));
			if (on && scroll) el.scrollIntoView({ block: 'nearest' });
		}
		this.inputEl.setAttribute('aria-activedescendant', `docket-opt-${this.selected}`);
		this.resultsEl.setAttribute('aria-activedescendant', `docket-opt-${this.selected}`);
	}

	private whereFor(e: KeyboardEvent | MouseEvent): Where {
		if (e.shiftKey) return 'insert';
		if (Platform.isMacOS ? e.metaKey : e.ctrlKey) return 'right';
		if (e.altKey) return 'below';
		return 'current';
	}

	/** Enter (and variants) on the selected result or action. */
	private choose(where: Where): void {
		if (this.actions) {
			const a = this.actions[this.selected];
			if (!a) return;
			this.close();
			void Promise.resolve(a.run()).catch((e: unknown) => new Notice(e instanceof Error ? e.message : String(e)));
			return;
		}
		const r = this.items[this.selected];
		if (!r) return;
		if (r.id.startsWith('docket:more:')) { this.showAll(r.type); return; }
		if (where === 'insert') {
			const text = r.insert?.() ?? null;
			if (!text) { new Notice(`"${r.title}" cannot be inserted as a link.`); return; }
			const cm = this.saved?.cm;
			if (!cm?.dom.isConnected) { new Notice('Open a note in editing view to insert a link.'); return; }
			this.close();
			cm.dispatch(cm.state.replaceSelection(text));
			cm.focus();
			return;
		}
		if (!r.open) return;
		this.close();
		void Promise.resolve(r.open(where)).catch((e: unknown) => new Notice(e instanceof Error ? e.message : String(e)));
	}

	/** Every result of one group. Esc returns to all groups. */
	showAll(type: string): void {
		this.only = type;
		void this.update();
		this.liveEl.setText(`All ${type}`);
	}

	/** → or Mod+.: the actions for the selected result. */
	private showActions(): boolean {
		const r = this.items[this.selected];
		if (!r || this.actions || r.id.startsWith('docket:more:')) return false;
		const list: ActionItem[] = [];
		if (r.open) {
			list.push({ title: 'Open', icon: 'arrow-right', run: () => r.open!('current') });
			list.push({ title: 'Open to the right', icon: 'separator-vertical', run: () => r.open!('right') });
			list.push({ title: 'Open below', icon: 'separator-horizontal', run: () => r.open!('below') });
		}
		if (r.insert?.()) list.push({ title: 'Insert as a link', icon: 'link', run: () => { const cm = this.saved?.cm; const t = r.insert!(); if (cm && t) { cm.dispatch(cm.state.replaceSelection(t)); cm.focus(); } } });
		for (const a of this.app.docket.actionsFor(r)) list.push({ title: a.title, icon: a.icon, run: () => a.run(r) });
		if (!list.length) return false;
		this.actions = list;
		this.actionsOf = r;
		this.renderActions();
		this.focusZone('input');
		return true;
	}

	private renderActions(): void {
		const list = this.actions ?? [];
		this.panelEl.setAttribute('hidden', '');
		this.resultsEl.removeAttribute('hidden');
		this.resultsEl.empty();
		const title = `Actions for ${this.actionsOf?.title ?? ''}`;
		this.resultsEl.setAttribute('aria-label', title);
		const group = this.resultsEl.createDiv({ cls: 'docket-group', attr: { role: 'group', 'aria-label': title } });
		const head = group.createDiv({ cls: 'docket-group-title', attr: { 'aria-hidden': 'true' } });
		head.createSpan({ text: title });
		head.createSpan({ cls: 'docket-group-more', text: '← back' });
		list.forEach((a, i) => this.renderOption(group, i, a.title, undefined, a.icon));
		this.select(0);
		this.liveEl.setText(`${title}: ${list.length} actions`);
	}

	private leaveActions(): void {
		const of = this.actionsOf;
		this.actions = null;
		this.actionsOf = null;
		void this.update().then(() => this.select(Math.max(0, this.items.findIndex((r) => r.id === of?.id && r.type === of?.type))));
	}

	// -----------------------------------------------------------------------------------------------
	// Keyboard

	private zone(): Zone {
		const a = document.activeElement;
		if (a === this.inputEl) return 'input';
		if (a && this.tabsEl.contains(a)) return 'tabs';
		if (a && this.resultsEl.contains(a)) return 'results';
		return 'panel';
	}

	private zones(): Zone[] {
		const showingResults = !this.resultsEl.hasAttribute('hidden');
		return showingResults ? ['input', 'results', 'tabs'] : ['input', 'panel', 'tabs'];
	}

	private focusZone(z: Zone): void {
		if (z === 'input') this.inputEl.focus();
		else if (z === 'results') this.resultsEl.focus();
		else if (z === 'tabs') this.tabsEl.querySelector<HTMLElement>('.docket-tab.is-active')?.focus();
		else (this.panelEl.querySelector<HTMLElement>('[data-docket-item]') ?? this.panelEl).focus();
	}

	private onKey(e: KeyboardEvent): void {
		if (e.isComposing) return;
		const mod = Platform.isMacOS ? e.metaKey : e.ctrlKey;
		const zone = this.zone();
		const listy = zone === 'input' || zone === 'results';
		const handled = () => { e.preventDefault(); e.stopPropagation(); };
		switch (e.key) {
			case 'Escape':
				handled();
				if (this.actions) this.leaveActions();
				else if (zone !== 'input') this.focusZone('input');
				else if (this.only) { this.only = null; void this.update(); }
				else if (this.inputEl.value) { this.inputEl.value = ''; void this.update(); }
				else this.close();
				return;
			case 'Tab': {
				handled();
				const zs = this.zones();
				const i = zs.indexOf(zone === 'results' || zone === 'panel' ? zs[1]! : zone);
				this.focusZone(zs[(i + (e.shiftKey ? -1 : 1) + zs.length) % zs.length]!);
				return;
			}
			case 'ArrowDown':
			case 'ArrowUp': {
				const step = e.key === 'ArrowDown' ? 1 : -1;
				if (e.altKey && mod) return; // resize: a command
				if (listy && !this.resultsEl.hasAttribute('hidden')) { handled(); this.select(this.selected + step); return; }
				if (zone === 'panel' || (zone === 'input' && step === 1 && !this.panelEl.hasAttribute('hidden'))) {
					const items = Array.from(this.panelEl.querySelectorAll<HTMLElement>('[data-docket-item]'));
					if (!items.length) return;
					handled();
					const at = items.indexOf(document.activeElement as HTMLElement);
					items[at === -1 ? 0 : Math.min(items.length - 1, Math.max(0, at + step))]!.focus();
				}
				return;
			}
			case 'ArrowRight':
			case 'ArrowLeft':
				if (zone === 'tabs') {
					handled();
					const tabs = Array.from(this.tabsEl.querySelectorAll<HTMLElement>('.docket-tab'));
					const at = tabs.indexOf(document.activeElement as HTMLElement);
					const next = tabs[(at + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length];
					if (next) { this.showPanel(next.dataset.panel!); this.focusZone('tabs'); }
					return;
				}
				if (e.key === 'ArrowLeft' && this.actions && (zone !== 'input' || this.inputEl.selectionStart === 0)) { handled(); this.leaveActions(); return; }
				if (e.key === 'ArrowRight' && listy && !this.actions && !this.resultsEl.hasAttribute('hidden')) {
					const atEnd = zone === 'results' || (this.inputEl.selectionStart === this.inputEl.value.length && this.inputEl.selectionEnd === this.inputEl.value.length);
					if (atEnd && this.showActions()) handled();
				}
				return;
			case '.':
				if (mod && listy) { handled(); this.showActions(); }
				return;
			case 'Enter':
				if (listy && !this.resultsEl.hasAttribute('hidden')) { handled(); this.choose(this.whereFor(e)); return; }
				if (zone === 'panel' && document.activeElement instanceof HTMLElement && document.activeElement.dataset.docketItem !== undefined) {
					handled();
					document.activeElement.dispatchEvent(new CustomEvent('docket-choose', { detail: this.whereFor(e) }));
				}
				return;
		}
	}
}
