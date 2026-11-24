import { type App, ItemView, Menu, Modal, Notice, Setting, TFile, TFolder, setIcon, type TAbstractFile, type WorkspaceLeaf, debounce } from '@quire/api';

export const FILE_EXPLORER = 'file-explorer';

/** Ask for a name. */
export class NameModal extends Modal {
	constructor(app: ConstructorParameters<typeof Modal>[0], title: string, private initial: string, private action: string, private onSubmit: (value: string) => void) {
		super(app);
		this.setTitle(title);
	}
	override onOpen(): void {
		let value = this.initial;
		const submit = () => { this.close(); this.onSubmit(value.trim()); };
		new Setting(this.contentEl).setName('Name').addText((t) => {
			t.setValue(this.initial).onChange((v) => { value = v; });
			t.inputEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
			window.setTimeout(() => {
				t.inputEl.focus();
				const dot = this.initial.lastIndexOf('.');
				t.inputEl.setSelectionRange(0, dot > 0 ? dot : this.initial.length);
			}, 0);
		});
		new Setting(this.contentEl)
			.addButton((b) => b.setButtonText('Cancel').onClick(() => this.close()))
			.addButton((b) => b.setButtonText(this.action).setCta().onClick(submit));
	}
	override onClose(): void { this.contentEl.empty(); }
}

export class ConfirmModal extends Modal {
	constructor(app: ConstructorParameters<typeof Modal>[0], title: string, private message: string, private action: string, private onConfirm: () => void) {
		super(app);
		this.setTitle(title);
	}
	override onOpen(): void {
		this.contentEl.createEl('p', { text: this.message });
		new Setting(this.contentEl)
			.addButton((b) => b.setButtonText('Cancel').onClick(() => this.close()))
			.addButton((b) => b.setButtonText(this.action).setWarning().onClick(() => { this.close(); this.onConfirm(); }));
	}
}

/** A free path for a new file or folder named `base` in `folder`. */
export function freePath(app: { vault: { getAbstractFileByPath(p: string): TAbstractFile | null } }, folder: TFolder, base: string, ext = ''): string {
	const prefix = folder.isRoot() ? '' : `${folder.path}/`;
	let n = 0;
	for (;;) {
		const p = `${prefix}${base}${n ? ` ${n}` : ''}${ext}`;
		if (!app.vault.getAbstractFileByPath(p)) return p;
		n++;
	}
}

/** The homebase's files and folders, in the left sidebar. */
export class FileExplorerView extends ItemView {
	private treeEl!: HTMLElement;
	private expanded = new Set<string>();
	private selectedPath: string | null = null;
	private readonly refresh = debounce(() => this.render(), 50, true);

	constructor(leaf: WorkspaceLeaf) {
		super(leaf);
		this.icon = 'folder-closed';
	}

	getViewType(): string { return FILE_EXPLORER; }
	getDisplayText(): string { return 'Files'; }

	override getState(): Record<string, unknown> { return { expanded: [...this.expanded] }; }
	override async setState(state: unknown): Promise<void> {
		const ex = (state as { expanded?: unknown } | null)?.expanded;
		if (Array.isArray(ex)) this.expanded = new Set(ex.filter((x): x is string => typeof x === 'string'));
		this.render();
	}

	override async onOpen(): Promise<void> {
		// In the view's header line, so it shares a band with the header lines of the other columns.
		// Each button runs a command (also in the Docket and the command palette).
		const root = () => ({ folder: this.app.vault.getRoot() });
		this.addAction('chevrons-down-up', 'Collapse all', () => this.app.commands.executeCommandById('app:collapse-folders'));
		this.addAction('folder-plus', 'New folder', () => this.app.commands.executeCommandById('app:new-folder', root()));
		this.addAction('square-pen', 'New note', () => this.app.commands.executeCommandById('app:new-note', root()));
		this.treeEl = this.contentEl.createDiv({ cls: 'nav-files-container' });
		this.treeEl.addEventListener('contextmenu', (e) => {
			if ((e.target as HTMLElement).closest('.tree-item-self')) return;
			this.showMenu(e, this.app.vault.getRoot());
		});
		const { vault, workspace } = this.app;
		for (const ev of ['create', 'delete', 'rename'] as const) this.registerEvent(vault.on(ev, () => this.refresh()));
		this.registerEvent(workspace.on('file-open', (f) => {
			this.selectedPath = f?.path ?? null;
			if (f) for (let p = f.parent; p && !p.isRoot(); p = p.parent) this.expanded.add(p.path);
			this.refresh();
		}));
		this.render();
	}

