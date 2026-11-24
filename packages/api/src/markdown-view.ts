import { Compartment, EditorState, type Extension, Prec } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { baseExtensions } from './cm-setup';
import { Editor, editorInfoField, type MarkdownFileInfo } from './editor';
import { TFile, type TAbstractFile } from './files';
import { MarkdownRenderer } from './markdown-render';
import { Component } from './component';
import { setIcon } from './icons';
import { Notice, type Menu } from './ui';
import { debounce } from './util';
import { FileView, type ViewStateResult } from './view';
import type { WorkspaceLeaf } from './workspace';

export type MarkdownViewModeType = 'source' | 'preview';

/** A note: a CodeMirror editor, and a reading view (Ctrl/Cmd+E). */
export class MarkdownView extends FileView implements MarkdownFileInfo {
	editor: Editor;
	sourceEl: HTMLElement;
	previewEl: HTMLElement;
	private mode: MarkdownViewModeType = 'source';
	private pluginCompartment = new Compartment();
	private dirty = false;
	/** The text as last read from or written to disk. */
	private lastSaved = '';
	private loading = false;
	private renderChild: Component | null = null;
	private modeButton: HTMLElement;
	private readonly saveSoon = debounce(() => { void this.save(); }, 600, true);

	constructor(leaf: WorkspaceLeaf) {
		super(leaf);
		this.contentEl.addClass('markdown-view');
		this.sourceEl = this.contentEl.createDiv({ cls: 'markdown-source-view' });
		this.previewEl = this.contentEl.createDiv({ cls: 'markdown-reading-view markdown-rendered' });
		this.previewEl.hide();
		const cm = new EditorView({ state: this.makeState(''), parent: this.sourceEl });
		this.editor = new Editor(cm);
		this.modeButton = this.addAction('book-open', 'Reading view (Ctrl+E)', () => { void this.toggleMode(); });
		this.previewEl.addEventListener('click', (e) => this.onPreviewClick(e));
	}

	getViewType(): string { return 'markdown'; }
	override getIcon(): string { return 'file-text'; }
	override canAcceptExtension(ext: string): boolean { return ext === 'md'; }

	get data(): string { return this.editor.getValue(); }
	getViewData(): string { return this.editor.getValue(); }
	setViewData(data: string, clear: boolean): void {
		if (clear) this.editor.cm.setState(this.makeState(data));
		else this.editor.replaceWhole(data);
	}

	getMode(): MarkdownViewModeType { return this.mode; }

	private makeState(doc: string): EditorState {
		const app = this.app;
		const cfg = (k: string, d: boolean) => (app.vault.getConfig(k) as boolean | undefined) ?? d;
		const extensions: Extension[] = [
			editorInfoField.init(() => this),
			baseExtensions({
				spellcheck: cfg('spellcheck', true),
				closeBrackets: cfg('autoPairBrackets', false),
				onFollowLink: (link, newLeaf) => {
					if (link.type === 'url') {
						app.host.clipboard.writeText(link.target);
						new Notice('Quire is offline and does not open web links. The link was copied to the clipboard.');
						return;
					}
					void app.workspace.openLinkText(link.target, this.file?.path ?? '', newLeaf ? 'tab' : false);
				},
			}),
			Prec.highest(keymap.of(app.suggestKeymap())),
			this.pluginCompartment.of(app.getEditorExtensions()),
			EditorView.updateListener.of((u) => {
				if (this.loading) return;
				if (u.docChanged) {
					this.dirty = true;
					this.saveSoon();
					app.workspace.trigger('editor-change', this.editor, this);
				}
				if (u.docChanged || u.selectionSet) app.onEditorUpdate(this, u.docChanged);
			}),
		];
		return EditorState.create({ doc, extensions });
	}

	/** Re-apply plugin editor extensions. */
	reconfigure(): void {
		this.editor.cm.dispatch({ effects: this.pluginCompartment.reconfigure(this.app.getEditorExtensions()) });
	}

	override async onOpen(): Promise<void> {
		this.registerEvent(this.app.vault.on('modify', (f: TAbstractFile) => { if (f === this.file) void this.onExternalModify(); }));
	}

	override async onLoadFile(file: TFile): Promise<void> {
		const text = await this.app.vault.read(file);
		this.loading = true;
		this.editor.cm.setState(this.makeState(text));
		this.loading = false;
		this.lastSaved = text;
		this.dirty = false;
		if (this.mode === 'preview') await this.renderPreview();
	}

	override async onUnloadFile(_file: TFile): Promise<void> {
		await this.save();
	}

	override async onClose(): Promise<void> {
		await this.save();
		this.renderChild?.unload();
	}

