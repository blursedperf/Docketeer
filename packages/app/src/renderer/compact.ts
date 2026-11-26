/**
 * The compact layout (body.is-compact: a narrow window, such as an iPhone; docs/mobile/PLAN.md, Phase 2): one pane
 * at a time, its tabs behind an "Open tabs" button in the view header instead of a tab bar, no tiling, and a
 * swipe in from the left edge to go back. Panes already open stay open, out of sight: widening the window shows
 * them again. The Docket is a sheet that rises from a button at the bottom, within thumb's reach and away from
 * the iPhone's Dynamic Island (decisions.md §9), and stays above the keyboard.
 */
import { type App, ItemView, Modal, type WorkspaceLeaf, setIcon } from '@quire/api';

/** True while the window has the compact layout. */
export function isCompact(): boolean {
	return document.body.classList.contains('is-compact');
}

/**
 * Not offered in the compact layout (docs/mobile/PLAN.md, Phase 2): making or moving between panes, arranging and
 * editing the Docket's panels, and AGLC4's page preview, which needs a page's width beside the note.
 */
export const COMPACT_HIDDEN = new RegExp([
	/^app:(split-|focus-pane-|move-tab-|pane-|equalise-panes|zoom-pane|next-pane|previous-pane|rotate-split|close-pane|close-other-panes|merge-panes|layout-|save-layout|apply-layout)/.source,
	/^app:(arrange-panels|new-panel)$/.source,
	/^aglc-citations:(page-preview|ribbon-open-aglc4-page-preview)$/.source,
].join('|'));

/** How far in from the left edge a swipe back starts (CSS pixels), and how far it must travel. */
export const EDGE = 24;
export const SWIPE = 70;

export function registerCompact(app: App): void {
	const { workspace } = app;

	// One pane at a time while compact; the active one is what shows.
	const follow = () => {
		const compact = isCompact();
		workspace.singlePane = compact;
		if (compact && !workspace.activeLeaf) {
			let first: WorkspaceLeaf | null = null;
			workspace.iterateRootLeaves((l) => { first ??= l; });
			if (first) workspace.setActiveLeaf(first, { focus: false });
		}
	};
	follow();
	new MutationObserver(follow).observe(document.body, { attributes: true, attributeFilter: ['class'] });

	// Left out while compact, plugins' commands too (their own checks apply otherwise).
	app.commands.hidden = (c) => isCompact() && COMPACT_HIDDEN.test(c.id);

	// "Open tabs" in every view's header (shown only while compact).
	const withButton = new WeakSet<ItemView>();
	const addButtons = () => workspace.iterateRootLeaves((leaf) => {
		const view = leaf.view;
		if (!(view instanceof ItemView) || withButton.has(view)) return;
		withButton.add(view);
		const b = view.addAction('layers', 'Open tabs', () => new TabsModal(app).open());
		b.addClass('mod-open-tabs');
	});
	addButtons();

	// The tab bar is hidden: the title in the view's header opens the tab's menu (rename, Share…, export, close).
	workspace.containerEl.addEventListener('contextmenu', (e) => {
		const title = e.target instanceof Element ? e.target.closest('.view-header-title') : null;
		if (!isCompact() || !title) return;
		let leaf: WorkspaceLeaf | null = null;
		workspace.iterateRootLeaves((l) => { if (!leaf && l.view.containerEl.contains(title)) leaf = l; });
		if (!leaf) return;
		e.preventDefault();
		(leaf as WorkspaceLeaf).tabHeaderEl.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: e.clientX, clientY: e.clientY }));
	});
	workspace.on('layout-change', addButtons);
	workspace.on('active-leaf-change', addButtons);

	// Swipe in from the left edge: back to what this pane showed before.
	let start: { x: number; y: number } | null = null;
	let done = false;
	const root = workspace.containerEl;
	root.addEventListener('touchstart', (e) => {
		const t = e.touches[0];
		start = isCompact() && e.touches.length === 1 && t && t.clientX <= EDGE ? { x: t.clientX, y: t.clientY } : null;
		done = false;
	}, { passive: true });
	root.addEventListener('touchmove', (e) => {
		const t = e.touches[0];
		if (!start || done || !t) return;
		const dx = t.clientX - start.x, dy = Math.abs(t.clientY - start.y);
		if (dy > SWIPE) { start = null; return; }
		if (dx >= SWIPE && dx > dy * 2) {
			done = true;
			app.commands.executeCommandById('app:go-back');
		}
	}, { passive: true });
	root.addEventListener('touchend', () => { start = null; }, { passive: true });

	dockAtTheBottom(app);
}

