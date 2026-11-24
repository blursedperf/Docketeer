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