	private sorted(folder: TFolder): TAbstractFile[] {
		return [...folder.children].sort((a, b) => {
			const fa = a instanceof TFolder ? 0 : 1;
			const fb = b instanceof TFolder ? 0 : 1;
			return fa - fb || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
		});
	}

	render(): void {
		if (!this.treeEl) return;
		const scroll = this.treeEl.scrollTop;
		this.treeEl.empty();
		const root = this.app.vault.getRoot();
		const vaultTitle = this.treeEl.createDiv({ cls: 'nav-vault-title', text: this.app.vault.getName() });
		vaultTitle.addEventListener('contextmenu', (e) => this.showMenu(e, root));
		this.renderChildren(root, this.treeEl, 0);
		this.treeEl.scrollTop = scroll;
	}

	private renderChildren(folder: TFolder, parent: HTMLElement, depth: number) {
		for (const child of this.sorted(folder)) {
			const item = parent.createDiv({ cls: 'tree-item' });
			const self = item.createDiv({ cls: 'tree-item-self is-clickable', attr: { 'data-path': child.path, draggable: 'true' } });
			// [indent][chevron slot][name]: 16px per level, so names at one depth share a column.
			self.style.paddingLeft = `${4 + depth * 16}px`;
			if (child instanceof TFolder) {
				const open = this.expanded.has(child.path);
				self.addClass('nav-folder-title');
				const icon = self.createDiv({ cls: 'tree-item-icon collapse-icon' });
				setIcon(icon, open ? 'chevron-down' : 'chevron-right');
				self.createDiv({ cls: 'tree-item-inner', text: child.name });
				self.addEventListener('click', () => {
					if (open) this.expanded.delete(child.path); else this.expanded.add(child.path);
					this.render();
					this.app.workspace.requestSaveLayout();
				});
				if (open) {
					const children = item.createDiv({ cls: 'tree-item-children' });
					// The guide runs under this folder's chevron (centre of its 16px slot).
					children.style.setProperty('--guide-left', `${4 + depth * 16 + 7}px`);
					this.renderChildren(child, children, depth + 1);
				}
			} else if (child instanceof TFile) {
				self.addClass('nav-file-title');
				if (child.path === this.selectedPath) self.addClass('is-active');
				self.createDiv({ cls: 'tree-item-icon is-empty' });
				self.createDiv({ cls: 'tree-item-inner', text: child.extension === 'md' ? child.basename : child.name });
				if (child.extension !== 'md') self.createDiv({ cls: 'nav-file-tag', text: child.extension });
				self.addEventListener('click', (e) => {
					void this.app.workspace.getLeaf(e.ctrlKey || e.metaKey ? 'tab' : false).openFile(child);
				});
				self.addEventListener('auxclick', (e) => { if (e.button === 1) void this.app.workspace.getLeaf('tab').openFile(child); });
			}
			self.addEventListener('contextmenu', (e) => { e.stopPropagation(); this.showMenu(e, child); });
			self.addEventListener('dragstart', (e) => { e.dataTransfer?.setData('text/x-quire-path', child.path); });
			if (child instanceof TFolder) this.dropTarget(self, child);
		}
		if (folder.isRoot()) this.dropTarget(this.treeEl, folder);
	}

