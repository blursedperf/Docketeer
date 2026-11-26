/**
 * Export to PDF: a note drawn as in reading view (properties, headings, lists, tables, pictures, embedded notes,
 * footnotes), on white pages, printed to a PDF saved beside the note. Recordings become their names. In the file
 * menu (so a tab's, a Docket row's and a note's actions offer it), the editor's right-click menu, and a command.
 *
 * Plugins print their own page with `exportHtmlToPdf` (AGLC4 Citations does, for its footnotes).
 */
import { type App, Component, MarkdownRenderer, type Menu, Modal, Notice, Setting, TAbstractFile, TFile } from '@quire/api';

/** The page's look: A4 by default, black on white, the text font chosen in Settings if it is on this computer. */
function printCss(app: App): string {
	const chosen = String(app.config.textFont || '').trim();
	const text = `${chosen ? `"${chosen.replace(/"/g, '')}", ` : ''}Charter, "Iowan Old Style", Georgia, "Times New Roman", serif`;
	return `
@page { size: A4; margin: 20mm 22mm 22mm; }
html { color: #111; background: #fff; }
body { margin: 0; font-family: ${text}; font-size: 11pt; line-height: 1.5; }
h1, h2, h3, h4, h5, h6 { font-family: inherit; line-height: 1.25; margin: 1.3em 0 0.45em; break-after: avoid; page-break-after: avoid; }
h1 { font-size: 20pt; border-bottom: 0.5pt solid #999; padding-bottom: 0.15em; }
h2 { font-size: 15pt; border-bottom: 0.5pt solid #ccc; padding-bottom: 0.1em; }
h3 { font-size: 13pt; } h4 { font-size: 11.5pt; } h5, h6 { font-size: 11pt; }
h6 { text-transform: uppercase; letter-spacing: 0.04em; }
.note-title { margin-top: 0; }
p, li, blockquote, pre, table, figure, img { break-inside: avoid-page; }
a { color: #1a4fa0; text-decoration: underline; text-decoration-color: #9bb3d9; }
a.is-unresolved { color: inherit; text-decoration: none; }
strong { font-weight: 700; } em { font-style: italic; }
code { font-family: "JetBrains Mono", Menlo, Consolas, monospace; font-size: 0.88em; background: #f2f2f2; border-radius: 3px; padding: 0 3px; }
pre { background: #f6f6f6; border: 0.5pt solid #ddd; border-radius: 4px; padding: 8pt 10pt; white-space: pre-wrap; }
pre code { background: none; padding: 0; }
blockquote { margin: 1em 0; padding: 0.2em 1em; border-left: 2.5pt solid #bbb; color: #444; }
mark { background: #fff3a3; color: inherit; }
hr { border: none; border-top: 0.5pt solid #bbb; margin: 1.6em 0; }
ul, ol { padding-left: 1.6em; }
li::marker { color: #555; }
.task-list-item { list-style: none; }
.task-list-item-checkbox { margin: 0 6px 0 -1.4em; vertical-align: middle; }
.task-list-item.is-checked { color: #666; text-decoration: line-through; }
table { border-collapse: collapse; margin: 1em 0; }
th, td { border: 0.5pt solid #bbb; padding: 3pt 8pt; text-align: left; vertical-align: top; }
th { background: #f0f0f0; }
img { max-width: 100%; }
.metadata-container { display: grid; grid-template-columns: max-content 1fr; gap: 2pt 14pt; margin: 0 0 1.4em; padding: 6pt 10pt;
	font-size: 9pt; background: #f6f6f6; border-left: 2pt solid #bbb; }
.metadata-property { display: contents; }
.metadata-property-key { color: #555; }
.markdown-embed { margin: 1em 0; padding: 0.2em 0 0.2em 1em; border-left: 1.5pt solid #ccc; }
.markdown-embed-title { font-size: 9pt; color: #666; margin-bottom: 0.3em; }
.export-media { color: #555; font-style: italic; }
.footnotes { font-size: 9.5pt; color: #333; border-top: 0.5pt solid #bbb; margin-top: 2em; }
sup a, .footnote-ref a { text-decoration: none; }
`;
}

