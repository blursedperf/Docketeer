/**
 * Homebase (Mod+5): the homebase itself: what is in it, its lock status (locking comes in its own phase),
 * exporting a note with a confirmation step and redaction, and the homebase-wide tools.
 */
import { type App, type DocketPanel, MarkdownRenderer, Component, Modal, Notice, Platform, Setting, TFile, TFolder, formatHotkey, isMedia } from '@quire/api';
import type { ActionItem, Docket } from '../docket';
import { archiveRoot, noteActions, pluginFileActions } from '../actions';
import { NameModal, NewNoteModal, notePlaces, placeName } from '../../dialogs';
import { openFileIn } from '../providers';
import { unitsStore } from '../../units-store';
import { byName, unitTagActions } from './units';
import { row, section } from './common';
import { draggablePath, dropIntoFolder } from '../drag';

export interface RedactOptions { comments: boolean; frontmatter: boolean; words: string[] }

/** Apply the export's redaction: drop comments and frontmatter, black out listed words or phrases. */
export function redact(text: string, o: RedactOptions): string {
	let out = text;
	if (o.frontmatter) out = out.replace(/^---\n[\s\S]*?\n---\n?/, '');
	if (o.comments) out = out.replace(/%%[\s\S]*?(?:%%|$)/g, '').replace(/<!--[\s\S]*?-->/g, '');
	for (const w of o.words.map((x) => x.trim()).filter(Boolean)) {
		const re = new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
		out = out.replace(re, (m) => '█'.repeat(Math.max(3, m.length)));
	}
	return out;
}

/** Export one note as Markdown or HTML into Exports/, after showing exactly what will happen. */
class ExportModal extends Modal {
	private format: 'md' | 'html' = 'md';
	private opts: RedactOptions = { comments: true, frontmatter: false, words: [] };

	constructor(app: App, private file: TFile) {
		super(app);
		this.setTitle(`Export “${file.basename}”`);
	}

	private get target(): string { return `Exports/${this.file.basename}.${this.format}`; }

	override onOpen(): void {
		const { contentEl } = this;
		const where = contentEl.createEl('p', { cls: 'setting-item-description' });
		const say = () => where.setText(`Writes ${this.target} in this homebase${this.app.vault.getFileByPath(this.target) ? ', replacing the earlier export' : ''}. Nothing leaves this computer.`);
		say();
		if (this.app.isEncrypted(this.file)) contentEl.createEl('p', { cls: 'lock-error', text: 'This note is locked. The export will not be encrypted: anyone who can open it can read it.' });
		new Setting(contentEl).setName('Format').addDropdown((d) => d.addOption('md', 'Markdown').addOption('html', 'HTML').setValue(this.format).onChange((v) => { this.format = v as 'md' | 'html'; say(); }));
		new Setting(contentEl).setName('Remove comments').setDesc('%% comments %% and HTML comments.').addToggle((t) => t.setValue(this.opts.comments).onChange((v) => { this.opts.comments = v; }));
		new Setting(contentEl).setName('Remove properties').setDesc('The frontmatter at the top.').addToggle((t) => t.setValue(this.opts.frontmatter).onChange((v) => { this.opts.frontmatter = v; }));
		new Setting(contentEl).setName('Redact').setDesc('Names or phrases to black out, one per line (not case-sensitive).')
			.addTextArea((t) => t.setPlaceholder('Client name\nAddress').onChange((v) => { this.opts.words = v.split('\n'); }));
		const buttons = contentEl.createDiv({ cls: 'modal-button-container' });
		buttons.createEl('button', { text: 'Cancel' }).addEventListener('click', () => this.close());
		const go = buttons.createEl('button', { cls: 'mod-cta', text: 'Export' });
		go.addEventListener('click', () => { void this.run(); });
	}

