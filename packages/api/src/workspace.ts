import type { App } from './app';
import { type Direction, type LayoutNode, neighbour, resizePane } from './layout-tree';
import { Events, type EventRef } from './events';
import { TFile, type TAbstractFile } from './files';
import { setIcon } from './icons';
import type { Editor } from './editor';
import { MarkdownView } from './markdown-view';
import { AUDIO_EXTENSIONS, MediaView, VIDEO_EXTENSIONS, mediaKind, timeFromSubpath } from './media';
import { parseLinktext } from './metadata';
import { Menu, Notice } from './ui';
import { debounce } from './util';
import { EmptyView, FileInfoView, FileView, ItemView, View } from './view';

/** Sources that open beside the note linking to them: recordings and PDFs. */
function opensBeside(path: string): boolean {
	return mediaKind(path) !== null || /\.pdf$/i.test(path);
}

export type ViewCreator = (leaf: WorkspaceLeaf) => View;

/** A place in a pane's history: what it showed, and where in it (the cursor). */
export interface LeafHistoryEntry { state: ViewState; eState: Record<string, unknown> }
export type SplitDirection = 'vertical' | 'horizontal';
export type PaneType = 'tab' | 'split' | 'window';

export interface ViewState {
	type: string;
	state?: Record<string, unknown>;
	active?: boolean;
	pinned?: boolean;
}

export interface OpenViewState {
	state?: Record<string, unknown>;
	eState?: Record<string, unknown>;
	active?: boolean;
}

type Parent = WorkspaceSplit | WorkspaceTabs;

export abstract class WorkspaceItem extends Events {
	parent: WorkspaceSplit | null = null;
	containerEl: HTMLElement;
	/** Share of the parent split's size. */
	weight = 1;
	constructor(public workspace: Workspace, cls: string) {
		super();
		this.containerEl = createDiv({ cls });
	}
	getRoot(): WorkspaceItem {
		let x: WorkspaceItem = this;
		while (x.parent) x = x.parent;
		return x;
	}
}

/** A row (vertical) or column (horizontal) of tab groups and splits. */
export class WorkspaceSplit extends WorkspaceItem {
	children: (WorkspaceSplit | WorkspaceTabs)[] = [];
	constructor(workspace: Workspace, public direction: SplitDirection, cls = '') {
		super(workspace, `workspace-split mod-${direction} ${cls}`.trim());
	}

	/** Change between a row and a column (the main area, when a tab is dropped at the window's edge). */
	setDirection(direction: SplitDirection): void {
		this.containerEl.removeClass(`mod-${this.direction}`);
		this.direction = direction;
		this.containerEl.addClass(`mod-${direction}`);
		this.render();
	}

	insertChild(index: number, child: WorkspaceSplit | WorkspaceTabs): void {
		child.parent = this;
		this.children.splice(index, 0, child);
		this.render();
	}

	removeChild(child: WorkspaceSplit | WorkspaceTabs): void {
		this.children = this.children.filter((c) => c !== child);
		child.parent = null;
		child.containerEl.detach();
		this.render();
	}

	replaceChild(old: WorkspaceSplit | WorkspaceTabs, next: WorkspaceSplit | WorkspaceTabs): void {
		const i = this.children.indexOf(old);
		if (i === -1) return;
		next.parent = this;
		next.weight = old.weight;
		old.parent = null;
		old.containerEl.detach();
		this.children[i] = next;
		this.render();
	}

	/** Lay out children with resize handles between them. */
	render(): void {
		this.containerEl.empty();
		// Weights are shares of the row (or column): as flex-grow they must add up to at least 1, or the children
		// leave the rest empty (a pane left alone after its neighbour closed kept 0.5, so half the window stayed blank).
		const total = this.children.reduce((sum, c) => sum + (c.weight > 0 ? c.weight : 0), 0) || 1;
		this.children.forEach((child, i) => {
			if (i > 0) {
				const handle = this.containerEl.createDiv({ cls: 'workspace-leaf-resize-handle' });
				const before = this.children[i - 1]!;
				handle.addEventListener('mousedown', (e) => this.startResize(e, before, child));
			}
			child.containerEl.setCssStyles({ flexGrow: String((child.weight > 0 ? child.weight : 0) / total || 1), flexBasis: '0' });
			this.containerEl.appendChild(child.containerEl);
		});
	}

	private startResize(e: MouseEvent, a: WorkspaceItem, b: WorkspaceItem) {
		e.preventDefault();
		const horizontal = this.direction === 'vertical';
		const ra = a.containerEl.getBoundingClientRect();
		const rb = b.containerEl.getBoundingClientRect();
		const total = horizontal ? ra.width + rb.width : ra.height + rb.height;
		const weights = a.weight + b.weight;
		const start = horizontal ? e.clientX : e.clientY;
		const sizeA = horizontal ? ra.width : ra.height;
		document.body.addClass('is-resizing');
		const move = (ev: MouseEvent) => {
			const d = (horizontal ? ev.clientX : ev.clientY) - start;
			const share = Math.max(0.08, Math.min(0.92, (sizeA + d) / total));
			a.weight = share * weights;
			b.weight = (1 - share) * weights;
			const all = this.children.reduce((sum, c) => sum + (c.weight > 0 ? c.weight : 0), 0) || 1;
			a.containerEl.style.flexGrow = String(a.weight / all);
			b.containerEl.style.flexGrow = String(b.weight / all);
			this.workspace.trigger('resize');
		};
		const up = () => {
			document.body.removeClass('is-resizing');
			window.removeEventListener('mousemove', move);
			window.removeEventListener('mouseup', up);
			this.workspace.onResized();
		};
		window.addEventListener('mousemove', move);
		window.addEventListener('mouseup', up);
	}
}

/**
 * What plugins written for sidebars find at `workspace.leftSplit` / `rightSplit`. Quire has no sidebars
 * (the Docket replaces them): always collapsed, and expanding does nothing. Views such plugins open in a
 * sidebar open as tabs instead (`getRightLeaf`).
 */
export class WorkspaceSidedock {
	readonly collapsed = true;
	collapse(): void { /* no sidebars */ }
	expand(): void { /* no sidebars */ }
	toggle(): void { /* no sidebars */ }
}

/** A group of tabs; one leaf shows at a time. */
export class WorkspaceTabs extends WorkspaceItem {
	children: WorkspaceLeaf[] = [];
	currentTab = 0;
	headerEl: HTMLElement;
	tabsEl: HTMLElement;
	contentEl: HTMLElement;
	override parent: WorkspaceSplit | null = null;

	/** Always false: there are no sidebar tab groups (kept for plugins that check). */
	readonly sidebar = false;

	constructor(workspace: Workspace) {
		super(workspace, 'workspace-tabs');
		this.headerEl = this.containerEl.createDiv({ cls: 'workspace-tab-header-container' });
		this.tabsEl = this.headerEl.createDiv({ cls: 'workspace-tab-header-container-inner' });
		{
			const add = this.headerEl.createDiv({ cls: 'workspace-tab-header-new-tab clickable-icon', attr: { 'aria-label': 'New tab' } });
			setIcon(add, 'plus');
			add.addEventListener('click', () => {
				const leaf = this.workspace.createLeafInTabs(this);
				this.workspace.setActiveLeaf(leaf, { focus: true });
			});
			this.headerEl.createDiv({ cls: 'workspace-tab-header-spacer' });
		}
		this.contentEl = this.containerEl.createDiv({ cls: 'workspace-tab-container' });
	}