function escapeHtml(s: string): string {
	return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

/** The note `file` as a whole HTML page for printing. */
export async function noteToPrintHtml(app: App, file: TFile, text?: string): Promise<string> {
	const markdown = text ?? await app.vault.cachedRead(file);
	const el = createDiv({ cls: 'markdown-rendered' });
	const comp = new Component();
	comp.load();
	try {
		await MarkdownRenderer.render(app, markdown, el, file.path, comp);
	} finally {
		comp.unload();
	}
	// Players cannot be printed: their names stand in for them. Buttons and inputs go (checkboxes stay).
	for (const media of Array.from(el.querySelectorAll<HTMLElement>('audio, video, .media-player, .media-embed'))) {
		const name = media.getAttribute('aria-label') || media.dataset.name || media.getAttribute('title') || 'Recording';
		const p = document.createElement('p');
		p.className = 'export-media';
		p.textContent = `▶ ${name}`;
		media.replaceWith(p);
	}
	for (const b of Array.from(el.querySelectorAll('button'))) b.remove();
	for (const box of Array.from(el.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'))) if (box.checked) box.setAttribute('checked', '');
	// The note's name as its title, unless it already begins with that heading.
	const first = el.querySelector('.markdown-rendered-body > :first-child');
	const titled = first?.tagName === 'H1' && first.textContent?.trim() === file.basename;
	const title = titled ? '' : `<h1 class="note-title">${escapeHtml(file.basename)}</h1>`;
	return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(file.basename)}</title><style>${printCss(app)}</style></head><body><article class="markdown-rendered">${title}${el.innerHTML}</article></body></html>`;
}

/** Ask whether to replace an existing export, or save beside it. */
class ReplaceModal extends Modal {
	constructor(app: App, private path: string, private onChoose: (replace: boolean) => void) {
		super(app);
		this.setTitle(`${path.split('/').pop()} already exists`);
	}
	override onOpen(): void {
		this.contentEl.createEl('p', { text: `${this.path} is already there. Replace it with this export, or save the export as a new file beside it?` });
		new Setting(this.contentEl)
			.addButton((b) => b.setButtonText('Cancel').onClick(() => this.close()))
			.addButton((b) => b.setButtonText('Save as a new file').onClick(() => { this.close(); this.onChoose(false); }))
			.addButton((b) => b.setButtonText('Replace it').setCta().onClick(() => { this.close(); this.onChoose(true); }));
	}
	override onClose(): void { this.contentEl.empty(); }
}

/** A path beside `path` that is free: "Note 2.pdf", "Note 3.pdf" … */
function freePath(app: App, path: string): string {
	const dot = path.lastIndexOf('.');
	for (let n = 2; ; n++) {
		const p = `${path.slice(0, dot)} ${n}${path.slice(dot)}`;
		if (!app.vault.getAbstractFileByPath(p)) return p;
	}
}

/**
 * Print `html` (a whole page) to a PDF at `path` in the homebase, asking first if one is there. Resolves to the
 * file written, or null (cancelled, or printing failed: a notice says why).
 */
export async function exportHtmlToPdf(app: App, html: string, path: string): Promise<TFile | null> {
	const print = app.host.app.printToPdf;
	if (!print) { new Notice('Exporting to PDF needs the desktop app.'); return null; }
	const existing = app.vault.getAbstractFileByPath(path);
	if (existing) {
		const replace = await new Promise<boolean | null>((resolve) => {
			const m = new ReplaceModal(app, path, resolve);
			const close = m.onClose.bind(m);
			m.onClose = () => { close(); window.setTimeout(() => resolve(null), 0); };
			m.open();
		});
		if (replace === null) return null;
		if (!replace) path = freePath(app, path);
	}
	let data: ArrayBuffer;
	try {
		data = await print.call(app.host.app, html);
	} catch (e) {
		new Notice(`Export to PDF failed: ${e instanceof Error ? e.message : String(e)}`);
		return null;
	}
	const there = app.vault.getAbstractFileByPath(path);
	if (there instanceof TFile) { await app.vault.modifyBinary(there, data); return there; }
	return app.vault.createBinary(path, data);
}

/** Export the note `file` to a PDF beside it. */
export async function exportNoteToPdf(app: App, file: TFile): Promise<TFile | null> {
	// A locked note's export is not encrypted: say so first.
	if (app.isLocked?.(file) || (app as unknown as { isEncrypted?: (f: TFile) => boolean }).isEncrypted?.(file)) {
		const go = await new Promise<boolean>((resolve) => {
			const m = new Modal(app);
			m.setTitle(`${file.basename} is locked`);
			m.contentEl.createEl('p', { text: 'The PDF will not be encrypted: anyone who can open it can read it.' });
			let chosen = false;
			new Setting(m.contentEl)
				.addButton((b) => b.setButtonText('Cancel').onClick(() => m.close()))
				.addButton((b) => b.setButtonText('Export anyway').setCta().onClick(() => { chosen = true; m.close(); }));
			m.onClose = () => resolve(chosen);
			m.open();
		});
		if (!go || app.isLocked?.(file)) { if (go) new Notice('Unlock the note to export it.'); return null; }
	}
	// An open note is exported as it is now, saved or not.
	const editor = app.workspace.editorForFile(file);
	const html = await noteToPrintHtml(app, file, editor?.getValue());
	const folder = file.parent && !file.parent.isRoot() ? `${file.parent.path}/` : '';
	const out = await exportHtmlToPdf(app, html, `${folder}${file.basename}.pdf`);
	if (out) new Notice(`Exported ${out.path}.`);
	return out;
}

/** The command, and "Export to PDF" in the file menu and the editor's right-click menu. */
export function registerExportPdf(app: App, add: (c: Parameters<App['commands']['addCommand']>[0]) => unknown): void {
	const isNote = (f: unknown): f is TFile => f instanceof TFile && f.extension === 'md';
	add({
		id: 'app:export-pdf', name: 'Export to PDF', icon: 'file-down', section: 'Notes', aliases: ['Print', 'Save as PDF'],
		when: (ctx) => isNote(ctx.args.file instanceof TAbstractFile ? ctx.args.file : ctx.file) && !!app.host.app.printToPdf,
		run: (ctx) => { const f = ctx.args.file instanceof TFile ? ctx.args.file : ctx.file; if (isNote(f)) void exportNoteToPdf(app, f); },
	});
	app.workspace.on('file-menu', (menu: Menu, file: TAbstractFile) => {
		if (!isNote(file) || !app.host.app.printToPdf) return;
		menu.addItem((i) => i.setTitle('Export to PDF').setIcon('file-down').onClick(() => { void exportNoteToPdf(app, file); }));
	});
	app.workspace.on('editor-menu', (menu: Menu, _editor: unknown, view: { file?: TFile | null }) => {
		const file = view?.file;
		if (!isNote(file) || !app.host.app.printToPdf) return;
		menu.addItem((i) => i.setTitle('Export to PDF').setIcon('file-down').onClick(() => { void exportNoteToPdf(app, file); }));
	});
}