	private async run(): Promise<void> {
		const text = redact(await this.app.vault.read(this.file), this.opts);
		let data = text;
		if (this.format === 'html') {
			const el = createDiv();
			const c = new Component();
			c.load();
			await MarkdownRenderer.render(this.app, text, el, this.file.path, c);
			c.unload();
			const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!);
			data = `<!DOCTYPE html>\n<html lang="en"><head><meta charset="utf-8"><title>${esc(this.file.basename)}</title></head><body>\n${el.innerHTML}\n</body></html>\n`;
		}
		if (!this.app.vault.getFolderByPath('Exports')) await this.app.vault.createFolder('Exports');
		const existing = this.app.vault.getFileByPath(this.target);
		if (existing) await this.app.vault.modify(existing, data);
		else await this.app.vault.create(this.target, data);
		this.close();
		new Notice(`Exported to ${this.target}.`);
	}
}

/** An icon for a file by its kind: note, PDF, recording, picture, other. */
function fileIcon(f: TFile): string {
	if (f.extension === 'md') return 'file-text';
	if (f.extension === 'pdf') return 'file-type';
	if (isMedia(f.name)) return /^(mp3|m4a|aac|ogg|oga|opus|wav|flac)$/i.test(f.extension) ? 'music' : 'video';
	if (/^(png|jpe?g|gif|webp|svg|bmp|avif)$/i.test(f.extension)) return 'image';
	return 'file';
}

/** Every file in a folder and the folders inside it. */
function countFiles(folder: TFolder): number {
	let n = 0;
	for (const c of folder.children) n += c instanceof TFolder ? countFiles(c) : 1;
	return n;
}

/**
 * The homebase's files and folders as they are on disk (the Files section of Homebase): everything, not only
 * the units. Folders first, A–Z; Enter opens a file or opens and closes a folder; → for actions, including
 * marking a folder as a subject (unit) or topic. N and F on a row make a new note or folder there (in a folder
 * row's folder, beside a file); each opened folder, and the top, end with "+ New note" and "+ New folder".
 */
