import type { App } from './app';
import { formatHotkey } from './keymap';
import { Platform } from './util';
import { Component } from './component';
import { TFile } from './files';
import { setIcon } from './icons';
import type { Menu } from './ui';
import type { WorkspaceLeaf } from './workspace';

export interface ViewStateResult { history?: boolean; }

/** What a pane shows. Register a type with `Plugin.registerView()`. */
export abstract class View extends Component {
	app: App;
	leaf: WorkspaceLeaf;
	containerEl: HTMLElement;
	icon = 'file';
	navigation = false;

	constructor(leaf: WorkspaceLeaf) {
		super();
		this.leaf = leaf;
		this.app = leaf.app;
		this.containerEl = createDiv({ cls: 'workspace-leaf-content' });
	}

	abstract getViewType(): string;
	abstract getDisplayText(): string;
	getIcon(): string { return this.icon; }

	async onOpen(): Promise<void> {}
	async onClose(): Promise<void> {}
	onResize(): void {}
	onPaneMenu(_menu: Menu, _source: string): void {}

	getState(): Record<string, unknown> { return {}; }
	async setState(_state: unknown, _result: ViewStateResult): Promise<void> {}
	getEphemeralState(): Record<string, unknown> { return {}; }
	setEphemeralState(_state: unknown): void {}

	/** Called by the leaf when the view is shown or focused. */
	focus(): void {}
}

/** A view with a header bar and a `contentEl` to fill. */
export abstract class ItemView extends View {
	contentEl: HTMLElement;
	protected _headerEl: HTMLElement;
	protected _titleEl: HTMLElement;
	protected _actionsEl: HTMLElement;
	protected _navEl: HTMLElement;
	private _backEl: HTMLButtonElement;
	private _forwardEl: HTMLButtonElement;

	constructor(leaf: WorkspaceLeaf) {
		super(leaf);
		this._headerEl = this.containerEl.createDiv({ cls: 'view-header' });
		// Back and Forward through what this pane has shown (for views of files: see `navigation`).
		this._navEl = this._headerEl.createDiv({ cls: 'view-header-nav' });
		const nav = (icon: string, label: string, go: () => unknown) => {
			const b = this._navEl.createEl('button', { cls: 'clickable-icon view-action', attr: { 'aria-label': label, title: label, type: 'button' } });
			setIcon(b, icon);
			b.addEventListener('click', () => { void go(); });
			return b;
		};
		this._backEl = nav('arrow-left', 'Back', () => this.leaf.goBack());
		this._forwardEl = nav('arrow-right', 'Forward', () => this.leaf.goForward());
		this._titleEl = this._headerEl.createDiv({ cls: 'view-header-title' });
		this._actionsEl = this._headerEl.createDiv({ cls: 'view-actions' });
		this.contentEl = this.containerEl.createDiv({ cls: 'view-content' });
	}

	addAction(icon: string, title: string, callback: (evt: MouseEvent) => unknown): HTMLElement {
		const el = createEl('button', { cls: 'clickable-icon view-action', attr: { 'aria-label': title, title } });
		setIcon(el, icon);
		el.addEventListener('click', callback);
		this._actionsEl.insertBefore(el, this._actionsEl.firstChild);
		return el;
	}

	/** Refresh the header title (and the tab). */
	updateTitle(): void {
		this._titleEl.setText(this.getDisplayText());
		this.updateNav();
	}

	/** Show Back and Forward for views of files, greyed out when there is nowhere to go. */
	updateNav(): void {
		this._navEl.toggle(this.navigation);
		this._backEl.toggleClass('is-disabled', !this.leaf.canGoBack);
		this._backEl.disabled = !this.leaf.canGoBack;
		this._forwardEl.toggleClass('is-disabled', !this.leaf.canGoForward);
		this._forwardEl.disabled = !this.leaf.canGoForward;
	}
}

/** A view of one file. */
export abstract class FileView extends ItemView {
	file: TFile | null = null;
	allowNoFile = false;
	override navigation = true;

