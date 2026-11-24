import { Compartment, EditorState, type Extension, Prec } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { getCM, vim } from '@replit/codemirror-vim';
import { baseExtensions, bracketExtensions } from './cm-setup';
import { attachFiles, embedMarkdown, isImage } from './attachments';
import { imageEmbeds } from './embeds-editor';
import { livePreview } from './live-preview';
import { spellcheckExtension, wordAt } from './spellcheck';
import { Menu } from './ui';
import { Editor, editorInfoField, type MarkdownFileInfo } from './editor';
import { TFile, type TAbstractFile } from './files';
import { MarkdownRenderer } from './markdown-render';
import { Component } from './component';
import { setIcon } from './icons';
import { Notice } from './ui';
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
	private vimCompartment = new Compartment();
	private bracketCompartment = new Compartment();
	private livePreviewCompartment = new Compartment();
	private spellCompartment = new Compartment();
	/** The vim mode last reported for this editor (normal, insert, visual …), or null when vim is off. */
	vimMode: string | null = null;
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
			// Vim first, so its keys come before the editor's own.
			this.vimCompartment.of(cfg('vimMode', false) ? vim() : []),
			editorInfoField.init(() => this),
			this.bracketCompartment.of(bracketExtensions(cfg('autoPairBrackets', false))),
			this.livePreviewCompartment.of(cfg('livePreview', true) ? livePreview({ onOpenLink: (l, n) => this.followLink(l, n) }) : []),
			this.spellCompartment.of(this.spellExtension()),
			EditorView.domEventHandlers({ contextmenu: (e) => { this.showEditorMenu(e); return true; } }),
			baseExtensions({
				spellcheck: cfg('spellcheck', true),
				closeBrackets: cfg('autoPairBrackets', false),
				onFollowLink: (link, newLeaf) => this.followLink(link, newLeaf),
				onFiles: (files, pos) => { void this.insertFiles(files, pos); return true; },
				onDropPath: (path, pos) => {
					const f = app.vault.getFileByPath(path);
					if (!f) return false;
					this.insertAt(pos, embedMarkdown(app, f, this.file?.path ?? ''));
					return true;
				},
			}),
			imageEmbeds((target, wiki) => {
				const source = this.file?.path ?? '';
				if (!isImage(target.replace(/[#^].*$/, ''))) return null;
				const f = wiki ? app.metadataCache.getFirstLinkpathDest(target, source) : app.vault.getFileByPath(resolveRelative(source, target));
				return f ? app.vault.getResourcePath(f) : null;
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
				// Suggestions open on typing (input or delete events), not on changes made by code.
				const typed = u.transactions.some((tr) => tr.isUserEvent('input') || tr.isUserEvent('delete'));
				if (u.docChanged || u.selectionSet) app.onEditorUpdate(this, typed);
			}),
		];
		return EditorState.create({ doc, extensions });
	}

	/** Follow vim's mode (normal, insert, visual …) for the modeline. Each editor state has its own adapter. */
	private watchVim(): void {
		const vimOn = this.app.vault.getConfig('vimMode') === true;
		const cm = vimOn ? getCM(this.editor.cm) : null;
		const report = (mode: string | null) => {
			if (mode === this.vimMode) return;
			this.vimMode = mode;
			this.app.workspace.trigger('vim-mode-change', mode, this);
		};
		if (!cm) { report(null); return; }
		const tagged = cm as unknown as { __quireWatched?: boolean };
		if (!tagged.__quireWatched) {
			tagged.__quireWatched = true;
			cm.on('vim-mode-change', (e: { mode: string; subMode?: string }) => report(e.subMode ? `${e.mode} ${e.subMode}` : e.mode));
		}
		report(this.vimMode ?? 'normal');
	}

	private spellExtension() {
		return this.app.vault.getConfig('spellcheck') !== false ? spellcheckExtension(this.app.spellchecker, () => this.app.vault.getConfig('spellcheckFootnotes') === true) : [];
	}

	/**
	 * The editor's right-click menu: spelling suggestions for a marked word, cut, copy, paste, and what
	 * plugins add through the "editor-menu" event.
	 */
	private showEditorMenu(e: MouseEvent): void {
		e.preventDefault();
		const cm = this.editor.cm;
		const pos = cm.posAtCoords({ x: e.clientX, y: e.clientY });
		const menu = new Menu();
		const marked = (e.target as HTMLElement).closest('.cm-misspelled');
		const hit = pos !== null && marked ? wordAt(cm, pos) : null;
		const sp = this.app.spellchecker;
		if (hit && !sp.check(hit.word)) {
			const suggestions = sp.suggest(hit.word);
			if (suggestions.length === 0) menu.addItem((i) => i.setTitle('No suggestions').setDisabled(true));
			for (const s of suggestions) {
				menu.addItem((i) => i.setTitle(s).setSection('spelling').onClick(() => {
					cm.dispatch({ changes: { from: hit.from, to: hit.to, insert: s }, userEvent: 'input.spelling' });
				}));
			}
			menu.addSeparator();
			menu.addItem((i) => i.setTitle(`Add "${hit.word}" to dictionary`).setIcon('book-open').onClick(() => { void sp.addWord(hit.word); }));
			menu.addItem((i) => i.setTitle('Ignore').setIcon('eye-off').onClick(() => sp.ignore(hit.word)));
			menu.addSeparator();
		}
		const sel = cm.state.selection.main;
		const clip = this.app.host.clipboard;
		menu.addItem((i) => i.setTitle('Cut').setIcon('scissors').setDisabled(sel.empty).onClick(() => {
			clip.writeText(cm.state.sliceDoc(sel.from, sel.to));
			cm.dispatch({ changes: { from: sel.from, to: sel.to }, userEvent: 'delete.cut' });
		}));
		menu.addItem((i) => i.setTitle('Copy').setIcon('copy').setDisabled(sel.empty).onClick(() => clip.writeText(cm.state.sliceDoc(sel.from, sel.to))));
		menu.addItem((i) => i.setTitle('Paste').setIcon('clipboard').onClick(() => {
			void clip.readText().then((t) => { if (t) cm.dispatch(cm.state.replaceSelection(t)); });
		}));
		menu.addItem((i) => i.setTitle('Select all').onClick(() => cm.dispatch({ selection: { anchor: 0, head: cm.state.doc.length } })));
		menu.addSeparator();
		this.app.workspace.trigger('editor-menu', menu, this.editor, this);
		menu.showAtMouseEvent(e);
	}

	/** Open a link from the editor: notes in Quire; web links are copied, as Quire stays offline. */
	private followLink(link: { type: 'wiki' | 'url'; target: string }, newLeaf: boolean): void {
		if (link.type === 'url') {
			this.app.host.clipboard.writeText(link.target);
			new Notice('Quire is offline and does not open web links. The link was copied to the clipboard.');
			return;
		}
		void this.app.workspace.openLinkText(link.target, this.file?.path ?? '', newLeaf ? 'tab' : false);
	}

	/** Save pasted or dropped files as attachments and insert their embeds at `pos`. */
	private async insertFiles(files: File[], pos: number): Promise<void> {
		if (!this.file) return;
		try {
			const md = await attachFiles(this.app, files, this.file.path);
			this.insertAt(pos, md);
		} catch (e) {
			new Notice(`Could not add the file: ${e instanceof Error ? e.message : String(e)}`);
		}
	}

	private insertAt(pos: number, text: string): void {
		const cm = this.editor.cm;
		const at = Math.min(pos, cm.state.doc.length);
		cm.dispatch({ changes: { from: at, insert: text }, selection: { anchor: at + text.length }, userEvent: 'input.drop' });
		cm.focus();
	}

	/** Re-apply plugin editor extensions. */
	reconfigure(): void {
		const cfg = (k: string) => this.app.vault.getConfig(k) === true;
		this.editor.cm.dispatch({ effects: [
			this.pluginCompartment.reconfigure(this.app.getEditorExtensions()),
			this.vimCompartment.reconfigure(cfg('vimMode') ? vim() : []),
			this.bracketCompartment.reconfigure(bracketExtensions(cfg('autoPairBrackets'))),
			this.livePreviewCompartment.reconfigure(this.app.vault.getConfig('livePreview') !== false ? livePreview({ onOpenLink: (l, n) => this.followLink(l, n) }) : []),
			this.spellCompartment.reconfigure(this.spellExtension()),
		] });
		this.watchVim();
	}

	override async onOpen(): Promise<void> {
		this.registerEvent(this.app.vault.on('modify', (f: TAbstractFile) => { if (f === this.file) void this.onExternalModify(); }));
	}

	protected override async readFileContent(file: TFile): Promise<string> {
		return this.app.vault.read(file);
	}

	override async onLoadFile(file: TFile, content?: unknown): Promise<void> {
		const text = typeof content === 'string' ? content : await this.app.vault.read(file);
		this.loading = true;
		this.editor.cm.setState(this.makeState(text));
		this.watchVim();
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

	/**
	 * Go to a place in the note: `{ line }` (0-based), or `{ from, to }` offsets to select (as search
	 * results and backlinks do), or `{ subpath: "#Heading" }`.
	 */
	override setEphemeralState(state: unknown): void {
		const s = (state ?? {}) as { line?: number; from?: number; to?: number; subpath?: string; focus?: boolean };
		if (this.mode !== 'source' && (s.line !== undefined || s.from !== undefined)) void this.setMode('source');
		const cm = this.editor.cm;
		if (typeof s.from === 'number') {
			const from = Math.max(0, Math.min(cm.state.doc.length, s.from));
			const to = Math.max(from, Math.min(cm.state.doc.length, s.to ?? from));
			cm.dispatch({ selection: { anchor: from, head: to }, effects: EditorView.scrollIntoView(from, { y: 'center' }) });
		} else if (typeof s.line === 'number') {
			const pos = { line: s.line, ch: 0 };
			this.editor.setCursor(pos);
			this.editor.scrollIntoView({ from: pos, to: pos }, true);
		} else if (typeof s.subpath === 'string') {
			this.scrollToSubpath(s.subpath);
		}
		if (s.focus !== false && this.mode === 'source') this.editor.focus();
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

/** A path relative to the note at `source` ("img/a.png", "../a.png"), as a homebase path. */
function resolveRelative(source: string, target: string): string {
	if (target.startsWith('/')) return target.slice(1);
	const parts = source.includes('/') ? source.slice(0, source.lastIndexOf('/')).split('/') : [];
	for (const seg of target.split('/')) {
		if (seg === '..') parts.pop();
		else if (seg !== '.' && seg !== '') parts.push(seg);
	}
	return parts.join('/');
}