export function filesTree(app: App, docket: Docket, parent: HTMLElement, open: Set<string>, root: TFolder = app.vault.getRoot(), showKeys = true): void {
	const store = unitsStore(app);
	/** New note in `folder`: the name first (the same dialog as Ctrl+N, with the place chosen). */
	const newNote = (folder: TFolder) => {
		docket.close();
		new NewNoteModal(app, folder, notePlaces(app, archiveRoot(app))).open();
	};
	/** New folder in `folder`: the name first; shown, opened, in the tree afterwards. */
	const newFolder = (folder: TFolder) => {
		new NameModal(app, folder.isRoot() ? 'New folder' : `New folder in ${placeName(folder)}`, '', 'Create', (name) => {
			const n = name.trim();
			if (!n) return;
			if (/[\\/:]/.test(n)) { new Notice('A name cannot contain / \\ or :'); return; }
			const path = folder.isRoot() ? n : `${folder.path}/${n}`;
			if (app.vault.getAbstractFileByPath(path)) { new Notice(`“${n}” is already there.`); return; }
			app.vault.createFolder(path).then(() => {
				if (!folder.isRoot()) open.add(folder.path);
				open.add(path);
				docket.showPanel('core:homebase');
			}).catch((e: unknown) => new Notice(e instanceof Error ? e.message : String(e)));
		}).open();
	};
	/** N and F on a row: a new note or folder in `folder`. */
	const keys = (el: HTMLElement, folder: TFolder) => {
		el.addEventListener('keydown', (e) => {
			if (e.ctrlKey || e.metaKey || e.altKey) return;
			const k = e.key.toLowerCase();
			if (k !== 'n' && k !== 'f') return;
			e.preventDefault();
			e.stopPropagation();
			if (k === 'n') newNote(folder);
			else newFolder(folder);
		});
	};
	/** The "+ New note" and "+ New folder" rows at the end of `folder`'s contents. */
	const addRows = (folder: TFolder, level: number) => {
		// Named by what they make; their indent puts them in the folder. Screen readers hear the folder too.
		const where = folder.isRoot() ? '' : ` in ${folder.name}`;
		const target = folder.isRoot() ? '' : folder.path;
		for (const r of [
			row(parent, docket, 'New note', () => newNote(folder), { icon: 'plus', level, cls: 'is-command', label: `New note${where}` }),
			row(parent, docket, 'New folder', () => newFolder(folder), { icon: 'folder-plus', level, cls: 'is-command', label: `New folder${where}` }),
		]) {
			keys(r, folder);
			// Dropping a file or folder on these rows puts it in this folder too (the top's rows: the top).
			dropIntoFolder(r, app, target);
		}
	};
	const cmd = (id: string, title: string, args: Record<string, unknown>): ActionItem | null => {
		const c = app.commands.findCommand(id);
		return c && app.commands.isAvailable(c, args) ? { title, icon: c.icon, run: () => app.commands.executeCommand(c, args) } : null;
	};
	const common = (f: TFile | TFolder) => [
		cmd('app:rename-file', 'Rename…', { file: f }), cmd('app:move-file', 'Move to…', { file: f }), cmd('app:delete-file', 'Delete…', { file: f }),
		cmd('app:show-in-folder', 'Show in system file manager', { file: f }), ...pluginFileActions(app, f),
	].filter((a): a is ActionItem => !!a);
	const draw = (folder: TFolder, level: number) => {
		const folders = folder.children.filter((c): c is TFolder => c instanceof TFolder && !c.name.startsWith('.')).sort(byName);
		const files = folder.children.filter((c): c is TFile => c instanceof TFile).sort(byName);
		for (const f of folders) {
			const expanded = open.has(f.path);
			const kind = store.kind(f.path);
			const r = row(parent, docket, f.name, () => { if (expanded) open.delete(f.path); else open.add(f.path); void docket.refreshPanel(); }, {
				icon: expanded ? 'chevron-down' : 'chevron-right', level, cls: 'docket-folder', badge: `${kind ? `${kind} · ` : ''}${countFiles(f)}`,
				actions: () => [
					{ title: 'New note here (N)', icon: 'square-pen', run: () => newNote(f) },
					{ title: 'New folder here (F)', icon: 'folder-plus', run: () => newFolder(f) },
					...unitTagActions(app, f), ...common(f),
				],
			});
			r.setAttribute('aria-expanded', String(expanded));
			r.dataset.path = f.path;
			draggablePath(r, f.path);
			dropIntoFolder(r, app, f.path);
			keys(r, f);
			if (expanded) {
				draw(f, level + 1);
				addRows(f, level + 1);
			}
		}
		for (const f of files) {
			const locked = app.isLocked(f);
			const r = row(parent, docket, f.extension === 'md' ? f.basename : f.name, (where) => {
				if (where === 'insert') return;
				docket.close();
				void openFileIn(app, f, where);
			}, {
				icon: locked ? 'lock' : fileIcon(f), level,
				actions: () => (f.extension === 'md' ? (locked ? [] : noteActions(app, docket, f)) : common(f)),
			});
			r.dataset.path = f.path;
			draggablePath(r, f.path);
			keys(r, folder);
		}
	};
	const help = showKeys ? parent.createDiv({ cls: 'docket-help' }) : createDiv();
	for (const [k, t] of [['Enter', 'open'], ['N', 'new note here'], ['F', 'new folder here'], ['F2', 'rename'], [Platform.isMacOS ? '⌘⌫' : 'Del', 'delete'], ['→', 'more']] as const) {
		const s = help.createSpan({ cls: 'docket-help-key' });
		s.createEl('kbd', { text: k });
		s.appendText(` ${t}`);
	}
	draw(root, 0);
	addRows(root, 0);
}