	insertChild(index: number, leaf: WorkspaceLeaf): void {
		leaf.parent = this;
		this.children.splice(index, 0, leaf);
		this.tabsEl.insertBefore(leaf.tabHeaderEl, this.tabsEl.children[index] ?? null);
		this.contentEl.insertBefore(leaf.containerEl, this.contentEl.children[index] ?? null);
		this.selectTab(leaf);
	}

	/**
	 * Stacked tabs: every tab shown side by side at a reading width, scrolling sideways, each with a spine carrying
	 * its title; as they scroll, earlier tabs fold into spines at the left and later ones at the right.
	 */
	stacked = false;

	setStacked(on: boolean): void {
		this.stacked = on;
		this.containerEl.toggleClass('mod-stacked', on);
		const current = this.activeLeaf;
		if (current) this.selectTab(current);
		this.workspace.requestSaveLayout();
	}

	removeChild(leaf: WorkspaceLeaf): void {
		const i = this.children.indexOf(leaf);
		if (i === -1) return;
		this.children.splice(i, 1);
		leaf.tabHeaderEl.detach();
		leaf.containerEl.detach();
		leaf.parent = null;
		if (this.children.length) this.selectTab(this.children[Math.min(i, this.children.length - 1)]!);
	}

	selectTab(leaf: WorkspaceLeaf): void {
		this.currentTab = Math.max(0, this.children.indexOf(leaf));
		const n = this.children.length;
		this.children.forEach((l, i) => {
			const on = i === this.currentTab;
			l.containerEl.toggle(on || this.stacked);
			l.tabHeaderEl.toggleClass('is-active', on);
			l.containerEl.toggleClass('is-stack-active', this.stacked && on);
			l.setSpine(this.stacked);
			// Where it sticks while scrolling: after the spines before it, before the spines after it.
			l.containerEl.style.setProperty('--stack-before', String(i));
			l.containerEl.style.setProperty('--stack-after', String(n - 1 - i));
		});
		if (this.stacked) leaf.containerEl.scrollIntoView({ block: 'nearest', inline: 'nearest' });
		if (leaf.view) leaf.view.onResize();
	}

	get activeLeaf(): WorkspaceLeaf | null { return this.children[this.currentTab] ?? null; }
}

/** A pane holding a view. */
export class WorkspaceLeaf extends Events {
	app: App;
	view: View;
	parent: WorkspaceTabs | null = null;
	containerEl: HTMLElement;
	tabHeaderEl: HTMLElement;
	private tabIconEl: HTMLElement;
	private tabTitleEl: HTMLElement;
	pinned = false;
	/**
	 * Where this pane has been, for Back and Forward (newest last): a note replaced by another is one Back away,
	 * at the place the cursor was.
	 */
	history: { back: LeafHistoryEntry[]; forward: LeafHistoryEntry[] } = { back: [], forward: [] };
	private navigating = false;
	/** The spine a stacked tab shows its title on (see WorkspaceTabs.stacked). */
	private spineEl: HTMLElement | null = null;

	setSpine(on: boolean): void {
		if (!on) { this.spineEl?.remove(); this.spineEl = null; return; }
		if (!this.spineEl) {
			this.spineEl = createDiv({ cls: 'workspace-leaf-spine', attr: { role: 'button', tabindex: '-1' } });
			// Its own close button, since the tab strip (and its close buttons) is hidden while stacked.
			const close = this.spineEl.createDiv({ cls: 'workspace-leaf-spine-close clickable-icon', attr: { 'aria-label': 'Close' } });
			setIcon(close, 'x');
			close.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
			close.addEventListener('click', (e) => { e.stopPropagation(); this.detach(); });
			this.spineEl.createDiv({ cls: 'workspace-leaf-spine-title' });
			this.spineEl.addEventListener('mousedown', (e) => {
				e.preventDefault();
				if (e.button === 1) { this.detach(); return; }
				if (e.button !== 0) return;
				this.parent?.selectTab(this);
				this.workspace.setActiveLeaf(this, { focus: true });
			});
			this.containerEl.prepend(this.spineEl);
		}
		this.spineEl.querySelector('.workspace-leaf-spine-title')!.setText(this.view.getDisplayText());
		this.spineEl.setAttribute('aria-label', `Show ${this.view.getDisplayText()}`);
	}
	/** When it was last active, for getMostRecentLeaf. */
	activeTime = 0;
	private working: Promise<void> = Promise.resolve();

	constructor(public workspace: Workspace) {
		super();
		this.app = workspace.app;
		this.containerEl = createDiv({ cls: 'workspace-leaf' });
		this.tabHeaderEl = createDiv({ cls: 'workspace-tab-header', attr: { draggable: 'true' } });
		// Drag a tab: along a tab bar, onto another pane (its edges split it), or to the window's edges.
		this.tabHeaderEl.addEventListener('dragstart', (e) => {
			if (!e.dataTransfer) return;
			e.dataTransfer.effectAllowed = 'move';
			e.dataTransfer.setData('application/x-quire-tab', this.getDisplayText());
			this.workspace.startTabDrag(this);
		});
		this.tabHeaderEl.addEventListener('dragend', () => this.workspace.endTabDrag());
		this.tabIconEl = this.tabHeaderEl.createDiv({ cls: 'workspace-tab-header-inner-icon' });
		this.tabTitleEl = this.tabHeaderEl.createDiv({ cls: 'workspace-tab-header-inner-title' });
		const close = this.tabHeaderEl.createDiv({ cls: 'workspace-tab-header-inner-close-button clickable-icon', attr: { 'aria-label': 'Close' } });
		setIcon(close, 'x');
		close.addEventListener('click', (e) => { e.stopPropagation(); this.detach(); });
		this.tabHeaderEl.addEventListener('mousedown', (e) => {
			if (e.button === 1) { e.preventDefault(); this.detach(); return; }
			if (e.button !== 0) return;
			this.parent?.selectTab(this);
			if (!this.isSidebar()) this.workspace.setActiveLeaf(this, { focus: true });
		});
		this.tabHeaderEl.addEventListener('contextmenu', (e) => {
			const menu = new Menu();
			// Each item runs a command for this pane (falling back to the action if the command is absent).
			const run = (id: string, fallback: () => unknown) => () => { if (!this.app.commands.executeCommandById(id, { leaf: this })) fallback(); };
			menu.addItem((i) => i.setTitle('Close').setIcon('x').onClick(run('app:close-tab', () => this.detach())));
			menu.addItem((i) => i.setTitle('Split right').setIcon('separator-vertical').onClick(run('app:split-right', () => this.workspace.duplicateLeaf(this, 'vertical'))));
			menu.addItem((i) => i.setTitle('Split down').setIcon('separator-horizontal').onClick(run('app:split-down', () => this.workspace.duplicateLeaf(this, 'horizontal'))));
			menu.addItem((i) => i.setTitle(this.parent?.stacked ? 'Unstack tabs' : 'Stack tabs').setIcon('layers').onClick(() => this.parent?.setStacked(!this.parent.stacked)));
			this.view.onPaneMenu(menu, 'tab-header');
			menu.showAtMouseEvent(e);
		});
		this.containerEl.addEventListener('mousedown', () => { if (!this.isSidebar() && this.workspace.activeLeaf !== this) this.workspace.setActiveLeaf(this, { focus: false }); }, true);
		this.containerEl.addEventListener('focusin', () => { if (!this.isSidebar() && this.workspace.activeLeaf !== this) this.workspace.setActiveLeaf(this, { focus: false }); });
		this.view = new EmptyView(this);
		this.containerEl.appendChild(this.view.containerEl);
		this.view.load();
		void this.view.onOpen();
		this.updateHeader();
	}

