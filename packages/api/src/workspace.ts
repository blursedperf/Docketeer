import type { App } from './app';
import { Events, type EventRef } from './events';
import { TFile, type TAbstractFile } from './files';
import { setIcon } from './icons';
import type { Editor } from './editor';
import { MarkdownView } from './markdown-view';
import { parseLinktext } from './metadata';
import { Menu } from './ui';
import { debounce } from './util';
import { EmptyView, FileInfoView, FileView, ItemView, View } from './view';

export type ViewCreator = (leaf: WorkspaceLeaf) => View;
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
		this.children.forEach((child, i) => {
			if (i > 0) {
				const handle = this.containerEl.createDiv({ cls: 'workspace-leaf-resize-handle' });
				const before = this.children[i - 1]!;
				handle.addEventListener('mousedown', (e) => this.startResize(e, before, child));
			}
			child.containerEl.setCssStyles({ flexGrow: String(child.weight), flexBasis: '0' });
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
			a.containerEl.style.flexGrow = String(a.weight);
			b.containerEl.style.flexGrow = String(b.weight);
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

/** A sidebar: collapsible, holds one tab group. */
export class WorkspaceSidedock extends WorkspaceSplit {
	collapsed = false;
	size = 280;
	tabs: WorkspaceTabs;
	constructor(workspace: Workspace, public side: 'left' | 'right') {
		super(workspace, 'horizontal', `mod-sidedock mod-${side}-split`);
		this.tabs = new WorkspaceTabs(workspace, true);
		this.insertChild(0, this.tabs);
		this.applySize();
	}
	applySize(): void {
		this.containerEl.setCssStyles({ width: this.collapsed ? '0px' : `${this.size}px` });
		this.containerEl.toggleClass('is-collapsed', this.collapsed);
	}
	collapse(): void { this.collapsed = true; this.applySize(); this.workspace.onResized(); }
	expand(): void { this.collapsed = false; this.applySize(); this.workspace.onResized(); }
	toggle(): void { if (this.collapsed) this.expand(); else this.collapse(); }
}

/** A group of tabs; one leaf shows at a time. */
export class WorkspaceTabs extends WorkspaceItem {
	children: WorkspaceLeaf[] = [];
	currentTab = 0;
	headerEl: HTMLElement;
	tabsEl: HTMLElement;
	contentEl: HTMLElement;
	override parent: WorkspaceSplit | null = null;

	constructor(workspace: Workspace, public sidebar = false) {
		super(workspace, `workspace-tabs${sidebar ? ' mod-sidebar' : ''}`);
		this.headerEl = this.containerEl.createDiv({ cls: 'workspace-tab-header-container' });
		this.tabsEl = this.headerEl.createDiv({ cls: 'workspace-tab-header-container-inner' });
		if (!sidebar) {
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
		this.contentEl.appendChild(leaf.containerEl);
		this.selectTab(leaf);
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
		this.children.forEach((l, i) => {
			const on = i === this.currentTab;
			l.containerEl.toggle(on);
			l.tabHeaderEl.toggleClass('is-active', on);
		});
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
	/** When it was last active, for getMostRecentLeaf. */
	activeTime = 0;
	private working: Promise<void> = Promise.resolve();

	constructor(public workspace: Workspace) {
		super();
		this.app = workspace.app;
		this.containerEl = createDiv({ cls: 'workspace-leaf' });
		this.tabHeaderEl = createDiv({ cls: 'workspace-tab-header', attr: { draggable: 'false' } });
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
			menu.addItem((i) => i.setTitle('Close').setIcon('x').onClick(() => this.detach()));
			menu.addItem((i) => i.setTitle('Split right').setIcon('separator-vertical').onClick(() => { void this.workspace.duplicateLeaf(this, 'vertical'); }));
			menu.addItem((i) => i.setTitle('Split down').setIcon('separator-horizontal').onClick(() => { void this.workspace.duplicateLeaf(this, 'horizontal'); }));
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

	isSidebar(): boolean { return !!this.parent?.sidebar; }

	getRoot(): WorkspaceItem | null { return this.parent?.getRoot() ?? null; }

	getViewState(): ViewState {
		return { type: this.view.getViewType(), state: this.view.getState(), pinned: this.pinned };
	}

	/** Show a view of `state.type` with `state.state`. Calls are queued, so they never overlap. */
	setViewState(state: ViewState, eState?: Record<string, unknown>): Promise<void> {
		const run = async () => {
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
		const type = this.workspace.viewTypeForFile(file);
		if (this.view instanceof FileView && this.view.getViewType() === type) {
			await this.setViewState({ type, state: { ...this.view.getState(), ...(openState.state ?? {}), file: file.path } }, openState.eState);
		} else {
			await this.setViewState({ type, state: { ...(openState.state ?? {}), file: file.path } }, openState.eState);
		}
		if (openState.active !== false && !this.isSidebar()) this.workspace.setActiveLeaf(this, { focus: true });
	}

	getDisplayText(): string { return this.view.getDisplayText(); }
	getIcon(): string { return this.view.getIcon(); }

	updateHeader(): void {
		setIcon(this.tabIconEl, this.view.getIcon());
		this.tabTitleEl.setText(this.view.getDisplayText());
		this.tabHeaderEl.setAttribute('aria-label', this.view.getDisplayText());
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
 * The app's panes: a root area of tab groups and splits, and left and right sidebars.
 */
export class Workspace extends Events {
	containerEl: HTMLElement;
	rootSplit: WorkspaceSplit;
	leftSplit: WorkspaceSidedock;
	rightSplit: WorkspaceSidedock;
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
		const ribbonEl = containerEl.createDiv({ cls: 'workspace-ribbon side-dock-ribbon mod-left' });
		const ribbonTop = ribbonEl.createDiv({ cls: 'side-dock-actions' });
		// App actions first, then plugins' actions as their own group.
		const coreGroup = ribbonTop.createDiv({ cls: 'side-dock-group mod-core' });
		const pluginGroup = ribbonTop.createDiv({ cls: 'side-dock-group mod-plugins' });
		const ribbonBottom = ribbonEl.createDiv({ cls: 'side-dock-settings' });
		this.leftRibbon = {
			containerEl: ribbonEl,
			addRibbonItemButton: (id, icon, title, cb) => {
				const group = id.startsWith('app:') ? coreGroup : pluginGroup;
				const b = group.createDiv({ cls: 'side-dock-ribbon-action clickable-icon', attr: { 'aria-label': title, title, 'data-id': id } });
				setIcon(b, icon);
				b.addEventListener('click', cb);
				return b;
			},
		};
		const bottomButton = (icon: string, title: string, command: string) => {
			const b = ribbonBottom.createDiv({ cls: 'side-dock-ribbon-action clickable-icon', attr: { 'aria-label': title, title } });
			setIcon(b, icon);
			b.addEventListener('click', () => this.app.commands.executeCommandById(command));
		};
		bottomButton('folder-open', 'Open another homebase', 'app:open-homebase');
		bottomButton('settings', 'Settings', 'app:open-settings');

		this.leftSplit = new WorkspaceSidedock(this, 'left');
		this.rootSplit = new WorkspaceSplit(this, 'vertical', 'mod-root');
		this.rightSplit = new WorkspaceSidedock(this, 'right');
		const leftHandle = createDiv({ cls: 'workspace-sidedock-resize-handle mod-left' });
		const rightHandle = createDiv({ cls: 'workspace-sidedock-resize-handle mod-right' });
		containerEl.append(this.leftSplit.containerEl, leftHandle, this.rootSplit.containerEl, rightHandle, this.rightSplit.containerEl);
		this.sideResize(leftHandle, this.leftSplit, 1);
		this.sideResize(rightHandle, this.rightSplit, -1);

		this.registerViewType('empty', (leaf) => new EmptyView(leaf));
		this.registerViewType('markdown', (leaf) => new MarkdownView(leaf), ['md', 'markdown', 'txt']);
		this.registerViewType('file-info', (leaf) => new FileInfoView(leaf));
		window.addEventListener('resize', () => this.onResized());

		app.vault.on('rename', (file: TAbstractFile) => {
			this.iterateAllLeaves((leaf) => { if (leaf.view instanceof FileView && leaf.view.file === file) leaf.view.onRename(file as TFile); });
			this.requestSaveLayout();
		});
		app.vault.on('delete', (file: TAbstractFile) => {
			this.iterateAllLeaves((leaf) => { if (leaf.view instanceof FileView && leaf.view.file === file) leaf.detach(); });
		});
	}

	private sideResize(handle: HTMLElement, dock: WorkspaceSidedock, sign: 1 | -1) {
		handle.addEventListener('mousedown', (e) => {
			e.preventDefault();
			const start = e.clientX;
			const size = dock.size;
			document.body.addClass('is-resizing');
			const move = (ev: MouseEvent) => {
				dock.size = Math.max(160, Math.min(720, size + sign * (ev.clientX - start)));
				dock.collapsed = false;
				dock.applySize();
				this.trigger('resize');
			};
			const up = () => {
				document.body.removeClass('is-resizing');
				window.removeEventListener('mousemove', move);
				window.removeEventListener('mouseup', up);
				this.onResized();
			};
			window.addEventListener('mousemove', move);
			window.addEventListener('mouseup', up);
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

	private rootTabs(): WorkspaceTabs[] {
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
		if (!tabs || tabs.sidebar) return this.getLeaf('tab');
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

	getRightLeaf(_split = false): WorkspaceLeaf {
		const leaf = this.createLeafInTabs(this.rightSplit.tabs, this.rightSplit.tabs.children.length);
		return leaf;
	}

	getLeftLeaf(_split = false): WorkspaceLeaf {
		return this.createLeafInTabs(this.leftSplit.tabs, this.leftSplit.tabs.children.length);
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
		tabs.removeChild(leaf);
		if (this.activeLeaf === leaf) this.activeLeaf = null;
		if (this.lastFileLeaf === leaf) this.lastFileLeaf = null;
		if (tabs.children.length === 0 && !tabs.sidebar) {
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
		if (!this.activeLeaf) {
			const next = this.getMostRecentLeaf() ?? this.rootTabs()[0]?.activeLeaf ?? null;
			if (next) this.setActiveLeaf(next, { focus: true });
			else this.trigger('active-leaf-change', null);
		}
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
		this.iterateLeaves(this.leftSplit, cb);
		this.iterateLeaves(this.rightSplit, cb);
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
		const root = leaf.getRoot();
		if (root === this.leftSplit && this.leftSplit.collapsed) this.leftSplit.expand();
		if (root === this.rightSplit && this.rightSplit.collapsed) this.rightSplit.expand();
		leaf.onResize();
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
			if (leaf.view instanceof FileView && leaf.view.file && !leaf.isSidebar()) this.lastFileLeaf = leaf;
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
		if (!file) {
			const folder = this.app.fileManager.getNewFileParent(sourcePath);
			const name = path.endsWith('.md') ? path : `${path}.md`;
			file = await this.app.vault.create(folder.isRoot() || name.includes('/') ? name : `${folder.path}/${name}`, '');
		}
		const leaf = this.getLeaf(newLeaf);
		await leaf.openFile(file, openViewState);
		if (subpath && leaf.view instanceof MarkdownView) leaf.view.scrollToSubpath(subpath);
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
			return { type: 'tabs', weight: x.weight, current: x.currentTab, children: x.children.map((l) => ({ ...l.getViewState(), active: l === this.activeLeaf })) };
		}
		const s = x as WorkspaceSplit;
		return { type: 'split', direction: s.direction, weight: s.weight, children: s.children.map((c) => this.serialize(c)) };
	}

	getLayout(): Record<string, unknown> {
		return {
			main: this.serialize(this.rootSplit),
			left: { collapsed: this.leftSplit.collapsed, size: this.leftSplit.size, tabs: this.serialize(this.leftSplit.tabs) },
			right: { collapsed: this.rightSplit.collapsed, size: this.rightSplit.size, tabs: this.serialize(this.rightSplit.tabs) },
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
			for (const c of layout.main.children ?? []) {
				const child = await build(c);
				if (child) this.rootSplit.insertChild(this.rootSplit.children.length, child);
			}
		}
		for (const [dock, data] of [[this.leftSplit, layout?.left], [this.rightSplit, layout?.right]] as const) {
			if (!data) continue;
			dock.size = Number(data.size) || dock.size;
			dock.collapsed = !!data.collapsed;
			dock.applySize();
			await fillTabs(dock.tabs, data.tabs);
		}
		if (this.rootTabs().length === 0) {
			const tabs = new WorkspaceTabs(this);
			this.rootSplit.insertChild(0, tabs);
			this.createLeafInTabs(tabs);
		}
		const first = active ?? this.getMostRecentLeaf() ?? this.rootTabs()[0]?.activeLeaf ?? null;
		if (first && !first.isSidebar()) this.setActiveLeaf(first, { focus: true });
		else { const l = this.rootTabs()[0]?.activeLeaf; if (l) this.setActiveLeaf(l, { focus: true }); }
	}

	override on(name: 'active-leaf-change', callback: (leaf: WorkspaceLeaf | null) => unknown, ctx?: unknown): EventRef;
	override on(name: 'file-open', callback: (file: TFile | null) => unknown, ctx?: unknown): EventRef;
	override on(name: 'editor-change', callback: (editor: Editor, info: MarkdownView) => unknown, ctx?: unknown): EventRef;
	override on(name: 'file-menu', callback: (menu: Menu, file: TAbstractFile, source: string, leaf?: WorkspaceLeaf) => unknown, ctx?: unknown): EventRef;
	override on(name: 'editor-menu', callback: (menu: Menu, editor: Editor, info: MarkdownView) => unknown, ctx?: unknown): EventRef;
	override on(name: 'layout-change' | 'resize' | 'css-change' | 'quit' | 'layout-ready', callback: () => unknown, ctx?: unknown): EventRef;
	override on(name: string, callback: (...data: any[]) => unknown, ctx?: unknown): EventRef;
	override on(name: string, callback: (...data: any[]) => unknown, ctx?: unknown): EventRef {
		return super.on(name, callback, ctx);
	}
}

export type { Parent };