	private dropTarget(el: HTMLElement, folder: TFolder) {
		el.addEventListener('dragover', (e) => {
			if (!e.dataTransfer?.types.includes('text/x-quire-path')) return;
			e.preventDefault();
			e.stopPropagation();
			el.addClass('is-being-dragged-over');
		});
		el.addEventListener('dragleave', () => el.removeClass('is-being-dragged-over'));
		el.addEventListener('drop', (e) => {
			el.removeClass('is-being-dragged-over');
			const path = e.dataTransfer?.getData('text/x-quire-path');
			if (!path) return;
			e.preventDefault();
			e.stopPropagation();
			const f = this.app.vault.getAbstractFileByPath(path);
			if (!f || f === folder || f.parent === folder || (f instanceof TFolder && folder.path.startsWith(`${f.path}/`))) return;
			const to = folder.isRoot() ? f.name : `${folder.path}/${f.name}`;
			this.app.fileManager.renameFile(f, to).catch((err: unknown) => new Notice(`Could not move: ${err instanceof Error ? err.message : String(err)}`));
		});
	}

	/** Expand the folders down to `path` (after creating a folder). */
	expandTo(path: string): void {
		const parts = path.split('/');
		for (let i = 1; i <= parts.length; i++) this.expanded.add(parts.slice(0, i).join('/'));
		this.render();
	}

	collapseAll(): void {
		this.expanded.clear();
		this.render();
		this.app.workspace.requestSaveLayout();
	}

	/** The right-click menu: every item runs a command, for this file or folder. */
	showMenu(e: MouseEvent, file: TAbstractFile): void {
		const menu = new Menu();
		const run = (id: string, args: Record<string, unknown>) => () => { this.app.commands.executeCommandById(id, args); };
		const item = (id: string, args: Record<string, unknown>, title?: string, warning = false) => {
			const cmd = this.app.commands.findCommand(id);
			if (!cmd || !this.app.commands.isAvailable(cmd, args)) return;
			menu.addItem((i) => { i.setTitle(title ?? cmd.name).setIcon(cmd.icon ?? null).onClick(run(id, args)); if (warning) i.setWarning(true); });
		};
		const folder = file instanceof TFolder ? file : file.parent ?? this.app.vault.getRoot();
		item('app:new-note', { folder }, 'New note');
		item('app:new-folder', { folder }, 'New folder');
		if (!(file instanceof TFolder && file.isRoot())) {
			menu.addSeparator();
			item('app:open-in-new-tab', { file });
			item('app:open-to-right', { file });
			item('app:copy-file', { file });
			item('app:rename-file', { file }, 'Rename…');
			item('app:move-file', { file }, 'Move to…');
			item('app:delete-file', { file }, 'Delete', true);
		}
		menu.addSeparator();
		item('app:show-in-folder', { file });
		menu.addSeparator();
		this.app.workspace.trigger('file-menu', menu, file, 'file-explorer-context-menu', this.leaf);
		menu.showAtMouseEvent(e);
	}

	reveal(file: TAbstractFile): void {
		for (let p = file.parent; p && !p.isRoot(); p = p.parent) this.expanded.add(p.path);
		this.selectedPath = file.path;
		this.render();
		this.treeEl.querySelector(`[data-path="${CSS.escape(file.path)}"]`)?.scrollIntoView({ block: 'center' });
	}
}

/** Ask for a new name and rename (keeping a note's .md, and updating links). */
export function promptRename(app: App, file: TAbstractFile): void {
	const isNote = file instanceof TFile && file.extension === 'md';
	new NameModal(app, isNote ? 'Rename note' : 'Rename', isNote ? (file as TFile).basename : file.name, 'Rename', (name) => {
		if (!name) return;
		if (/[\\/:]/.test(name)) { new Notice('A name cannot contain / \\ or :'); return; }
		const finalName = isNote && !/\.md$/i.test(name) ? `${name}.md` : name;
		const parent = file.parent;
		const to = !parent || parent.isRoot() ? finalName : `${parent.path}/${finalName}`;
		app.fileManager.renameFile(file, to).catch((e: unknown) => new Notice(e instanceof Error ? e.message : String(e)));
	}).open();
}