export function homebasePanel(app: App, docket: Docket): DocketPanel {
	const filesOpen = new Set<string>();
	let followed: string | null = null;
	const keyFor = (id: string) => { const c = app.commands.findCommand(id); const k = c ? app.commands.hotkeysFor(c)[0] : undefined; return k ? formatHotkey(k) : undefined; };
	return {
		id: 'core:homebase', title: 'Homebase', icon: 'house', order: 5, source: 'core',
		render: (el) => {
			const notes = app.vault.getMarkdownFiles().length;
			const folders = app.vault.getAllFolders().length;
			const head = el.createDiv({ cls: 'docket-selected' });
			head.createSpan({ cls: 'docket-selected-name', text: app.vault.getName() });
			head.createSpan({ cls: 'docket-option-detail', text: `${notes} notes · ${folders} folders · search index ${app.search.isReady ? `ready (${app.search.index.size} notes, in memory only)` : 'building…'}` });

			// Files: everything in the homebase, opened the way to the open note (once per note).
			const current = app.workspace.getActiveFile();
			if (current && current.path !== followed) {
				followed = current.path;
				const parts = current.path.split('/');
				for (let i = 1; i < parts.length; i++) filesOpen.add(parts.slice(0, i).join('/'));
			}
			filesTree(app, docket, section(el, 'Files', app.vault.getFiles().length), filesOpen);

			const lock = section(el, 'Lock');
			const l = app.lock;
			const run = (id: string) => () => { docket.close(); app.commands.executeCommandById(id); };
			if (!l.isSetUp) {
				row(lock, docket, 'Set up locking…', run('app:lock-setup'), { icon: 'shield', detail: 'Encrypt chosen notes and folders, opened with a passphrase' });
			} else {
				const what = `${l.sealedNotes.length} locked note${l.sealedNotes.length === 1 ? '' : 's'} · ${l.lockedFolders.length} locked folder${l.lockedFolders.length === 1 ? '' : 's'}`;
				if (l.isUnlocked) row(lock, docket, 'Unlocked · Lock now', run('app:lock-now'), { icon: 'lock-open', detail: what, badge: keyFor('app:lock-now') });
				else row(lock, docket, 'Locked · Unlock…', run('app:unlock'), { icon: 'lock', detail: what });
				row(lock, docket, 'Change passphrase…', run('app:change-passphrase'), { icon: 'key-round' });
			}
			const f0 = app.workspace.getActiveFile();
			if (f0 && f0.extension === 'md') {
				if (app.isEncrypted(f0)) row(lock, docket, `Remove lock from “${f0.basename}”…`, () => { docket.close(); app.commands.executeCommandById('app:remove-note-lock', { file: f0 }); }, { icon: 'lock-open' });
				else row(lock, docket, `Lock “${f0.basename}”`, () => { docket.close(); app.commands.executeCommandById('app:lock-note', { file: f0 }); }, { icon: 'lock' });
			}

			const file = app.workspace.getActiveFile();
			const tools = section(el, 'This homebase');
			if (file && file.extension === 'md' && !app.isLocked(file)) {
				row(tools, docket, `Export “${file.basename}”…`, () => { docket.close(); new ExportModal(app, file).open(); }, { icon: 'file-output', detail: 'Markdown or HTML, with redaction; asks first' });
			}
			const cmd = (id: string, label: string, detail?: string) => {
				const c = app.commands.findCommand(id);
				if (c && app.commands.isAvailable(c)) row(tools, docket, label, () => { docket.close(); app.commands.executeCommand(c); }, { icon: c.icon ?? 'terminal', detail });
			};
			cmd('aglc-citations:show-version-history', 'Version history of this note');
			cmd('aglc-citations:restore-deleted-note', 'Restore a deleted note');
			cmd('app:show-in-folder', 'Show this note in the file manager');
			row(tools, docket, 'Open the homebase folder', () => { void app.host.app.showItemInFolder(''); }, { icon: 'folder-open' });
			cmd('app:switch-homebase', 'Switch homebase…', 'Recent homebases, another folder, or the example');
			cmd('app:arrange-panels', 'Arrange and customise the Docket\'s panels…', 'Hide, reorder, or build your own from commands, file trees and note lists');
			cmd('app:open-settings', 'Settings');
		},
	};
}