	/** Always false: there are no sidebars (kept for plugins that check). */
	isSidebar(): boolean { return false; }

	getRoot(): WorkspaceItem | null { return this.parent?.getRoot() ?? null; }

	getViewState(): ViewState {
		return { type: this.view.getViewType(), state: this.view.getState(), pinned: this.pinned };
	}

	/** Show a view of `state.type` with `state.state`. Calls are queued, so they never overlap. */
	setViewState(state: ViewState, eState?: Record<string, unknown>): Promise<void> {
		const run = async () => {
			// Leaving a note or file for another: remember it for Back (not while going Back or Forward).
			if (!this.navigating && this.view instanceof FileView && this.view.file) {
				const next = (state.state as { file?: unknown } | undefined)?.file;
				if (state.type !== this.view.getViewType() || next !== this.view.file.path) {
					this.history.back.push({ state: this.getViewState(), eState: this.view.getEphemeralState() });
					if (this.history.back.length > 50) this.history.back.shift();
					this.history.forward = [];
				}
			}
			if (this.view.getViewType() !== state.type) {
				const creator = this.workspace.getViewCreator(state.type);
				if (!creator) throw new Error(`No view of type "${state.type}" is registered`);
				const old = this.view;
				await old.onClose();
				old.unload();
				old.containerEl.detach();
				const view = creator(this);
				this.view = view;
				view.containerEl.dataset.type = state.type;
				this.containerEl.appendChild(view.containerEl);
				view.load();
				await view.onOpen();
				// The active pane now shows something else: tell listeners, as a change of pane would.
				if (this.workspace.activeLeaf === this) {
					this.workspace.trigger('active-leaf-change', this);
					this.workspace.trigger('layout-change');
				}
			}
			await this.view.setState(state.state ?? {}, { history: false });
			if (eState) this.view.setEphemeralState(eState);
			if (state.pinned !== undefined) this.pinned = state.pinned;
			this.updateHeader();
			this.workspace.requestSaveLayout();
			if (state.active) this.workspace.setActiveLeaf(this, { focus: true });
		};
		this.working = this.working.then(run, run);
		return this.working;
	}

	async openFile(file: TFile, openState: OpenViewState = {}): Promise<void> {
		// A locked note asks for the passphrase first; without it, nothing opens.
		if (this.workspace.app.isLocked(file) && !(await this.workspace.app.lock.requestUnlock())) return;
		const type = this.workspace.viewTypeForFile(file);
		if (this.view instanceof FileView && this.view.getViewType() === type) {
			await this.setViewState({ type, state: { ...this.view.getState(), ...(openState.state ?? {}), file: file.path } }, openState.eState);
		} else {
			await this.setViewState({ type, state: { ...(openState.state ?? {}), file: file.path } }, openState.eState);
		}
		if (openState.active !== false && !this.isSidebar()) this.workspace.setActiveLeaf(this, { focus: true });
	}

	get canGoBack(): boolean { return this.history.back.some((e) => this.stillThere(e)); }
	get canGoForward(): boolean { return this.history.forward.some((e) => this.stillThere(e)); }

	private stillThere(e: LeafHistoryEntry): boolean {
		const file = (e.state.state as { file?: unknown } | undefined)?.file;
		return typeof file !== 'string' || !!this.workspace.app.vault.getAbstractFileByPath(file);
	}

	/** Back to what this pane showed before (true if it went). Files since deleted are skipped. */
	goBack(): Promise<boolean> { return this.travel(this.history.back, this.history.forward); }
	/** Forward again after going Back. */
	goForward(): Promise<boolean> { return this.travel(this.history.forward, this.history.back); }

	private async travel(from: LeafHistoryEntry[], to: LeafHistoryEntry[]): Promise<boolean> {
		let e = from.pop();
		while (e && !this.stillThere(e)) e = from.pop();
		if (!e) { this.updateHeader(); return false; }
		if (this.view instanceof FileView && this.view.file) to.push({ state: this.getViewState(), eState: this.view.getEphemeralState() });
		this.navigating = true;
		try {
			await this.setViewState(e.state, e.eState);
		} finally {
			this.navigating = false;
		}
		this.workspace.setActiveLeaf(this, { focus: true });
		return true;
	}

	getDisplayText(): string { return this.view.getDisplayText(); }
	getIcon(): string { return this.view.getIcon(); }

	updateHeader(): void {
		setIcon(this.tabIconEl, this.view.getIcon());
		this.tabTitleEl.setText(this.view.getDisplayText());
		this.tabHeaderEl.setAttribute('aria-label', this.view.getDisplayText());
		if (this.spineEl) this.setSpine(true);
		if (this.view instanceof ItemView) this.view.updateTitle();
	}

	setPinned(pinned: boolean): void { this.pinned = pinned; }

	/** Close the pane. */
	detach(): void {
		void (async () => {
			await this.view.onClose();
			this.view.unload();
			this.workspace.removeLeaf(this);
			this.trigger('detach');
		})();
	}

	onResize(): void { this.view.onResize(); }
}

/**
 * The app's panes: a tree of splits and tab groups. (No sidebars: the Docket replaces them.)
 */
export class Workspace extends Events {
	containerEl: HTMLElement;
	rootSplit: WorkspaceSplit;
	/** For plugins that expect sidebars: always collapsed (see WorkspaceSidedock). */
	leftSplit = new WorkspaceSidedock();
	rightSplit = new WorkspaceSidedock();
	/** For plugins that add ribbon buttons: there is no ribbon; `Plugin.addRibbonIcon` adds a command instead. */
	leftRibbon: { containerEl: HTMLElement; addRibbonItemButton: (id: string, icon: string, title: string, cb: (evt: MouseEvent) => unknown) => HTMLElement };
	activeLeaf: WorkspaceLeaf | null = null;
	layoutReady = false;
	private viewCreators = new Map<string, ViewCreator>();
	private extensionsForType = new Map<string, string>();
	private readyCallbacks: (() => unknown)[] = [];
	private lastFileLeaf: WorkspaceLeaf | null = null;
	readonly requestSaveLayout = debounce(() => { void this.saveLayout(); }, 1000, true);

	constructor(public app: App, containerEl: HTMLElement) {
		super();
		this.containerEl = containerEl;
		containerEl.addClass('workspace');
		this.leftRibbon = { containerEl: createDiv(), addRibbonItemButton: (_id, _icon, title) => createDiv({ attr: { 'aria-label': title } }) };
		this.rootSplit = new WorkspaceSplit(this, 'vertical', 'mod-root');
		containerEl.append(this.rootSplit.containerEl);

		this.registerViewType('empty', (leaf) => new EmptyView(leaf));
		this.registerViewType('markdown', (leaf) => new MarkdownView(leaf), ['md', 'markdown', 'txt']);
		this.registerViewType('file-info', (leaf) => new FileInfoView(leaf));
		this.registerViewType('media', (leaf) => new MediaView(leaf), [...VIDEO_EXTENSIONS, ...AUDIO_EXTENSIONS]);
		window.addEventListener('resize', () => this.onResized());

		app.vault.on('rename', (file: TAbstractFile) => {
			this.iterateAllLeaves((leaf) => { if (leaf.view instanceof FileView && leaf.view.file === file) leaf.view.onRename(file as TFile); });
			this.requestSaveLayout();
		});
		app.vault.on('delete', (file: TAbstractFile) => {
			this.iterateAllLeaves((leaf) => { if (leaf.view instanceof FileView && leaf.view.file === file) leaf.detach(); });
		});
	}

