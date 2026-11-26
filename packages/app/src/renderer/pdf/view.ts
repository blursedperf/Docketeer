/**
 * PDFs in a tab: judgments, readings and slides beside the note about them. Pages render as they scroll
 * into view, with selectable text. A link can open a page (`[[Smith v Jones.pdf#page=12]]`), and a
 * selection can be quoted into the note with a link back to its page, named by the page's printed label.
 *
 * pdf.js lives in its own module (engine.ts), loaded the first time a PDF opens.
 */
import { type App, FileView, MarkdownView, Menu, Notice, type TFile, type ViewStateResult, type WorkspaceLeaf, setIcon } from '@quire/api';
import type * as Engine from './engine';
import { cleanSelection, pageFromSubpath } from './text';

type EngineModule = typeof Engine;
let engine: Promise<EngineModule> | null = null;

/** The engine module, loaded once. It is an app file served from quire://app, like the renderer. */
function loadEngine(): Promise<EngineModule> {
	const url = '/pdf/engine.js';
	engine ??= import(url) as Promise<EngineModule>;
	return engine;
}

export class PdfView extends FileView {
	private handle: Engine.PdfHandle | null = null;
	private pending: { page?: number; scale?: number | 'fit' } = {};
	private bodyEl: HTMLElement;
	private toolbarEl: HTMLElement;
	private pageInput: HTMLInputElement;
	private countEl: HTMLElement;
	private zoomEl: HTMLElement;
	private resizeObserver: ResizeObserver;
	private loadToken = 0;

	constructor(leaf: WorkspaceLeaf) {
		super(leaf);
		this.contentEl.addClass('pdf-view');
		this.toolbarEl = this.contentEl.createDiv({ cls: 'pdf-toolbar' });
		const button = (icon: string, title: string, run: () => void) => {
			const b = this.toolbarEl.createEl('button', { cls: 'clickable-icon', attr: { 'aria-label': title, title } });
			setIcon(b, icon);
			b.addEventListener('click', run);
			return b;
		};
		button('chevron-up', 'Previous page', () => this.goTo((this.handle?.page ?? 1) - 1));
		button('chevron-down', 'Next page', () => this.goTo((this.handle?.page ?? 1) + 1));
		this.pageInput = this.toolbarEl.createEl('input', { cls: 'pdf-page-input', attr: { type: 'text', 'aria-label': 'Page', inputmode: 'numeric' } });
		this.pageInput.addEventListener('keydown', (e) => {
			if (e.key !== 'Enter') return;
			e.preventDefault();
			this.goToLabel(this.pageInput.value);
		});
		this.pageInput.addEventListener('blur', () => this.showPage());
		this.countEl = this.toolbarEl.createSpan({ cls: 'pdf-page-count' });
		this.toolbarEl.createDiv({ cls: 'pdf-toolbar-spacer' });
		button('zoom-out', 'Zoom out', () => this.zoom(-1));
		this.zoomEl = this.toolbarEl.createSpan({ cls: 'pdf-zoom' });
		button('zoom-in', 'Zoom in', () => this.zoom(1));
		button('move-horizontal', 'Fit the width', () => this.handle?.setScale('fit'));
		this.bodyEl = this.contentEl.createDiv({ cls: 'pdf-body', attr: { tabindex: '0' } });
		this.bodyEl.addEventListener('contextmenu', (e) => this.onContextMenu(e));
		watchPinch(this.bodyEl, () => this.handle, (scale) => { this.handle?.setScale(scale); this.showPage(); });
		this.resizeObserver = new ResizeObserver(() => this.handle?.resized());
		this.resizeObserver.observe(this.bodyEl);
	}

	getViewType(): string { return 'pdf'; }
	override getIcon(): string { return 'file-text'; }
	override canAcceptExtension(extension: string): boolean { return extension === 'pdf'; }

	/** The open document, once loaded. */
	get pdf(): Engine.PdfHandle | null { return this.handle; }

	override async onLoadFile(file: TFile): Promise<void> {
		const token = ++this.loadToken;
		this.handle?.destroy();
		this.handle = null;
		this.bodyEl.replaceChildren();
		this.bodyEl.createDiv({ cls: 'pdf-message', text: 'Opening…' });
		try {
			const [mod, bytes] = await Promise.all([loadEngine(), this.app.vault.readBinary(file)]);
			if (token !== this.loadToken) return;
			const readAsset = this.app.host.app.pdfAsset;
			if (!readAsset) throw new Error('No PDF assets');
			this.bodyEl.replaceChildren();
			this.handle = await mod.openPdf(this.bodyEl, new Uint8Array(bytes), {
				readAsset: (kind, name) => readAsset(kind, name),
				page: this.pending.page,
				scale: this.pending.scale ?? 'fit',
				onPageChange: () => this.showPage(),
			});
			if (token !== this.loadToken) { this.handle.destroy(); this.handle = null; return; }
			this.pending = {};
			this.showPage();
		} catch (e) {
			if (token !== this.loadToken) return;
			this.bodyEl.replaceChildren();
			const password = (e as { name?: unknown } | null)?.name === 'PdfPasswordError';
			this.bodyEl.createDiv({ cls: 'pdf-message', text: password ? 'This PDF is protected by a password. Docketeer cannot open protected PDFs yet.' : 'Docketeer could not read this PDF.' });
		}
	}

