/**
 * The PDF engine: pdf.js, built into its own module (quire://app/pdf/engine.js) and loaded the first time
 * a PDF is opened, so it costs nothing at start-up.
 *
 * Offline and locked down:
 * - The document is handed over as bytes (read through the homebase bridge); pdf.js is never given a URL.
 * - It parses on this thread ("fake worker"), so the page's CSP keeps `worker-src 'none'`.
 * - Fonts and character maps come from the app through `readAsset` (an IPC call that only reads files
 *   shipped with the app), never fetched.
 * - No WebAssembly (it would need 'wasm-unsafe-eval'): JPEG 2000 and JBIG2 images use pdf.js's JavaScript
 *   decoders, imported from quire://app/pdf/wasm/.
 * - No scripting, no XFA forms, no annotation layer: links inside the PDF are not followed.
 */
import { type PDFDocumentProxy, type PDFPageProxy, type PageViewport, type RenderTask, TextLayer, getDocument } from 'pdfjs-dist';
import * as pdfjsWorker from 'pdfjs-dist/build/pdf.worker.mjs';

(globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = pdfjsWorker;

export type AssetReader = (kind: 'standard_fonts' | 'cmaps', name: string) => Promise<Uint8Array>;

export interface PdfOptions {
	readAsset: AssetReader;
	/** 1-based page to show first. */
	page?: number;
	/** A zoom factor, or 'fit' to fit the page width to the pane. */
	scale?: number | 'fit';
	/** The page in view changed (1-based). */
	onPageChange?: (page: number) => void;
}

export interface PdfHandle {
	readonly pageCount: number;
	/** The page in view (1-based). */
	readonly page: number;
	/** The zoom factor in use. */
	readonly scale: number;
	/** Whether the zoom follows the pane's width. */
	readonly fit: boolean;
	/** The printed page label of page `n` ("iv", "112"), or its number when the PDF has none. */
	label(n: number): string;
	goTo(n: number): void;
	setScale(scale: number | 'fit'): void;
	/** The page a DOM node lies on, or null. */
	pageOf(node: Node | null): number | null;
	/** Re-fit after the pane is resized (with fit on). */
	resized(): void;
	/** The text of page `n`, for search and tests. */
	text(n: number): Promise<string>;
	destroy(): void;
}

/** Thrown when the PDF needs a password. */
export class PdfPasswordError extends Error {
	override name = 'PdfPasswordError';
}

class AppBinaryData {
	static reader: AssetReader | null = null;
	constructor(_opts: unknown) {}
	async fetch({ kind, filename }: { kind: string; filename: string }): Promise<Uint8Array> {
		const read = AppBinaryData.reader;
		if (!read) throw new Error('No asset reader');
		if (kind === 'standardFontDataUrl') return read('standard_fonts', filename);
		if (kind === 'cMapUrl') return read('cmaps', filename);
		throw new Error(`Docketeer does not supply ${kind} data`);
	}
}

const MIN_SCALE = 0.25;
const MAX_SCALE = 5;
const PAGE_GAP = 12;

export async function openPdf(container: HTMLElement, data: Uint8Array, opts: PdfOptions): Promise<PdfHandle> {
	AppBinaryData.reader = opts.readAsset;
	const task = getDocument({
		data,
		BinaryDataFactory: AppBinaryData as never,
		// Names only: the factory above reads them from the app. The wasm URL is where the JS decoders are.
		cMapUrl: 'quire://app/pdf/cmaps/',
		standardFontDataUrl: 'quire://app/pdf/standard_fonts/',
		wasmUrl: 'quire://app/pdf/wasm/',
		useWasm: false,
		useWorkerFetch: false,
		enableXfa: false,
		disableRange: true,
		disableStream: true,
		disableAutoFetch: true,
	});
	let doc: PDFDocumentProxy;
	try {
		doc = await task.promise;
	} catch (e) {
		if ((e as { name?: string }).name === 'PasswordException') throw new PdfPasswordError('This PDF is protected by a password.');
		throw e;
	}
	const labels = await doc.getPageLabels().catch(() => null);
	const first = await doc.getPage(1);
	const base = first.getViewport({ scale: 1 });

	container.replaceChildren();
	container.classList.add('pdf-scroller');
	const pagesEl = document.createElement('div');
	pagesEl.className = 'pdf-pages';
	container.appendChild(pagesEl);

	interface Slot { n: number; el: HTMLDivElement; size: { w: number; h: number } | null; rendered: number | null; task: RenderTask | null; text: TextLayer | null; }
	const slots: Slot[] = [];
	for (let n = 1; n <= doc.numPages; n++) {
		const el = document.createElement('div');
		el.className = 'pdf-page';
		el.dataset.page = String(n);
		el.dataset.label = labels?.[n - 1] || String(n);
		pagesEl.appendChild(el);
		slots.push({ n, el, size: n === 1 ? { w: base.width, h: base.height } : null, rendered: null, task: null, text: null });
	}

	let fit = opts.scale === 'fit' || opts.scale === undefined;
	let scale = typeof opts.scale === 'number' ? clamp(opts.scale) : fitScale();
	let current = 1;
	let destroyed = false;

	function clamp(s: number): number { return Math.min(MAX_SCALE, Math.max(MIN_SCALE, s)); }
	function fitScale(): number {
		const width = container.clientWidth - 2 * PAGE_GAP;
		return width > 50 ? clamp(width / base.width) : 1;
	}
	function layout(): void {
		pagesEl.style.setProperty('--pdf-gap', `${PAGE_GAP}px`);
		for (const s of slots) {
			const { w, h } = s.size ?? { w: base.width, h: base.height };
			s.el.style.width = `${Math.floor(w * scale)}px`;
			s.el.style.height = `${Math.floor(h * scale)}px`;
			s.el.style.setProperty('--scale-factor', String(scale));
			s.el.style.setProperty('--total-scale-factor', String(scale));
		}
	}
	/** Stop drawing a page. What is drawn stays (stretched by CSS) until a new drawing replaces it; clear() removes it. */
	function stop(s: Slot): void {
		s.task?.cancel();
		s.task = null;
		s.text?.cancel();
		s.text = null;
		s.rendered = null;
	}
	function clear(s: Slot): void {
		stop(s);
		s.el.replaceChildren();
	}
	async function render(s: Slot): Promise<void> {
		if (s.rendered === scale || destroyed) return;
		stop(s);
		const at = scale;
		s.rendered = at;
		let page: PDFPageProxy;
		try { page = await doc.getPage(s.n); } catch { return; }
		if (destroyed || s.rendered !== at) return;
		const vp: PageViewport = page.getViewport({ scale: at });
		const natural = page.getViewport({ scale: 1 });
		if (!s.size || s.size.w !== natural.width || s.size.h !== natural.height) {
			s.size = { w: natural.width, h: natural.height };
			s.el.style.width = `${Math.floor(vp.width)}px`;
			s.el.style.height = `${Math.floor(vp.height)}px`;
		}
		const dpr = window.devicePixelRatio || 1;
		// Drawn off the page, then swapped in: an earlier drawing (at another zoom) stays until then.
		const canvas = document.createElement('canvas');
		canvas.width = Math.floor(vp.width * dpr);
		canvas.height = Math.floor(vp.height * dpr);
		s.el.querySelector('.textLayer')?.remove();
		const textEl = document.createElement('div');
		textEl.className = 'textLayer';
		s.el.appendChild(textEl);
		s.task = page.render({ canvas, viewport: vp, transform: dpr === 1 ? undefined : [dpr, 0, 0, dpr, 0, 0] });
		s.text = new TextLayer({ textContentSource: page.streamTextContent(), container: textEl, viewport: vp });
		try {
			await Promise.all([s.task.promise, s.text.render()]);
		} catch (e) {
			if ((e as { name?: string }).name !== 'RenderingCancelledException' && (e as { name?: string }).name !== 'AbortException') console.warn('PDF page failed to render', s.n);
			return;
		}
		if (destroyed || s.rendered !== at) return;
		for (const old of Array.from(s.el.querySelectorAll('canvas'))) old.remove();
		s.el.insertBefore(canvas, textEl);
		s.task = null;
	}

	// Pages render as they come near the view, and let go of their canvas when far from it.
	const near = new IntersectionObserver((entries) => {
		for (const e of entries) {
			const s = slots[Number((e.target as HTMLElement).dataset.page) - 1];
			if (!s) continue;
			if (e.isIntersecting) void render(s);
			else if (s.rendered !== null && Math.abs(s.n - current) > 4) clear(s);
		}
	}, { root: container, rootMargin: '150% 0px' });
	for (const s of slots) near.observe(s.el);

	function track(): void {
		const mid = container.scrollTop + container.clientHeight * 0.3;
		let n = 1;
		for (const s of slots) {
			if (s.el.offsetTop <= mid) n = s.n;
			else break;
		}
		if (n !== current) {
			current = n;
			opts.onPageChange?.(n);
		}
	}
	let frame = 0;
	const onScroll = () => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; track(); }); };
	container.addEventListener('scroll', onScroll, { passive: true });

	function goTo(n: number): void {
		const s = slots[Math.min(doc.numPages, Math.max(1, Math.round(n))) - 1];
		if (!s) return;
		container.scrollTop = s.el.offsetTop - PAGE_GAP;
		current = s.n;
		opts.onPageChange?.(s.n);
	}
	function setScale(next: number | 'fit'): void {
		const keep = current;
		fit = next === 'fit';
		const value = fit ? fitScale() : clamp(next as number);
		if (value === scale) return;
		scale = value;
		layout();
		// What is drawn stays, stretched to the new size, until each page is drawn again.
		for (const s of slots) if (s.rendered !== null) stop(s);
		goTo(keep);
		// Re-observe so pages now in view render at the new size.
		for (const s of slots) { near.unobserve(s.el); near.observe(s.el); }
	}

	layout();
	goTo(opts.page ?? 1);

	return {
		get pageCount() { return doc.numPages; },
		get page() { return current; },
		get scale() { return scale; },
		get fit() { return fit; },
		label: (n) => labels?.[n - 1] || String(n),
		goTo,
		setScale,
		pageOf(node) {
			const el = (node instanceof Element ? node : node?.parentElement)?.closest<HTMLElement>('.pdf-page');
			return el && pagesEl.contains(el) ? Number(el.dataset.page) : null;
		},
		resized() { if (fit) setScale('fit'); },
		async text(n) {
			const page = await doc.getPage(n);
			const content = await page.getTextContent();
			return content.items.map((i) => ('str' in i ? i.str + (i.hasEOL ? '\n' : '') : '')).join('');
		},
		destroy() {
			destroyed = true;
			near.disconnect();
			container.removeEventListener('scroll', onScroll);
			if (frame) cancelAnimationFrame(frame);
			for (const s of slots) clear(s);
			void task.destroy();
			container.replaceChildren();
		},
	};
}
