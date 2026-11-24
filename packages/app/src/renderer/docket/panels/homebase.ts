/**
 * Homebase (Mod+5): the homebase itself: what is in it, its lock status (locking comes in its own phase),
 * exporting a note with a confirmation step and redaction, and the homebase-wide tools.
 */
import { type App, type DocketPanel, MarkdownRenderer, Component, Modal, Notice, Setting, type TFile, formatHotkey } from '@quire/api';
import type { Docket } from '../docket';
import { row, section } from './common';

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

export function homebasePanel(app: App, docket: Docket): DocketPanel {
	const keyFor = (id: string) => { const c = app.commands.findCommand(id); const k = c ? app.commands.hotkeysFor(c)[0] : undefined; return k ? formatHotkey(k) : undefined; };
	return {
		id: 'core:homebase', title: 'Homebase', icon: 'house', order: 5, source: 'core',
		render: (el) => {
			const notes = app.vault.getMarkdownFiles().length;
			const folders = app.vault.getAllFolders().length;
			const head = el.createDiv({ cls: 'docket-selected' });
			head.createSpan({ cls: 'docket-selected-name', text: app.vault.getName() });
			head.createSpan({ cls: 'docket-option-detail', text: `${notes} notes · ${folders} folders · search index ${app.search.isReady ? `ready (${app.search.index.size} notes, in memory only)` : 'building…'}` });

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
			cmd('app:open-settings', 'Settings');
		},
	};
}