	/** Write the editor's text to disk if it changed. */
	async save(): Promise<void> {
		this.saveSoon.cancel();
		const file = this.file;
		if (!file || !this.dirty) return;
		const text = this.editor.getValue();
		this.dirty = false;
		this.lastSaved = text;
		try {
			await this.app.vault.modify(file, text);
		} catch (e) {
			this.dirty = true;
			new Notice(`Could not save ${file.path}: ${e instanceof Error ? e.message : String(e)}`);
		}
	}

	requestSave(): void { this.saveSoon(); }

	/** The file changed on disk (another app, or a plugin writing to it): show the new text. */
	private async onExternalModify() {
		const file = this.file;
		if (!file) return;
		const disk = await this.app.vault.cachedRead(file);
		if (disk === this.lastSaved) return;
		this.lastSaved = disk;
		if (this.dirty) return; // Typing since the last save wins; it is saved next.
		this.loading = true;
		this.editor.replaceWhole(disk, true);
		this.loading = false;
		if (this.mode === 'preview') await this.renderPreview();
	}

	override getState(): Record<string, unknown> {
		return { ...super.getState(), mode: this.mode };
	}

	override async setState(state: unknown, result: ViewStateResult): Promise<void> {
		await super.setState(state, result);
		const mode = (state as { mode?: string } | null)?.mode;
		if (mode === 'preview' || mode === 'source') await this.setMode(mode);
	}

	async setMode(mode: MarkdownViewModeType): Promise<void> {
		this.mode = mode;
		this.sourceEl.toggle(mode === 'source');
		this.previewEl.toggle(mode === 'preview');
		this.modeButton.empty();
		this.modeButton.setAttribute('aria-label', mode === 'source' ? 'Reading view (Ctrl+E)' : 'Edit (Ctrl+E)');
		setIcon(this.modeButton, mode === 'source' ? 'book-open' : 'pencil');
		if (mode === 'preview') await this.renderPreview();
		else this.editor.focus();
		this.app.workspace.requestSaveLayout();
		this.app.workspace.trigger('layout-change');
	}

	toggleMode(): Promise<void> {
		return this.setMode(this.mode === 'source' ? 'preview' : 'source');
	}

	async renderPreview(): Promise<void> {
		this.renderChild?.unload();
		this.renderChild = new Component();
		this.renderChild.load();
		const scroll = this.previewEl.scrollTop;
		this.previewEl.empty();
		const inner = this.previewEl.createDiv({ cls: 'markdown-preview-sizer' });
		await MarkdownRenderer.render(this.app, this.editor.getValue(), inner, this.file?.path ?? '', this.renderChild);
		this.previewEl.scrollTop = scroll;
	}

	private onPreviewClick(e: MouseEvent) {
		const a = (e.target as HTMLElement).closest('a');
		if (!a) return;
		e.preventDefault();
		if (a.hasClass('internal-link')) {
			void this.app.workspace.openLinkText(a.dataset.href ?? '', this.file?.path ?? '', e.ctrlKey || e.metaKey ? 'tab' : false);
			return;
		}
		const href = a.getAttribute('href') ?? '';
		if (href.startsWith('#')) {
			const target = this.previewEl.querySelector(`[id="${CSS.escape(decodeURIComponent(href.slice(1)))}"]`);
			target?.scrollIntoView({ block: 'center' });
			return;
		}
		this.app.host.clipboard.writeText(href);
		new Notice('Quire is offline and does not open web links. The link was copied to the clipboard.');
	}

	/** Scroll to "#Heading" (or "#^block") in this note. */
	scrollToSubpath(subpath: string): void {
		const heading = subpath.replace(/^#/, '').trim().toLowerCase();
		const cache = this.file ? this.app.metadataCache.getFileCache(this.file) : null;
		const h = cache?.headings?.find((x) => x.heading.trim().toLowerCase() === heading);
		if (!h) return;
		const pos = { line: h.position.start.line, ch: 0 };
		this.editor.setCursor(pos);
		this.editor.scrollIntoView({ from: pos, to: pos }, true);
	}

	override focus(): void {
		if (this.mode === 'source') this.editor.focus();
	}

	override onPaneMenu(menu: Menu, _source: string): void {
		menu.addItem((i) => i.setTitle(this.mode === 'source' ? 'Reading view' : 'Editing view').setIcon(this.mode === 'source' ? 'book-open' : 'pencil').onClick(() => { void this.toggleMode(); }));
		if (this.file) {
			const file = this.file;
			this.app.workspace.trigger('file-menu', menu, file, 'more-options', this.leaf);
		}
	}

	override onResize(): void {
		this.editor.cm.requestMeasure();
	}
}