/** How far a swipe down on the Docket's top closes it (CSS pixels). */
export const SHEET_SWIPE = 70;

/**
 * The Docket on a narrow window: a full-width button at the bottom opens it, it rises as a sheet (styles in
 * app.css), sits above the keyboard, and a swipe down on its grab bar or search row closes it.
 */
function dockAtTheBottom(app: App): void {
	const container = document.querySelector<HTMLElement>('.app-container');
	if (!container) return;
	const button = container.createEl('button', { cls: 'compact-docket-button', attr: { type: 'button', 'aria-label': 'Open the Docket: notes, search, commands and panels' } });
	setIcon(button.createSpan({ cls: 'compact-docket-icon' }), 'search');
	button.createSpan({ text: 'Docket' });
	// On a touch screen it opens without the cursor in its search field, so no keyboard covers the panels (a tap on
	// the field brings it); with a mouse, the cursor is there as usual.
	button.addEventListener('click', () => {
		const ui = (app as unknown as { docketUI?: { isOpen: boolean; open(o?: { focus?: boolean }): void; close(hide?: boolean): void } }).docketUI;
		if (!ui) return;
		if (ui.isOpen) ui.close(true);
		else ui.open({ focus: !document.body.classList.contains('is-touch') });
	});

	// The sheet stands on the keyboard (--keyboard-inset: layout-mode.ts).

	// A grab bar on the Docket, whenever one is built (it is built after this, and again in tests).
	const grab = () => {
		for (const d of Array.from(container.querySelectorAll<HTMLElement>('.docket'))) {
			if (!d.querySelector(':scope > .compact-docket-grab')) d.prepend(createDiv({ cls: 'compact-docket-grab', attr: { 'aria-hidden': 'true' } }));
		}
	};
	grab();
	new MutationObserver(grab).observe(container, { childList: true });

	// A swipe down on the grab bar or the search row closes it.
	let from: number | null = null;
	document.addEventListener('touchstart', (e) => {
		const t = e.touches[0];
		const onTop = e.target instanceof Element && !!e.target.closest('.docket .compact-docket-grab, .docket .docket-head');
		from = isCompact() && onTop && t ? t.clientY : null;
	}, { passive: true });
	document.addEventListener('touchmove', (e) => {
		const t = e.touches[0];
		if (from === null || !t) return;
		if (t.clientY - from >= SHEET_SWIPE) {
			from = null;
			(app as unknown as { docketUI?: { close(hide?: boolean): void } }).docketUI?.close(true);
		}
	}, { passive: true });
	document.addEventListener('touchend', () => { from = null; }, { passive: true });
}

/** Every open tab, in every pane: go to one, close one, or open a new one. */
export class TabsModal extends Modal {
	override onOpen(): void {
		this.setTitle('Open tabs');
		this.modalEl.addClass('mod-open-tabs');
		this.draw();
	}

	private draw(): void {
		const { contentEl } = this;
		contentEl.empty();
		const { workspace } = this.app;
		const leaves: WorkspaceLeaf[] = [];
		workspace.iterateRootLeaves((l) => { leaves.push(l); });
		const list = contentEl.createDiv({ cls: 'open-tabs-list', attr: { role: 'list' } });
		for (const leaf of leaves) {
			const row = list.createDiv({ cls: `open-tabs-item${leaf === workspace.activeLeaf ? ' is-active' : ''}`, attr: { role: 'listitem' } });
			const go = row.createEl('button', { cls: 'open-tabs-go', attr: { type: 'button' } });
			setIcon(go.createSpan({ cls: 'open-tabs-icon' }), leaf.view.getIcon());
			go.createSpan({ cls: 'open-tabs-title', text: leaf.getDisplayText() || 'New tab' });
			go.addEventListener('click', () => {
				leaf.parent?.selectTab(leaf);
				workspace.setActiveLeaf(leaf, { focus: true });
				this.close();
			});
			const close = row.createEl('button', { cls: 'clickable-icon open-tabs-close', attr: { type: 'button', 'aria-label': `Close ${leaf.getDisplayText() || 'tab'}` } });
			setIcon(close, 'x');
			close.addEventListener('click', () => { leaf.detach(); window.setTimeout(() => this.draw(), 80); });
		}
		const add = contentEl.createEl('button', { cls: 'mod-cta open-tabs-new', text: 'New tab', attr: { type: 'button' } });
		add.addEventListener('click', () => {
			const leaf = workspace.getLeaf('tab');
			workspace.setActiveLeaf(leaf, { focus: true });
			this.close();
		});
	}
}