	onResized(): void {
		this.trigger('resize');
		this.iterateAllLeaves((l) => { if (l.containerEl.isShown()) l.onResize(); });
		this.requestSaveLayout();
	}

	// ---------------------------------------------------------------------------------------------
	// View types

	registerViewType(type: string, creator: ViewCreator, extensions: string[] = []): void {
		this.viewCreators.set(type, creator);
		for (const ext of extensions) this.extensionsForType.set(ext, type);
	}

	unregisterViewType(type: string): void {
		this.viewCreators.delete(type);
		for (const [ext, t] of [...this.extensionsForType]) if (t === type) this.extensionsForType.delete(ext);
		for (const leaf of this.getLeavesOfType(type)) leaf.detach();
	}

	registerExtensions(extensions: string[], type: string): void {
		for (const ext of extensions) this.extensionsForType.set(ext, type);
	}

	getViewCreator(type: string): ViewCreator | undefined { return this.viewCreators.get(type); }

	viewTypeForFile(file: TFile): string {
		return this.extensionsForType.get(file.extension) ?? 'file-info';
	}

	// ---------------------------------------------------------------------------------------------
	// Leaves

	/** A new leaf in `tabs`, after its current tab. */
	createLeafInTabs(tabs: WorkspaceTabs, index?: number): WorkspaceLeaf {
		const leaf = new WorkspaceLeaf(this);
		tabs.insertChild(index ?? Math.min(tabs.children.length, tabs.currentTab + 1), leaf);
		this.requestSaveLayout();
		return leaf;
	}

	/** The tab groups of the main area. */
	rootTabs(): WorkspaceTabs[] {
		const out: WorkspaceTabs[] = [];
		const visit = (x: WorkspaceSplit | WorkspaceTabs) => {
			if (x instanceof WorkspaceTabs) out.push(x);
			else x.children.forEach(visit);
		};
		visit(this.rootSplit);
		return out;
	}

	/** The tab group of the active root leaf, or the first one (created if none). */
	private activeRootTabs(): WorkspaceTabs {
		const leaf = this.getMostRecentLeaf();
		if (leaf?.parent) return leaf.parent;
		const first = this.rootTabs()[0];
		if (first) return first;
		const tabs = new WorkspaceTabs(this);
		this.rootSplit.insertChild(0, tabs);
		return tabs;
	}

	getMostRecentLeaf(root: WorkspaceItem = this.rootSplit): WorkspaceLeaf | null {
		let best: WorkspaceLeaf | null = null;
		this.iterateLeaves(root, (l) => { if (!best || l.activeTime > best.activeTime) best = l; });
		return best;
	}

	/**
	 * A leaf to open something in: false reuses the active root leaf, 'tab' (or true) adds a tab, 'split'
	 * splits the active leaf.
	 */
	getLeaf(newLeaf?: boolean | PaneType, direction: SplitDirection = 'vertical'): WorkspaceLeaf {
		if (newLeaf === 'split') {
			const leaf = this.getMostRecentLeaf();
			return leaf ? this.createLeafBySplit(leaf, direction) : this.createLeafInTabs(this.activeRootTabs());
		}
		if (newLeaf === true || newLeaf === 'tab' || newLeaf === 'window') {
			const recent = this.getMostRecentLeaf();
			if (recent && !recent.pinned && recent.view instanceof EmptyView) return recent;
			return this.createLeafInTabs(this.activeRootTabs());
		}
		const recent = this.getMostRecentLeaf();
		if (recent && !recent.pinned) return recent;
		return this.createLeafInTabs(this.activeRootTabs());
	}

	getUnpinnedLeaf(): WorkspaceLeaf { return this.getLeaf(false); }

	/** A new leaf beside (vertical) or below (horizontal) `leaf`. */
	createLeafBySplit(leaf: WorkspaceLeaf, direction: SplitDirection = 'vertical', before = false): WorkspaceLeaf {
		const tabs = leaf.parent;
		if (!tabs) return this.getLeaf('tab');
		const split = tabs.parent!;
		const newTabs = new WorkspaceTabs(this);
		const fresh = new WorkspaceLeaf(this);
		newTabs.insertChild(0, fresh);
		if (split.direction === direction) {
			const i = split.children.indexOf(tabs);
			newTabs.weight = tabs.weight / 2;
			tabs.weight /= 2;
			split.insertChild(before ? i : i + 1, newTabs);
		} else {
			const sub = new WorkspaceSplit(this, direction);
			split.replaceChild(tabs, sub);
			tabs.weight = 1;
			sub.insertChild(0, tabs);
			sub.insertChild(before ? 0 : 1, newTabs);
		}
		this.requestSaveLayout();
		return fresh;
	}

	async duplicateLeaf(leaf: WorkspaceLeaf, direction: SplitDirection): Promise<WorkspaceLeaf> {
		const next = this.createLeafBySplit(leaf, direction);
		await next.setViewState(leaf.getViewState());
		this.setActiveLeaf(next, { focus: true });
		return next;
	}

	/** A new tab in the active pane: where views plugins open "in a sidebar" go (there are no sidebars). */
	/**
	 * What a plugin would put in the right sidebar (a page preview, a version history) opens beside the note
	 * instead, as PDFs and recordings do: a new tab in the pane to the right of the one in use, or a new pane
	 * split off to the right when there is none.
	 */
	getRightLeaf(_split = false): WorkspaceLeaf {
		return this.leafBeside('right');
	}

	/** The left sidebar's equivalent: beside the note, to the left. */
	getLeftLeaf(_split = false): WorkspaceLeaf {
		return this.leafBeside('left');
	}

	private leafBeside(dir: 'left' | 'right'): WorkspaceLeaf {
		const leaf = this.activeRootLeaf() ?? this.getMostRecentLeaf();
		if (!leaf?.parent) return this.createLeafInTabs(this.activeRootTabs());
		const { tree, panes } = this.layoutTree();
		const id = [...panes].find(([, t]) => t === leaf.parent)?.[0];
		const next = id ? neighbour(tree, id, dir) : null;
		const tabs = next ? panes.get(next) : null;
		if (tabs) return this.createLeafInTabs(tabs);
		return this.createLeafBySplit(leaf, 'vertical', dir === 'left');
	}

	ensureSideLeaf(type: string, side: 'left' | 'right', opts: { active?: boolean; reveal?: boolean; state?: Record<string, unknown> } = {}): Promise<WorkspaceLeaf> {
		const existing = this.getLeavesOfType(type)[0];
		if (existing) {
			if (opts.reveal) void this.revealLeaf(existing);
			return Promise.resolve(existing);
		}
		const leaf = side === 'left' ? this.getLeftLeaf() : this.getRightLeaf();
		return leaf.setViewState({ type, state: opts.state, active: opts.active }).then(() => {
			if (opts.reveal) void this.revealLeaf(leaf);
			return leaf;
		});
	}