	override getDisplayText(): string {
		return this.file ? this.file.basename : 'No file';
	}

	override getState(): Record<string, unknown> {
		return this.file ? { file: this.file.path } : {};
	}

	override async setState(state: unknown, result: ViewStateResult): Promise<void> {
		const path = (state as { file?: string } | null)?.file;
		if (typeof path === 'string') {
			const f = this.app.vault.getAbstractFileByPath(path);
			if (f instanceof TFile && f !== this.file) await this.loadFile(f);
		}
		await super.setState(state, result);
	}

	/**
	 * Show `file`. Its content is read first (`readFileContent`), and only then does the view switch to
	 * it, so nothing that asks for the active note sees the new note before its content is there.
	 */
	async loadFile(file: TFile): Promise<void> {
		const content = await this.readFileContent(file);
		if (this.file) await this.onUnloadFile(this.file);
		this.file = file;
		await this.onLoadFile(file, content);
		this.leaf.updateHeader();
		this.app.workspace.onFileLoaded(this.leaf, file);
	}

	/** Read what the view shows of `file`, before switching to it (passed on to `onLoadFile`). */
	protected async readFileContent(_file: TFile): Promise<unknown> { return undefined; }
	async onLoadFile(_file: TFile, _content?: unknown): Promise<void> {}
	async onUnloadFile(_file: TFile): Promise<void> {}
	canAcceptExtension(_extension: string): boolean { return false; }
	onRename(_file: TFile): void { this.leaf.updateHeader(); }
}

/** An empty pane: "No file is open". */
export class EmptyView extends ItemView {
	getViewType(): string { return 'empty'; }
	getDisplayText(): string { return 'New tab'; }
	override getIcon(): string { return 'file'; }

	override async onOpen(): Promise<void> {
		this.contentEl.addClass('empty-state');
		const box = this.contentEl.createDiv({ cls: 'empty-state-container' });
		box.createDiv({ cls: 'empty-state-title', text: 'No file is open' });
		const actions = box.createDiv({ cls: 'empty-state-action-list' });
		const action = (label: string, command: string) => {
			// The command's own hotkey (as changed in Settings › Hotkeys, and named for this system).
			const cmd = this.app.commands.findCommand(command);
			const key = cmd ? this.app.commands.hotkeysFor(cmd)[0] : undefined;
			const a = actions.createDiv({ cls: 'empty-state-action', text: key ? `${label} (${formatHotkey(key, Platform)})` : label });
			a.addEventListener('click', () => this.app.commands.executeCommandById(command));
		};
		action('Create new note', 'app:new-note');
		action('Go to file', 'app:quick-switcher');
		action('Open the Docket', 'app:docket');
		action('Close', 'app:close-tab');
	}
}

/** A file that is not Markdown: its details and a way to find it. */
export class FileInfoView extends FileView {
	getViewType(): string { return 'file-info'; }
	override getIcon(): string { return 'file-question'; }

	override async onLoadFile(file: TFile): Promise<void> {
		this.contentEl.empty();
		this.contentEl.addClass('file-info-view');
		if (/^(png|jpe?g|gif|webp|svg|bmp|avif)$/.test(file.extension)) {
			this.contentEl.createEl('img', { cls: 'file-info-image', attr: { src: this.app.vault.getResourcePath(file), alt: file.name } });
			return;
		}
		const box = this.contentEl.createDiv({ cls: 'empty-state-container' });
		box.createDiv({ cls: 'empty-state-title', text: file.name });
		box.createDiv({ text: `${(file.stat.size / 1024).toFixed(1)} KB · changed ${new Date(file.stat.mtime).toLocaleString()}` });
		box.createDiv({ cls: 'u-muted', text: 'Caselore cannot show this kind of file.' });
		const b = box.createEl('button', { text: 'Show in system file manager' });
		b.addEventListener('click', () => { void this.app.host.app.showItemInFolder(file.path); });
	}
}