	override async onUnloadFile(_file: TFile): Promise<void> {
		this.loadToken++;
		this.handle?.destroy();
		this.handle = null;
	}

	override async onClose(): Promise<void> {
		this.loadToken++;
		this.resizeObserver.disconnect();
		this.handle?.destroy();
		this.handle = null;
	}

	override getState(): Record<string, unknown> {
		const h = this.handle;
		return { ...super.getState(), ...(h ? { page: h.page, scale: h.fit ? 'fit' : h.scale } : {}) };
	}

	override async setState(state: unknown, result: ViewStateResult): Promise<void> {
		const s = (state ?? {}) as { page?: unknown; scale?: unknown };
		if (!this.handle) {
			if (typeof s.page === 'number') this.pending.page = s.page;
			if (s.scale === 'fit' || typeof s.scale === 'number') this.pending.scale = s.scale;
		}
		await super.setState(state, result);
	}

	/** `{ subpath: '#page=12' }` from a link goes to that page. */
	override setEphemeralState(state: unknown): void {
		const subpath = (state as { subpath?: unknown } | null)?.subpath;
		const page = typeof subpath === 'string' ? pageFromSubpath(subpath) : null;
		if (page === null) return;
		if (this.handle) this.handle.goTo(page);
		else this.pending.page = page;
	}

	goTo(n: number): void {
		this.handle?.goTo(n);
	}

	/** Go to a page by its printed label ("iv", "112"), or else by its number. */
	goToLabel(text: string): void {
		const h = this.handle;
		if (!h) return;
		const want = text.trim();
		for (let n = 1; n <= h.pageCount; n++) if (h.label(n) === want) return h.goTo(n);
		if (/^\d+$/.test(want)) return h.goTo(Number(want));
		new Notice(`No page “${want}” in this PDF.`);
		this.showPage();
	}

	zoom(dir: 1 | -1): void {
		const h = this.handle;
		if (!h) return;
		const steps = [0.5, 0.67, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4];
		const next = dir === 1 ? steps.find((s) => s > h.scale + 0.01) ?? 4 : [...steps].reverse().find((s) => s < h.scale - 0.01) ?? 0.5;
		h.setScale(next);
		this.showPage();
	}

	private showPage(): void {
		const h = this.handle;
		if (!h) return;
		const label = h.label(h.page);
		if (document.activeElement !== this.pageInput) this.pageInput.value = label;
		this.countEl.setText(label === String(h.page) ? `of ${h.pageCount}` : `(${h.page} of ${h.pageCount})`);
		this.zoomEl.setText(`${Math.round(h.scale * 100)}%`);
		this.app.workspace.requestSaveLayout();
	}

	/** The text selected in this PDF and the page it starts on, or null. */
	selection(): { text: string; page: number } | null {
		const sel = window.getSelection();
		if (!sel || sel.isCollapsed || !this.handle || !this.bodyEl.contains(sel.anchorNode)) return null;
		const text = cleanSelection(sel.toString());
		const page = this.handle.pageOf(sel.anchorNode);
		return text && page ? { text, page } : null;
	}

	/** A link to page `page` of this PDF, from the note at `sourcePath`, shown as its printed label. */
	pageLink(page: number, sourcePath: string): string {
		if (!this.file) return '';
		const label = this.handle?.label(page) ?? String(page);
		return `[[${this.app.metadataCache.fileToLinktext(this.file, sourcePath, false)}#page=${page}|p ${label}]]`;
	}

	private onContextMenu(e: MouseEvent): void {
		const sel = this.selection();
		const page = this.handle?.pageOf(e.target as Node) ?? this.handle?.page;
		if (!page) return;
		e.preventDefault();
		const menu = new Menu();
		if (sel) {
			menu.addItem((i) => i.setTitle('Quote in note').setIcon('quote').onClick(() => { quoteSelection(this.app, this); }));
			menu.addItem((i) => i.setTitle('Copy').setIcon('copy').onClick(() => this.app.host.clipboard.writeText(sel.text)));
		}
		menu.addItem((i) => i.setTitle('Copy link to this page').setIcon('link').onClick(() => {
			this.app.host.clipboard.writeText(this.pageLink(page, notePath(this.app) ?? ''));
		}));
		menu.showAtMouseEvent(e);
	}
}

/** The note written in most recently: where quotes go. */
function recentNote(app: App): MarkdownView | null {
	let best: { view: MarkdownView; time: number } | null = null;
	app.workspace.iterateAllLeaves((l) => {
		if (l.view instanceof MarkdownView && l.view.file && l.view.getMode() === 'source' && (!best || l.activeTime > best.time)) best = { view: l.view, time: l.activeTime };
	});
	return (best as { view: MarkdownView } | null)?.view ?? null;
}

function notePath(app: App): string | null {
	return recentNote(app)?.file?.path ?? null;
}

