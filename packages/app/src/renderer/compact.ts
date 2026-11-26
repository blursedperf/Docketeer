/**
 * The compact layout (body.is-compact: a narrow window, such as an iPhone; docs/mobile/PLAN.md, Phase 2): one pane
 * at a time, its tabs behind an "Open tabs" button in the view header instead of a tab bar, no tiling, and a
 * swipe in from the left edge to go back. Panes already open stay open, out of sight: widening the window shows
 * them again.
 */
import { type App, ItemView, Modal, type WorkspaceLeaf, setIcon } from '@quire/api';

/** True while the window has the compact layout. */
export function isCompact(): boolean {
	return document.body.classList.contains('is-compact');
}

/** Commands that make or move between panes: not offered in the compact layout. */
const TILING = /^app:(split-|focus-pane-|move-tab-|pane-|equalise-panes|zoom-pane|next-pane|previous-pane|rotate-split|close-pane|close-other-panes|merge-panes|layout-|save-layout|apply-layout)/;

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

	// Tiling commands are not offered while compact (their own checks apply otherwise).
	for (const c of Object.values(app.commands.commands)) {
		if (!TILING.test(c.id)) continue;
		const own = c.when;
		const plain = { ...c, when: undefined };
		c.when = (ctx) => !isCompact() && (own ? own(ctx) : app.commands.isAvailable(plain, ctx.args));
	}

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