	/** Remove a leaf from the layout, tidying empty groups and single-child splits. */
	removeLeaf(leaf: WorkspaceLeaf): void {
		const tabs = leaf.parent;
		if (!tabs) return;
		// Remember closed notes (main area) for "Reopen closed tab".
		{
			const st = leaf.getViewState();
			if (st.type !== 'empty' && typeof st.state?.file === 'string') {
				this.closedTabs.push(st);
				if (this.closedTabs.length > 30) this.closedTabs.shift();
			}
		}
		tabs.removeChild(leaf);
		if (this.activeLeaf === leaf) this.activeLeaf = null;
		if (this.lastFileLeaf === leaf) this.lastFileLeaf = null;
		this.tidyEmpty(tabs);
		if (!this.activeLeaf) {
			const next = this.getMostRecentLeaf() ?? this.rootTabs()[0]?.activeLeaf ?? null;
			if (next) this.setActiveLeaf(next, { focus: true });
			else this.trigger('active-leaf-change', null);
		}
		this.trigger('layout-change');
		this.requestSaveLayout();
	}

	/** Notes closed in the main area, newest last (for reopening). */
	closedTabs: ViewState[] = [];

	/** Remove a tab group left empty, and splits left with one child. */
	private tidyEmpty(tabs: WorkspaceTabs): void {
		if (tabs.children.length === 0) {
			let node: WorkspaceSplit | WorkspaceTabs = tabs;
			let parent = node.parent;
			while (parent && parent !== this.rootSplit && parent.children.length === 1) {
				node = parent;
				parent = parent.parent;
			}
			parent?.removeChild(node);
			// Collapse splits left with one child.
			const collapse = (s: WorkspaceSplit) => {
				for (const c of [...s.children]) if (c instanceof WorkspaceSplit) collapse(c);
				if (s !== this.rootSplit && s.children.length === 1 && s.parent) {
					const only = s.children[0]!;
					s.children = [];
					s.parent.replaceChild(s, only);
				}
			};
			collapse(this.rootSplit);
			if (this.rootTabs().length === 0) {
				const fresh = new WorkspaceTabs(this);
				this.rootSplit.insertChild(0, fresh);
				this.createLeafInTabs(fresh);
			}
		}
	}

	// ---------------------------------------------------------------------------------------------
	// Tiling: the main area as a plain tree (layout-tree.ts does the geometry)

	private paneIds = new WeakMap<WorkspaceTabs, string>();
	private nextPaneId = 0;

	/** The main area as a tree, with the tab groups and splits behind its ids and paths. */
	layoutTree(): { tree: LayoutNode; panes: Map<string, WorkspaceTabs>; splitAt(path: number[]): WorkspaceSplit } {
		const panes = new Map<string, WorkspaceTabs>();
		const build = (x: WorkspaceSplit | WorkspaceTabs): LayoutNode => {
			if (x instanceof WorkspaceTabs) {
				let id = this.paneIds.get(x);
				if (!id) { id = `p${++this.nextPaneId}`; this.paneIds.set(x, id); }
				panes.set(id, x);
				return { kind: 'pane', id };
			}
			return { kind: 'split', dir: x.direction === 'vertical' ? 'row' : 'column', weights: x.children.map((c) => c.weight), children: x.children.map(build) };
		};
		const tree = build(this.rootSplit);
		const splitAt = (path: number[]) => {
			let n: WorkspaceSplit | WorkspaceTabs = this.rootSplit;
			for (const i of path) n = (n as WorkspaceSplit).children[i]!;
			return n as WorkspaceSplit;
		};
		return { tree, panes, splitAt };
	}

	private activeRootLeaf(): WorkspaceLeaf | null {
		const l = this.activeLeaf;
		return l ?? this.getMostRecentLeaf();
	}

	/** Give the keyboard to the pane next to the active one. */
	focusPane(dir: Direction): boolean {
		const leaf = this.activeRootLeaf();
		if (!leaf?.parent) return false;
		const { tree, panes } = this.layoutTree();
		const id = [...panes].find(([, t]) => t === leaf.parent)?.[0];
		const next = id ? neighbour(tree, id, dir) : null;
		const target = next ? panes.get(next)?.activeLeaf : null;
		if (!target) return false;
		this.setActiveLeaf(target, { focus: true });
		return true;
	}

	/** Move a tab into the pane next to it, making a new pane there when there is none. */
	moveLeafToPane(leaf: WorkspaceLeaf, dir: Direction): boolean {
		const from = leaf.parent;
		if (!from) return false;
		const { tree, panes } = this.layoutTree();
		const id = [...panes].find(([, t]) => t === from)?.[0];
		const next = id ? neighbour(tree, id, dir) : null;
		let target = next ? panes.get(next)! : null;
		if (!target) {
			if (from.children.length < 2) return false; // alone in its pane: nothing to move away from
			target = new WorkspaceTabs(this);
			const split = from.parent!;
			const direction: SplitDirection = dir === 'left' || dir === 'right' ? 'vertical' : 'horizontal';
			const before = dir === 'left' || dir === 'up';
			if (split.direction === direction) {
				split.insertChild(split.children.indexOf(from) + (before ? 0 : 1), target);
			} else {
				const sub = new WorkspaceSplit(this, direction);
				split.replaceChild(from, sub);
				sub.insertChild(0, before ? target : from);
				sub.insertChild(1, before ? from : target);
				from.weight = 1;
				target.weight = 1;
			}
		}
		from.removeChild(leaf);
		target.insertChild(target.children.length, leaf);
		this.tidyEmpty(from);
		this.setActiveLeaf(leaf, { focus: true });
		this.onResized();
		this.trigger('layout-change');
		this.requestSaveLayout();
		return true;
	}

	/** Make the active pane wider or narrower, taller or shorter, by `amount` of its split. */
	resizeActivePane(axis: 'width' | 'height', amount: number): boolean {
		const leaf = this.activeRootLeaf();
		if (!leaf?.parent) return false;
		const { tree, panes, splitAt } = this.layoutTree();
		const id = [...panes].find(([, t]) => t === leaf.parent)?.[0];
		const r = id ? resizePane(tree, id, axis, amount) : null;
		if (!r) return false;
		const split = splitAt(r.path);
		split.children.forEach((c, i) => { c.weight = r.weights[i]!; });
		split.render();
		this.onResized();
		return true;
	}

	/** Every pane the same size within its split. */
	equalisePanes(): void {
		const visit = (s: WorkspaceSplit) => {
			for (const c of s.children) { c.weight = 1; if (c instanceof WorkspaceSplit) visit(c); }
			s.render();
		};
		visit(this.rootSplit);
		this.onResized();
	}

	/** Whether the active pane fills the main area (zoom). */
	get zoomed(): boolean { return this.rootSplit.containerEl.hasClass('is-zoomed'); }

	/** Show only the active pane, or everything again. */
	toggleZoom(): boolean {
		const root = this.rootSplit.containerEl;
		for (const el of Array.from(root.querySelectorAll('.is-zoom-keep'))) el.removeClass('is-zoom-keep');
		if (this.zoomed) { root.removeClass('is-zoomed'); this.onResized(); return false; }
		const leaf = this.activeRootLeaf();
		if (!leaf?.parent) return false;
		for (let x: WorkspaceItem | null = leaf.parent; x && x !== this.rootSplit; x = x.parent) x.containerEl.addClass('is-zoom-keep');
		root.addClass('is-zoomed');
		this.onResized();
		return true;
	}

