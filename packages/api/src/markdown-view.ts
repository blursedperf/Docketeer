import { Annotation, type ChangeSet, Compartment, EditorState, type Extension, Prec, type Text } from '@codemirror/state';

/** Marks an edit copied from another pane showing the same note. */
const paneSync = Annotation.define<boolean>();
import { EditorView, keymap } from '@codemirror/view';
import { getCM, vim } from '@replit/codemirror-vim';
import { redo, undo } from '@codemirror/commands';
import { type LinkSpan, baseExtensions, bracketExtensions, linkSpanAt } from './cm-setup';
import { attachFiles, embedMarkdown, isImage } from './attachments';
import { fileEmbeds } from './embeds-editor';
import { createPlayer, isMedia, timeFromSubpath } from './media';
import { type LivePreviewOptions, livePreview } from './live-preview';
import { type TitleHandlers, inlineTitle, setTitle, titleElement } from './inline-title';
import { spellcheckExtension, wordAt } from './spellcheck';
import { Menu } from './ui';
import { Editor, editorInfoField, type MarkdownFileInfo } from './editor';
import { TFile, type TAbstractFile } from './files';
import { MarkdownRenderer } from './markdown-render';
import { Component } from './component';
import { setIcon } from './icons';
import { Notice } from './ui';
import { isConflict } from './host';
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
	private titleCompartment = new Compartment();
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
			this.livePreviewCompartment.of(cfg('livePreview', true) ? livePreview(this.livePreviewOptions()) : []),
			this.spellCompartment.of(this.spellExtension()),
			this.titleCompartment.of(cfg('inlineTitle', true) ? inlineTitle(this.titleHandlers) : []),
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
			fileEmbeds((target, wiki) => {
				const source = this.file?.path ?? '';
				const bare = target.replace(/[#^].*$/, '');
				if (!isImage(bare) && !isMedia(bare)) return null;
				const f = wiki ? app.metadataCache.getFirstLinkpathDest(bare, source) : app.vault.getFileByPath(resolveRelative(source, bare));
				if (!f) return null;
				if (isImage(f.name)) return { kind: 'image', src: app.vault.getResourcePath(f) };
				const start = timeFromSubpath(target.slice(bare.length));
				return {
					kind: 'media',
					key: `${f.path}|${start ?? ''}`,
					create: (width) => createPlayer(app, f, { start, width }),
				};
			}, (e, embed) => this.showEditorMenu(e, embed.from)),
			Prec.highest(keymap.of(app.suggestKeymap())),
			this.pluginCompartment.of(app.getEditorExtensions()),
			EditorView.updateListener.of((u) => {
				if (this.loading) return;
				const synced = u.transactions.some((tr) => tr.annotation(paneSync) === true);
				if (u.docChanged && !synced) {
					this.dirty = true;
					this.saveSoon();
					app.workspace.trigger('editor-change', this.editor, this);
					this.syncOtherPanes(u.startState.doc, u.changes);
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
		return this.app.vault.getConfig('spellcheck') !== false ? spellcheckExtension(this.app.spellchecker, {
			footnotes: () => this.app.vault.getConfig('spellcheckFootnotes') === true,
			skipNames: () => this.app.vault.getConfig('spellcheckNames') !== false,
		}) : [];
	}

	/**
	 * The editor's right-click menu: spelling suggestions for a marked word; for a link or embed, opening,
	 * renaming and copying it; formatting for a selection; undo, cut, copy, paste; and what plugins add
	 * through the "editor-menu" event. `at` is the place to act on (a picture's or player's embed), when the
	 * click was not on the text.
	 */
	private showEditorMenu(e: MouseEvent, at?: number): void {
		e.preventDefault();
		const cm = this.editor.cm;
		const pos = at ?? cm.posAtCoords({ x: e.clientX, y: e.clientY });
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
		const link = pos !== null ? linkSpanAt(cm.state, at !== undefined ? at + 1 : pos) : null;
		if (link) { this.addLinkItems(menu, link); menu.addSeparator(); }
		const sel = cm.state.selection.main;
		const run = (id: string) => () => { cm.focus(); this.app.commands.executeCommandById(id); };
		if (!sel.empty) {
			menu.addItem((i) => i.setTitle('Bold').setIcon('bold').setSection('format').onClick(run('editor:toggle-bold')));
			menu.addItem((i) => i.setTitle('Italics').setIcon('italic').setSection('format').onClick(run('editor:toggle-italics')));
			menu.addItem((i) => i.setTitle('Highlight').setIcon('highlighter').setSection('format').onClick(run('editor:toggle-highlight')));
			menu.addItem((i) => i.setTitle('Strikethrough').setIcon('strikethrough').setSection('format').onClick(run('editor:toggle-strikethrough')));
			menu.addItem((i) => i.setTitle('Inline code').setIcon('code').setSection('format').onClick(run('editor:toggle-code')));
			menu.addItem((i) => i.setTitle('Make a link').setIcon('link').setSection('format').onClick(run('editor:insert-wikilink')));
			menu.addSeparator();
		} else if (!link) {
			menu.addItem((i) => i.setTitle('Insert link').setIcon('link').onClick(run('editor:insert-wikilink')));
			menu.addSeparator();
		}
		const clip = this.app.host.clipboard;
		menu.addItem((i) => i.setTitle('Undo').setIcon('undo-2').onClick(() => { undo(cm); cm.focus(); }));
		menu.addItem((i) => i.setTitle('Redo').setIcon('redo-2').onClick(() => { redo(cm); cm.focus(); }));
		menu.addSeparator();
		menu.addItem((i) => i.setTitle('Cut').setIcon('scissors').setDisabled(sel.empty).onClick(() => {
			clip.writeText(cm.state.sliceDoc(sel.from, sel.to));
			cm.dispatch({ changes: { from: sel.from, to: sel.to }, userEvent: 'delete.cut' });
		}));
		menu.addItem((i) => i.setTitle('Copy').setIcon('copy').setDisabled(sel.empty).onClick(() => clip.writeText(cm.state.sliceDoc(sel.from, sel.to))));
		menu.addItem((i) => i.setTitle('Paste').setIcon('clipboard').onClick(() => {
			void clip.readText().then((t) => { if (t) cm.dispatch(cm.state.replaceSelection(t)); });
		}));
		menu.addItem((i) => i.setTitle('Select all').setIcon('text-select').onClick(() => cm.dispatch({ selection: { anchor: 0, head: cm.state.doc.length } })));
		menu.addSeparator();
		this.app.workspace.trigger('editor-menu', menu, this.editor, this);
		menu.showAtMouseEvent(e);
	}

	/** The right-click menu's items for the link or embed `link`. */
	private addLinkItems(menu: Menu, link: LinkSpan): void {
		const cm = this.editor.cm;
		const app = this.app;
		const source = this.file?.path ?? '';
		const clip = app.host.clipboard;
		const written = cm.state.sliceDoc(link.from, link.to);
		if (link.type === 'url') {
			menu.addItem((i) => i.setTitle('Copy web address').setIcon('copy').onClick(() => clip.writeText(link.target)));
			return;
		}
		const bare = link.target.replace(/[#^].*$/, '');
		const file = bare ? app.metadataCache.getFirstLinkpathDest(bare, source) : null;
		const open = (where: false | 'tab' | 'split') => () => { void app.workspace.openLinkText(link.target, source, where); };
		menu.addItem((i) => i.setTitle(file ? 'Open link' : 'Create note').setIcon(file ? 'file-text' : 'file-plus').setSection('link').onClick(open(false)));
		menu.addItem((i) => i.setTitle('Open in new tab').setIcon('plus').setSection('link').onClick(open('tab')));
		menu.addItem((i) => i.setTitle('Open to the right').setIcon('columns').setSection('link').onClick(open('split')));
		if (file) {
			menu.addItem((i) => i.setTitle(`Rename ${file.extension === 'md' ? 'note' : 'file'}…`).setIcon('pencil').setSection('link')
				.onClick(() => { app.commands.executeCommandById('app:rename-file', { file }); }));
		}
		menu.addItem((i) => i.setTitle(link.embed ? 'Copy embed' : 'Copy link').setIcon('copy').setSection('link').onClick(() => clip.writeText(written)));
		if (link.embed) {
			menu.addItem((i) => i.setTitle('Show the embed\'s text').setIcon('code').setSection('link').onClick(() => {
				cm.dispatch({ selection: { anchor: link.from + (written.startsWith('![[') ? 3 : 2) }, scrollIntoView: true, userEvent: 'select' });
				cm.focus();
			}));
			menu.addItem((i) => i.setTitle('Remove embed').setIcon('trash-2').setSection('link').setWarning(true).onClick(() => {
				// The whole line when the embed was all it held, and then one of the empty lines around it, so the
				// paragraphs either side stay one empty line apart.
				const doc = cm.state.doc;
				const line = doc.lineAt(link.from);
				let from = link.from;
				let to = link.to;
				if (line.text.trim() === written) {
					from = line.from;
					to = line.to;
					const blank = (n: number) => n >= 1 && n <= doc.lines && doc.line(n).text.trim() === '';
					if (line.number < doc.lines) to = line.to + 1;
					else if (line.number > 1) from = line.from - 1;
					if (blank(line.number - 1) && blank(line.number + 1)) to = Math.min(doc.length, doc.line(line.number + 1).to + 1);
				}
				cm.dispatch({ changes: { from, to }, userEvent: 'delete' });
			}));
		}
	}

	private livePreviewOptions(): LivePreviewOptions {
		return {
			onOpenLink: (l, n) => this.followLink(l, n),
			properties: {
				keys: () => this.app.metadataCache.getPropertyKeys(),
				values: (key) => this.app.metadataCache.getPropertyValues(key),
			},
			// The same test the editor's embeds use: a picture or recording that is in the homebase.
			embedShows: (target) => {
				const bare = target.replace(/[#^].*$/, '');
				if (!isImage(bare) && !isMedia(bare)) return false;
				return !!this.app.metadataCache.getFirstLinkpathDest(bare, this.file?.path ?? '');
			},
		};
	}

	/** Open a link from the editor: notes in Caselore; web links are copied, as Caselore stays offline. */
	private followLink(link: { type: 'wiki' | 'url'; target: string }, newLeaf: boolean): void {
		if (link.type === 'url') {
			this.app.host.clipboard.writeText(link.target);
			new Notice('Caselore is offline and does not open web links. The link was copied to the clipboard.');
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
			this.livePreviewCompartment.reconfigure(this.app.vault.getConfig('livePreview') !== false ? livePreview(this.livePreviewOptions()) : []),
			this.titleCompartment.reconfigure(this.app.vault.getConfig('inlineTitle') !== false ? inlineTitle(this.titleHandlers) : []),
			this.spellCompartment.reconfigure(this.spellExtension()),
		] });
		this.showTitle();
		if (this.mode === 'preview') void this.renderPreview();
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
		this.showTitle();
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
		// Widgets let go of what they hold (embedded players stop and unregister).
		this.editor.cm.destroy();
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
			if (isConflict(e)) { await this.keepBoth(file, text); return; }
			this.dirty = true;
			new Notice(`Could not save ${file.path}: ${e instanceof Error ? e.message : String(e)}`);
		}
	}

	/**
	 * The note changed on another device while this one had edits not saved yet (a host that guards conflicts):
	 * keep both. Your version becomes a conflict copy beside it, and the editor shows the note as it is on disk.
	 */
	private async keepBoth(file: TFile, mine: string): Promise<void> {
		this.saveSoon.cancel();
		let copy: TFile;
		try {
			copy = await this.app.vault.saveConflictCopy(file, mine);
		} catch (e) {
			// Nothing is lost: the edits stay in the editor, to be saved again.
			this.dirty = true;
			new Notice(`“${file.basename}” changed on another device, and your version could not be kept beside it: ${e instanceof Error ? e.message : String(e)}`);
			return;
		}
		const disk = await this.app.vault.read(file);
		if (this.file === file) {
			this.loading = true;
			this.editor.replaceWhole(disk, true);
			this.loading = false;
			this.lastSaved = disk;
			this.dirty = false;
			if (this.mode === 'preview') await this.renderPreview();
		}
		new Notice(`“${file.basename}” changed on another device while you were editing it. Both are kept: yours is “${copy.basename}”.`);
	}

	requestSave(): void { this.saveSoon(); }

	/** The file changed on disk (another app, or a plugin writing to it): show the new text. */
	/**
	 * The same note open in other panes gets the same edit at once (each keeps its own cursor, mapped
	 * through the change). This pane saves; the others only follow.
	 */
	private syncOtherPanes(before: Text, changes: ChangeSet): void {
		const file = this.file;
		if (!file) return;
		this.app.workspace.iterateAllLeaves((leaf) => {
			const other = leaf.view;
			if (other === this || !(other instanceof MarkdownView) || other.file !== file) return;
			const cm = other.editor.cm;
			if (cm.state.doc.eq(before)) cm.dispatch({ changes, annotations: paneSync.of(true) });
			else cm.dispatch({ changes: { from: 0, to: cm.state.doc.length, insert: this.editor.cm.state.doc }, annotations: paneSync.of(true) });
			other.lastSaved = this.lastSaved;
		});
	}

	private async onExternalModify() {
		const file = this.file;
		if (!file) return;
		const disk = await this.app.vault.cachedRead(file);
		if (disk === this.lastSaved) return;
		if (this.dirty && this.app.host.fs.guardsConflicts) {
			// Another device changed it while this one has edits: keep both rather than overwrite either.
			await this.keepBoth(file, this.editor.getValue());
			return;
		}
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
		else {
			// The hidden reading view lets go of what it holds: its players stop and are no longer in use.
			this.renderChild?.unload();
			this.editor.focus();
		}
		this.app.workspace.requestSaveLayout();
		this.app.workspace.trigger('layout-change');
	}

	toggleMode(): Promise<void> {
		return this.setMode(this.mode === 'source' ? 'preview' : 'source');
	}

	/** The note's name above its text: renaming the file when edited (inline-title.ts). */
	private readonly titleHandlers: TitleHandlers = {
		rename: async (name) => {
			const file = this.file;
			if (!file) return false;
			if (/[\\/:]/.test(name)) { new Notice('A note name cannot contain / \\ or :'); return false; }
			const to = file.parent && !file.parent.isRoot() ? `${file.parent.path}/${name}.md` : `${name}.md`;
			if (this.app.vault.getAbstractFileByPath(to)) { new Notice(`There is already a note called “${name}” here.`); return false; }
			try {
				await this.app.fileManager.renameFile(file, to);
				return true;
			} catch (e) {
				new Notice(e instanceof Error ? e.message : String(e));
				return false;
			}
		},
		toText: () => {
			const cm = this.editor.cm;
			if (this.mode === 'preview') return;
			cm.dispatch({ selection: { anchor: 0 }, scrollIntoView: true });
			cm.focus();
		},
	};

	/**
	 * The header band says where the note is ("Torts › Negligence"; the homebase for a note at the top), since
	 * its name is the title above the text. Each part shows that subject or topic in Subjects. With the title
	 * turned off, the band shows the note's name as before.
	 */
	override updateTitle(): void {
		const file = this.file;
		if (!file || this.app.vault.getConfig('inlineTitle') === false) {
			this._titleEl.removeClass('mod-trail');
			super.updateTitle();
			return;
		}
		this._titleEl.empty();
		this._titleEl.addClass('mod-trail');
		const folder = file.parent && !file.parent.isRoot() ? file.parent.path : '';
		const parts = folder ? folder.split('/') : [];
		const crumb = (text: string, path: string) => {
			const el = this._titleEl.createSpan({ cls: 'view-header-crumb', text, attr: { role: 'button', tabindex: '0', title: path ? `Show ${path.replace(/\//g, ' › ')} in Subjects` : 'Show the homebase in Subjects' } });
			const go = (e: Event) => { e.preventDefault(); e.stopPropagation(); this.app.workspace.trigger('reveal-folder', path); };
			el.addEventListener('click', go);
			el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') go(e); });
		};
		if (parts.length === 0) { crumb(this.app.vault.getName(), ''); return; }
		parts.forEach((p, i) => {
			if (i) this._titleEl.createSpan({ cls: 'view-header-crumb-sep', text: '›', attr: { 'aria-hidden': 'true' } });
			crumb(p, parts.slice(0, i + 1).join('/'));
		});
	}

	/** Show (or hide) the title for the open note. */
	private showTitle(): void {
		this.updateTitle();
		const on = this.app.vault.getConfig('inlineTitle') !== false;
		this.editor.cm.dispatch({ effects: setTitle.of(on && this.file ? this.file.basename : null) });
		// Measure the title now, so clicks and right-clicks just after opening land on the right line.
		this.editor.cm.requestMeasure();
	}

	override onRename(file: TFile): void {
		super.onRename(file);
		this.showTitle();
		if (this.mode === 'preview') void this.renderPreview();
	}

	async renderPreview(): Promise<void> {
		this.renderChild?.unload();
		this.renderChild = new Component();
		this.renderChild.load();
		const scroll = this.previewEl.scrollTop;
		this.previewEl.empty();
		const inner = this.previewEl.createDiv({ cls: 'markdown-preview-sizer' });
		if (this.file && this.app.vault.getConfig('inlineTitle') !== false) inner.appendChild(titleElement(this.file.basename, this.titleHandlers));
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
		new Notice('Caselore is offline and does not open web links. The link was copied to the clipboard.');
	}

	/**
	 * Go to a place in the note: `{ line }` (0-based), or `{ from, to }` offsets to select (as search
	 * results and backlinks do), or `{ subpath: "#Heading" }`.
	 */
	/** Where the cursor is (for Back and Forward). */
	override getEphemeralState(): Record<string, unknown> {
		const sel = this.editor.cm.state.selection.main;
		return { from: sel.anchor, to: sel.head };
	}

	override setEphemeralState(state: unknown): void {
		const s = (state ?? {}) as { line?: number; ch?: number; from?: number; to?: number; subpath?: string; focus?: boolean };
		if (this.mode !== 'source' && (s.line !== undefined || s.from !== undefined)) void this.setMode('source');
		const cm = this.editor.cm;
		if (typeof s.from === 'number') {
			const from = Math.max(0, Math.min(cm.state.doc.length, s.from));
			const to = Math.max(from, Math.min(cm.state.doc.length, s.to ?? from));
			cm.dispatch({ selection: { anchor: from, head: to }, effects: EditorView.scrollIntoView(from, { y: 'center' }) });
		} else if (typeof s.line === 'number') {
			// `ch` is the column (past the line's end means its end); without it, the line's start.
			const line = Math.max(0, Math.min(this.editor.lineCount() - 1, s.line));
			const pos = { line, ch: Math.max(0, Math.min(this.editor.getLine(line).length, s.ch ?? 0)) };
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
