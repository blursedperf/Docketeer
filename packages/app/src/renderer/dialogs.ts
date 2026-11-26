/** Small dialogs and helpers for naming, renaming and confirming (once part of the file explorer). */
import { type App, Modal, Notice, Setting, TFile, type TAbstractFile, type TFolder } from '@quire/api';

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

/** "Torts / Duty" for a folder; "Top level" for the homebase itself. */
export function placeName(folder: TFolder): string {
	return folder.isRoot() ? 'Top level' : folder.path.split('/').join(' / ');
}

/** Folders a note can be created in, top level first, then A–Z (numbers in order), without the archive. */
export function notePlaces(app: App, archive: string): TFolder[] {
	const folders = app.vault.getAllFolders(true).filter((f) => f.isRoot() || !(f.path === archive || f.path.startsWith(`${archive}/`)) && !f.name.startsWith('.'));
	return folders.sort((a, b) => (a.isRoot() ? -1 : b.isRoot() ? 1 : a.path.localeCompare(b.path, undefined, { numeric: true, sensitivity: 'base' })));
}

/** Make the note `name` in `folder` (or open it, if it is already there) and put the cursor in it. */
/**
 * Make a note called `name` in `folder` and open it. `content` gives a new note its text (a template, given the
 * note's name); a cursor mark (\u2038) in it is where the cursor goes.
 */
export async function createNote(app: App, folder: TFolder, name: string, where: 'current' | 'tab' = 'current', content?: (title: string) => string | Promise<string>): Promise<TFile | null> {
	const clean = name.trim().replace(/\.md$/i, '');
	if (!clean) return null;
	if (/[\\/:]/.test(clean)) { new Notice('A name cannot contain / \\ or :'); return null; }
	const path = folder.isRoot() ? `${clean}.md` : `${folder.path}/${clean}.md`;
	const existing = app.vault.getFileByPath(path);
	const text = !existing && content ? await content(clean) : '';
	const at = text.indexOf('\u2038');
	const file = existing ?? await app.vault.create(path, text.replace('\u2038', ''));
	if (existing) new Notice(`“${clean}” is already there: opened it.`);
	await app.workspace.getLeaf(where === 'tab' ? 'tab' : false).openFile(file);
	if (at !== -1) {
		const editor = app.workspace.activeEditor?.editor;
		if (editor && app.workspace.getActiveFile() === file) { editor.setCursor(editor.offsetToPos(at)); editor.focus(); }
	}
	return file;
}

/**
 * New note: the name first, and where it goes (the open note's folder unless another is given). Enter
 * creates it; Tab reaches the place; Esc cancels.
 */
export class NewNoteModal extends Modal {
	private name = '';
	constructor(app: App, private folder: TFolder, private places: TFolder[], private from?: { title: string; content: (title: string) => string | Promise<string> }) {
		super(app);
		this.setTitle(from?.title ?? 'New note');
	}
	override onOpen(): void {
		const submit = async () => {
			if (!this.name.trim()) return;
			this.close();
			await createNote(this.app, this.folder, this.name, 'current', this.from?.content);
		};
		new Setting(this.contentEl).setName('Name').addText((t) => {
			t.setPlaceholder('Smith v Jones brief').onChange((v) => { this.name = v; });
			t.inputEl.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); void submit(); } });
			window.setTimeout(() => t.inputEl.focus(), 0);
		});
		new Setting(this.contentEl).setName('In').setDesc('Subject or topic (a folder in this homebase).').addDropdown((d) => {
			for (const f of this.places) d.addOption(f.path, placeName(f));
			d.setValue(this.folder.path).onChange((v) => { this.folder = this.places.find((f) => f.path === v) ?? this.folder; });
			d.selectEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); void submit(); } });
		});
		new Setting(this.contentEl)
			.addButton((b) => b.setButtonText('Cancel').onClick(() => this.close()))
			.addButton((b) => b.setButtonText('Create').setCta().onClick(() => { void submit(); }));
	}
	override onClose(): void { this.contentEl.empty(); }
}