	/** Open the most recently closed note again, as a tab in the active pane. */
	async reopenClosed(): Promise<WorkspaceLeaf | null> {
		while (this.closedTabs.length) {
			const st = this.closedTabs.pop()!;
			const file = typeof st.state?.file === 'string' ? st.state.file : null;
			if (file && !this.app.vault.getAbstractFileByPath(file)) continue;
			const leaf = this.getLeaf('tab');
			await leaf.setViewState({ ...st, active: true });
			this.setActiveLeaf(leaf, { focus: true });
			return leaf;
		}
		return null;
	}

	/** Every main-area tab moved into one pane (the active one's). */
	mergeAllPanes(): void {
		const keep = this.activeRootLeaf()?.parent ?? this.rootTabs()[0];
		if (!keep) return;
		for (const tabs of this.rootTabs()) {
			if (tabs === keep) continue;
			for (const leaf of [...tabs.children]) { tabs.removeChild(leaf); keep.insertChild(keep.children.length, leaf); }
			this.tidyEmpty(tabs);
		}
		if (this.zoomed) this.toggleZoom();
		this.onResized();
		this.trigger('layout-change');
		this.requestSaveLayout();
	}

	// ---------------------------------------------------------------------------------------------
	// Dragging tabs

	private dragLeaf: WorkspaceLeaf | null = null;
	private dropTarget: { kind: 'tab'; tabs: WorkspaceTabs; index: number } | { kind: 'pane'; tabs: WorkspaceTabs; side: Direction | 'center' } | { kind: 'window'; side: Direction } | null = null;
	private overlayEl: HTMLElement | null = null;
	private markerEl: HTMLElement | null = null;
	private dragWired = false;

	startTabDrag(leaf: WorkspaceLeaf): void {
		this.dragLeaf = leaf;
		document.body.addClass('is-dragging-tab');
		if (this.dragWired) return;
		this.dragWired = true;
		// Capture phase: the editor must not take the drop as text.
		this.containerEl.addEventListener('dragover', (e) => this.onTabDragOver(e), true);
		this.containerEl.addEventListener('drop', (e) => this.onTabDrop(e), true);
		this.containerEl.addEventListener('dragleave', (e) => { if (!this.containerEl.contains(e.relatedTarget as Node | null)) this.showDrop(null); }, true);
	}

	endTabDrag(): void {
		this.dragLeaf = null;
		this.showDrop(null);
		document.body.removeClass('is-dragging-tab');
	}

	/** Where a dragged tab would go, for the pointer at (x, y). */
	private dropAt(x: number, y: number, target: Element | null): typeof this.dropTarget {
		const root = this.rootSplit.containerEl.getBoundingClientRect();
		const edge = 24;
		if (x - root.left < edge) return { kind: 'window', side: 'left' };
		if (root.right - x < edge) return { kind: 'window', side: 'right' };
		if (y - root.top < edge) return { kind: 'window', side: 'up' };
		if (root.bottom - y < edge) return { kind: 'window', side: 'down' };
		const tabsEl = target?.closest('.workspace-tabs');
		const tabs = this.rootTabs().find((t) => t.containerEl === tabsEl);
		if (!tabs) return null;
		if (target?.closest('.workspace-tab-header-container')) {
			// Between tabs: before the first tab whose middle is right of the pointer.
			const index = tabs.children.findIndex((l) => { const r = l.tabHeaderEl.getBoundingClientRect(); return x < r.left + r.width / 2; });
			return { kind: 'tab', tabs, index: index < 0 ? tabs.children.length : index };
		}
		const r = tabs.contentEl.getBoundingClientRect();
		const fx = (x - r.left) / r.width;
		const fy = (y - r.top) / r.height;
		const side: Direction | 'center' = fx < 0.25 ? 'left' : fx > 0.75 ? 'right' : fy < 0.25 ? 'up' : fy > 0.75 ? 'down' : 'center';
		return { kind: 'pane', tabs, side };
	}

	private onTabDragOver(e: DragEvent): void {
		if (!this.dragLeaf) return;
		e.preventDefault();
		e.stopPropagation();
		if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
		this.showDrop(this.dropAt(e.clientX, e.clientY, e.target as Element | null));
	}

	/** Show where the tab would land: a marker between tabs, or the area it would fill. */
	private showDrop(t: typeof this.dropTarget): void {
		this.dropTarget = t;
		this.overlayEl?.remove();
		this.markerEl?.remove();
		this.overlayEl = null;
		this.markerEl = null;
		if (!t) return;
		const host = this.containerEl.getBoundingClientRect();
		const place = (el: HTMLElement, r: { left: number; top: number; width: number; height: number }) => {
			el.setCssStyles({ left: `${r.left - host.left}px`, top: `${r.top - host.top}px`, width: `${r.width}px`, height: `${r.height}px` });
			this.containerEl.appendChild(el);
		};
		if (t.kind === 'tab') {
			const headers = t.tabs.children.map((l) => l.tabHeaderEl.getBoundingClientRect());
			const bar = t.tabs.headerEl.getBoundingClientRect();
			const x = t.index < headers.length ? headers[t.index]!.left : headers.length ? headers[headers.length - 1]!.right : bar.left;
			this.markerEl = createDiv({ cls: 'workspace-tab-drop-marker' });
			place(this.markerEl, { left: x - 1, top: bar.top, width: 2, height: bar.height });
			return;
		}
		const box = t.kind === 'window' ? this.rootSplit.containerEl.getBoundingClientRect() : t.tabs.containerEl.getBoundingClientRect();
		const half = (side: Direction | 'center') => {
			switch (side) {
				case 'left': return { left: box.left, top: box.top, width: box.width / 2, height: box.height };
				case 'right': return { left: box.left + box.width / 2, top: box.top, width: box.width / 2, height: box.height };
				case 'up': return { left: box.left, top: box.top, width: box.width, height: box.height / 2 };
				case 'down': return { left: box.left, top: box.top + box.height / 2, width: box.width, height: box.height / 2 };
				default: return { left: box.left, top: box.top, width: box.width, height: box.height };
			}
		};
		this.overlayEl = createDiv({ cls: `workspace-drop-overlay${t.kind === 'window' ? ' mod-window' : ''}` });
		place(this.overlayEl, half(t.side));
	}

	private onTabDrop(e: DragEvent): void {
		const leaf = this.dragLeaf;
		if (!leaf) return;
		e.preventDefault();
		e.stopPropagation();
		const t = this.dropAt(e.clientX, e.clientY, e.target as Element | null);
		this.endTabDrag();
		if (t) this.dropTab(leaf, t);
	}