/** The PDF view the selection is in, else the active one. */
function pdfWithSelection(app: App): PdfView | null {
	let found: PdfView | null = null;
	app.workspace.iterateAllLeaves((l) => { if (!found && l.view instanceof PdfView && l.view.selection()) found = l.view; });
	return found ?? app.workspace.getActiveViewOfType(PdfView);
}

/** Quote the selection into the most recent note, as a quotation with a link to its page. */
export function quoteSelection(app: App, view: PdfView | null = pdfWithSelection(app)): boolean {
	const sel = view?.selection();
	if (!view || !sel) { new Notice('Select some text in a PDF first.'); return false; }
	const note = recentNote(app);
	if (!note?.file) { new Notice('Open a note to quote into.'); return false; }
	const editor = note.editor;
	const cursor = editor.getCursor();
	const line = editor.getLine(cursor.line);
	const before = line.slice(0, cursor.ch).trim() ? '\n\n' : '';
	editor.replaceRange(`${before}> ${sel.text} (${view.pageLink(sel.page, note.file.path)})\n\n`, cursor);
	return true;
}

export function registerPdf(app: App): void {
	app.workspace.registerViewType('pdf', (leaf) => new PdfView(leaf), ['pdf']);
	const add = (c: Parameters<App['commands']['addCommand']>[0]) => app.commands.addCommand({ section: 'PDFs', ...c });
	const active = () => app.workspace.getActiveViewOfType(PdfView);
	add({
		id: 'pdf:quote-selection', name: 'Quote the PDF selection in the note', icon: 'quote', hotkeys: [{ modifiers: ['Alt'], key: 'q' }],
		aliases: ['Quote', 'Excerpt', 'Pinpoint'], keywords: ['pdf', 'judgment', 'reading'],
		when: () => pdfWithSelection(app)?.selection() != null,
		run: () => { quoteSelection(app); },
	});
	add({
		id: 'pdf:copy-page-link', name: 'Copy a link to this PDF page', icon: 'link',
		when: () => !!active()?.pdf,
		run: () => {
			const v = active();
			if (!v?.pdf) return;
			app.host.clipboard.writeText(v.pageLink(v.pdf.page, notePath(app) ?? ''));
			new Notice('Link copied', 1200);
		},
	});
	add({ id: 'pdf:zoom-in', name: 'Zoom in on the PDF', icon: 'zoom-in', when: () => !!active()?.pdf, run: () => active()?.zoom(1) });
	add({ id: 'pdf:zoom-out', name: 'Zoom out of the PDF', icon: 'zoom-out', when: () => !!active()?.pdf, run: () => active()?.zoom(-1) });
	add({ id: 'pdf:fit-width', name: 'Fit the PDF to the width', icon: 'move-horizontal', when: () => !!active()?.pdf, run: () => active()?.pdf?.setScale('fit') });
}

/** The scale a pinch ends on: `ratio` times what it started at, within what the viewer draws. */
export function pinchScale(start: number, ratio: number): number {
	return Math.min(5, Math.max(0.25, Math.round(start * ratio * 100) / 100));
}

/**
 * Two fingers zoom the PDF on a touch screen (the page itself does not zoom: maximum-scale=1). While they move, the
 * pages are stretched to follow them; when they lift, the PDF is drawn again at the new scale.
 */
function watchPinch(body: HTMLElement, handle: () => { scale: number } | null, done: (scale: number) => void): void {
	let pinch: { from: number; scale: number; ratio: number } | null = null;
	const apart = (t: TouchList) => Math.hypot(t[0]!.clientX - t[1]!.clientX, t[0]!.clientY - t[1]!.clientY);
	const pages = () => body.querySelector<HTMLElement>('.pdf-pages');
	body.addEventListener('touchstart', (e) => {
		const h = handle();
		if (e.touches.length !== 2 || !h) return;
		pinch = { from: Math.max(1, apart(e.touches)), scale: h.scale, ratio: 1 };
		const r = body.getBoundingClientRect();
		const mid = { x: (e.touches[0]!.clientX + e.touches[1]!.clientX) / 2 - r.left + body.scrollLeft, y: (e.touches[0]!.clientY + e.touches[1]!.clientY) / 2 - r.top + body.scrollTop };
		pages()?.setCssStyles({ transformOrigin: `${mid.x}px ${mid.y}px` });
	}, { passive: true });
	body.addEventListener('touchmove', (e) => {
		if (!pinch || e.touches.length !== 2) return;
		e.preventDefault();
		pinch.ratio = pinchScale(pinch.scale, apart(e.touches) / pinch.from) / pinch.scale;
		pages()?.setCssStyles({ transform: `scale(${pinch.ratio})` });
	}, { passive: false });
	const end = () => {
		if (!pinch) return;
		const { scale, ratio } = pinch;
		pinch = null;
		pages()?.setCssStyles({ transform: '', transformOrigin: '' });
		if (Math.abs(ratio - 1) > 0.02) done(pinchScale(scale, ratio));
	};
	body.addEventListener('touchend', (e) => { if (e.touches.length < 2) end(); });
	body.addEventListener('touchcancel', end);
}