	/** Put a tab where it was dropped (also used by tests). */
	dropTab(leaf: WorkspaceLeaf, t: NonNullable<typeof this.dropTarget>): boolean {
		const from = leaf.parent;
		if (!from) return false;
		if (t.kind === 'tab' || (t.kind === 'pane' && t.side === 'center')) {
			const to = t.tabs;
			let index = t.kind === 'tab' ? t.index : to.children.length;
			if (to === from) {
				const at = from.children.indexOf(leaf);
				if (index > at) index--;
				if (index === at) return false;
			}
			from.removeChild(leaf);
			to.insertChild(Math.min(index, to.children.length), leaf);
			if (to !== from) this.tidyEmpty(from);
		} else {
			// A new pane beside a pane, or along a whole side of the window.
			if (t.kind === 'pane' && t.tabs === from && from.children.length === 1) return false;
			const fresh = new WorkspaceTabs(this);
			const direction: SplitDirection = t.side === 'left' || t.side === 'right' ? 'vertical' : 'horizontal';
			const before = t.side === 'left' || t.side === 'up';
			if (t.kind === 'window') {
				const root = this.rootSplit;
				if (root.direction !== direction) {
					// Wrap what is there, so the new pane spans the whole side.
					const inner = new WorkspaceSplit(this, root.direction);
					for (const c of [...root.children]) { root.removeChild(c); inner.insertChild(inner.children.length, c); }
					root.setDirection(direction);
					root.insertChild(0, inner);
				}
				root.insertChild(before ? 0 : root.children.length, fresh);
			} else {
				const target = t.tabs;
				const split = target.parent!;
				if (split.direction === direction) {
					// The new pane takes half the target's room, as splitting does.
					fresh.weight = target.weight / 2;
					target.weight /= 2;
					split.insertChild(split.children.indexOf(target) + (before ? 0 : 1), fresh);
				} else {
					const sub = new WorkspaceSplit(this, direction);
					split.replaceChild(target, sub);
					sub.insertChild(0, before ? fresh : target);
					sub.insertChild(1, before ? target : fresh);
					target.weight = 1;
				}
			}
			from.removeChild(leaf);
			fresh.insertChild(0, leaf);
			this.tidyEmpty(from);
		}
		this.setActiveLeaf(leaf, { focus: true });
		this.onResized();
		this.trigger('layout-change');
		this.requestSaveLayout();
		return true;
	}

	/** The main area's layout, to save under a name. */
	getMainLayout(): unknown { return this.serialize(this.rootSplit); }

	/** Replace the main area with a saved layout (open notes that no longer exist are skipped). */
	async setMainLayout(main: unknown): Promise<void> {
		for (const tabs of this.rootTabs()) for (const leaf of [...tabs.children]) { await leaf.view.onClose(); leaf.view.unload(); tabs.removeChild(leaf); }
		for (const c of [...this.rootSplit.children]) this.rootSplit.removeChild(c);
		this.activeLeaf = null;
		await this.loadLayout({ main });
		this.trigger('layout-change');
		this.requestSaveLayout();
	}

	iterateLeaves(root: WorkspaceItem, cb: (leaf: WorkspaceLeaf) => unknown): void {
		const visit = (x: WorkspaceItem) => {
			if (x instanceof WorkspaceTabs) for (const l of x.children) cb(l);
			else if (x instanceof WorkspaceSplit) x.children.forEach(visit);
		};
		visit(root);
	}

	iterateRootLeaves(cb: (leaf: WorkspaceLeaf) => unknown): void { this.iterateLeaves(this.rootSplit, cb); }

	iterateAllLeaves(cb: (leaf: WorkspaceLeaf) => unknown): void {
		this.iterateLeaves(this.rootSplit, cb);
	}

	getLeavesOfType(type: string): WorkspaceLeaf[] {
		const out: WorkspaceLeaf[] = [];
		this.iterateAllLeaves((l) => { if (l.view.getViewType() === type) out.push(l); });
		return out;
	}

	detachLeavesOfType(type: string): void {
		for (const l of this.getLeavesOfType(type)) l.detach();
	}

	async revealLeaf(leaf: WorkspaceLeaf): Promise<void> {
		leaf.parent?.selectTab(leaf);
		this.setActiveLeaf(leaf, { focus: true });
	}

	setActiveLeaf(leaf: WorkspaceLeaf, params: { focus?: boolean } | boolean = {}): void {
		const focus = typeof params === 'boolean' ? params : params.focus ?? false;
		leaf.parent?.selectTab(leaf);
		if (this.activeLeaf !== leaf) {
			this.activeLeaf?.containerEl.removeClass('mod-active');
			this.activeLeaf?.parent?.containerEl.removeClass('mod-active');
			this.activeLeaf = leaf;
			leaf.activeTime = Date.now();
			leaf.containerEl.addClass('mod-active');
			leaf.parent?.containerEl.addClass('mod-active');
			if (leaf.view instanceof FileView && leaf.view.file) this.lastFileLeaf = leaf;
			// Let editor extensions see that their editor is now the active one (as a focus change would).
			if (leaf.view instanceof MarkdownView) leaf.view.editor.cm.dispatch({ selection: leaf.view.editor.cm.state.selection });
			this.trigger('active-leaf-change', leaf);
			if (leaf.view instanceof FileView) this.trigger('file-open', leaf.view.file);
			this.requestSaveLayout();
		}
		if (focus) leaf.view.focus();
	}

	/** Called by FileView when a file is loaded into a leaf. */
	onFileLoaded(leaf: WorkspaceLeaf, file: TFile): void {
		if (leaf === this.activeLeaf) {
			this.lastFileLeaf = leaf;
			this.trigger('file-open', file);
		}
		this.requestSaveLayout();
	}

	getActiveViewOfType<T extends View>(type: abstract new (...args: any[]) => T): T | null {
		const v = this.activeLeaf?.view;
		return v instanceof type ? v : null;
	}

	getActiveFile(): TFile | null {
		const v = this.activeLeaf?.view;
		if (v instanceof FileView && v.file) return v.file;
		const last = this.lastFileLeaf?.view;
		return last instanceof FileView ? last.file : null;
	}

	get activeEditor(): { editor: Editor; file: TFile | null } | null {
		const v = this.getActiveViewOfType(MarkdownView);
		return v ? { editor: v.editor, file: v.file } : null;
	}

	/** The editor of an open note (preferring the active one). */
	editorForFile(file: TFile): Editor | null {
		const active = this.getActiveViewOfType(MarkdownView);
		if (active?.file === file) return active.editor;
		let found: Editor | null = null;
		this.iterateAllLeaves((l) => { if (!found && l.view instanceof MarkdownView && l.view.file === file) found = l.view.editor; });
		return found;
	}

	/** Save every open editor of `file` now. */
	async saveFile(file: TFile): Promise<void> {
		const views: MarkdownView[] = [];
		this.iterateAllLeaves((l) => { if (l.view instanceof MarkdownView && l.view.file === file) views.push(l.view); });
		for (const v of views) await v.save();
	}

	async saveAll(): Promise<void> {
		const views: MarkdownView[] = [];
		this.iterateAllLeaves((l) => { if (l.view instanceof MarkdownView) views.push(l.view); });
		for (const v of views) await v.save();
	}

	/** Open a [[link]] from the note at `sourcePath`, creating the note if it does not exist. */
	async openLinkText(linktext: string, sourcePath: string, newLeaf?: boolean | PaneType, openViewState?: OpenViewState): Promise<void> {
		const { path, subpath } = parseLinktext(linktext);
		let file = this.app.metadataCache.getFirstLinkpathDest(path, sourcePath);
		if (opensBeside(path)) {
			if (file) await this.openBeside(file, subpath, newLeaf);
			else new Notice(`“${path}” is not in this homebase.`);
			return;
		}
		if (!file) {
			const folder = this.app.fileManager.getNewFileParent(sourcePath);
			const name = path.endsWith('.md') ? path : `${path}.md`;
			file = await this.app.vault.create(folder.isRoot() || name.includes('/') ? name : `${folder.path}/${name}`, '');
		}
		const leaf = this.getLeaf(newLeaf);
		await leaf.openFile(file, openViewState);
		if (subpath && leaf.view instanceof MarkdownView) leaf.view.scrollToSubpath(subpath);
	}

	/**
	 * Open a source (a recording or a PDF) from a link, beside the note so the note stays in view. A tab
	 * already showing it is reused, and the link's subpath (`#t=12:34`, `#page=12`) is passed to it. For a
	 * recording, a timestamp first seeks a player already on screen, embedded in a note or in a tab.
	 */
	async openBeside(file: TFile, subpath = '', newLeaf?: boolean | PaneType): Promise<void> {
		const t = mediaKind(file.name) ? timeFromSubpath(subpath) : null;
		if (t !== null && !newLeaf) {
			const el = this.app.media.seek(file, t);
			if (el) {
				// In a background tab: bring the tab forward, but leave the keyboard in the note.
				this.iterateAllLeaves((l) => { if (l.containerEl.contains(el)) l.parent?.selectTab(l); });
				return;
			}
		}
		let open: WorkspaceLeaf | null = null;
		if (!newLeaf) this.iterateAllLeaves((l) => { if (!open && l.view instanceof FileView && l.view.file === file && l.view.getViewType() !== 'markdown') open = l; });
		const leaf: WorkspaceLeaf = open ?? this.getLeaf(newLeaf || (this.activeLeaf?.view instanceof MarkdownView ? 'split' : false));
		if (open) {
			if (subpath) leaf.view.setEphemeralState({ subpath });
		} else {
			await leaf.openFile(file, subpath ? { eState: { subpath } } : {});
		}
		leaf.parent?.selectTab(leaf);
	}

	onLayoutReady(cb: () => unknown): void {
		if (this.layoutReady) cb();
		else this.readyCallbacks.push(cb);
	}

	/** Mark the layout ready and run callbacks. */
	setLayoutReady(): void {
		this.layoutReady = true;
		for (const cb of this.readyCallbacks.splice(0)) {
			try { cb(); } catch (e) { console.error('onLayoutReady callback failed', e); }
		}
		this.trigger('layout-ready');
	}

	/** Reconfigure editors after plugins add or remove extensions. */
	updateOptions(): void {
		this.iterateAllLeaves((l) => { if (l.view instanceof MarkdownView) l.view.reconfigure(); });
	}

	// ---------------------------------------------------------------------------------------------
	// Layout persistence

	private serialize(x: WorkspaceItem): unknown {
		if (x instanceof WorkspaceTabs) {
			return { type: 'tabs', weight: x.weight, current: x.currentTab, ...(x.stacked ? { stacked: true } : {}), children: x.children.map((l) => ({ ...l.getViewState(), active: l === this.activeLeaf })) };
		}
		const s = x as WorkspaceSplit;
		return { type: 'split', direction: s.direction, weight: s.weight, children: s.children.map((c) => this.serialize(c)) };
	}

	getLayout(): Record<string, unknown> {
		return {
			main: this.serialize(this.rootSplit),
		};
	}

	private async saveLayout(): Promise<void> {
		if (!this.layoutReady) return;
		try {
			await this.app.vault.adapter.write(`${this.app.vault.configDir}/workspace.json`, JSON.stringify(this.getLayout(), null, '\t'));
		} catch (e) {
			console.error('Could not save the workspace layout', e);
		}
	}

	/** Restore the saved layout; views of types no longer registered are skipped. */
	async loadLayout(layout: any): Promise<void> {
		let active: WorkspaceLeaf | null = null;
		const fillTabs = async (tabs: WorkspaceTabs, data: any) => {
			for (const st of (data?.children ?? []) as (ViewState & { active?: boolean })[]) {
				if (!this.viewCreators.has(st.type) || st.type === 'empty') continue;
				const file = typeof st.state?.file === 'string' ? st.state.file : null;
				if (file !== null && !this.app.vault.getAbstractFileByPath(file)) continue;
				// Locked notes stay closed at start (Quire starts locked; no passphrase prompt on launch).
				const f = file !== null ? this.app.vault.getFileByPath(file) : null;
				if (f && this.app.isLocked(f)) continue;
				const leaf = this.createLeafInTabs(tabs, tabs.children.length);
				try {
					await leaf.setViewState({ type: st.type, state: st.state, pinned: st.pinned });
				} catch (e) {
					console.error('Could not restore a pane', e);
				}
				if (st.active) active = leaf;
			}
			const cur = tabs.children[Math.min(Number(data?.current ?? 0), tabs.children.length - 1)];
			if (cur) tabs.selectTab(cur);
		};
		const build = async (data: any): Promise<WorkspaceSplit | WorkspaceTabs | null> => {
			if (data?.type === 'tabs') {
				const tabs = new WorkspaceTabs(this);
				tabs.weight = Number(data.weight) || 1;
				await fillTabs(tabs, data);
				if (data.stacked === true) tabs.setStacked(true);
				return tabs.children.length ? tabs : null;
			}
			if (data?.type === 'split') {
				const s = new WorkspaceSplit(this, data.direction === 'horizontal' ? 'horizontal' : 'vertical');
				s.weight = Number(data.weight) || 1;
				for (const c of data.children ?? []) {
					const child = await build(c);
					if (child) s.insertChild(s.children.length, child);
				}
				if (s.children.length === 0) return null;
				if (s.children.length === 1) { const only = s.children[0]!; only.weight = s.weight; return only; }
				return s;
			}
			return null;
		};
		if (layout?.main?.type === 'split') {
			// The main area can be a column too (after a tab was dropped at the top or bottom edge).
			this.rootSplit.setDirection(layout.main.direction === 'horizontal' ? 'horizontal' : 'vertical');
			for (const c of layout.main.children ?? []) {
				const child = await build(c);
				if (child) this.rootSplit.insertChild(this.rootSplit.children.length, child);
			}
		}
		if (this.rootTabs().length === 0) {
			const tabs = new WorkspaceTabs(this);
			this.rootSplit.insertChild(0, tabs);
			this.createLeafInTabs(tabs);
		}
		const first = active ?? this.getMostRecentLeaf() ?? this.rootTabs()[0]?.activeLeaf ?? null;
		if (first) this.setActiveLeaf(first, { focus: true });
		else { const l = this.rootTabs()[0]?.activeLeaf; if (l) this.setActiveLeaf(l, { focus: true }); }
	}

	override on(name: 'active-leaf-change', callback: (leaf: WorkspaceLeaf | null) => unknown, ctx?: unknown): EventRef;
	override on(name: 'file-open', callback: (file: TFile | null) => unknown, ctx?: unknown): EventRef;
	override on(name: 'editor-change', callback: (editor: Editor, info: MarkdownView) => unknown, ctx?: unknown): EventRef;
	/** Vim's mode in an editor changed (null: vim is off). */
	override on(name: 'vim-mode-change', callback: (mode: string | null, info: MarkdownView) => unknown, ctx?: unknown): EventRef;
	/** After each edit or cursor move in an editor. */
	override on(name: 'editor-cursor', callback: (editor: Editor, info: MarkdownView) => unknown, ctx?: unknown): EventRef;
	override on(name: 'file-menu', callback: (menu: Menu, file: TAbstractFile, source: string, leaf?: WorkspaceLeaf) => unknown, ctx?: unknown): EventRef;
	override on(name: 'editor-menu', callback: (menu: Menu, editor: Editor, info: MarkdownView) => unknown, ctx?: unknown): EventRef;
	override on(name: 'layout-change' | 'resize' | 'css-change' | 'quit' | 'layout-ready', callback: () => unknown, ctx?: unknown): EventRef;
	override on(name: string, callback: (...data: any[]) => unknown, ctx?: unknown): EventRef;
	override on(name: string, callback: (...data: any[]) => unknown, ctx?: unknown): EventRef {
		return super.on(name, callback, ctx);
	}
}

export type { Parent };
