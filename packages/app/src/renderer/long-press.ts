/**
 * Long-press on a touch screen opens the menu a right-click opens on desktop (docs/mobile/PLAN.md, Phase 2).
 * iOS sends no `contextmenu` for a held finger, so after a still hold this sends one where the finger is, and
 * every right-click menu (tabs, view headers, the Docket's rows and panels, PDFs, the editor's links) opens as it
 * would. In a note's text a hold is the system's own (the cursor, selecting words): there it opens the menu only on
 * a link, an embed or a misspelt word. A trackpad's right-click on an iPad already sends `contextmenu`.
 * While a finger is held where it would open a menu, nothing under it can be selected (body.is-holding), so the
 * system does not select text under the menu; the mouse events WebKit makes of the lift are swallowed, so they
 * neither close the menu nor choose an item in it.
 */

/** How long a finger must stay still (ms), how far it may wander (CSS pixels). */
export const HOLD = 400;
export const WANDER = 10;

/** In a note's text, what a hold opens a menu on: the rest of the text keeps the system's hold. */
const IN_TEXT = '.cm-misspelled, .cm-link, .cm-lp-link, .cm-wikilink, .internal-link, .cm-image-embed, .cm-media-embed';

/** Whether a hold on `target` opens a menu rather than doing what the system does. */
export function holdOpensMenu(target: Element): boolean {
	if (target.closest('input, textarea, select, [contenteditable="plaintext-only"]')) return false;
	const text = target.closest('.cm-content');
	if (text) return !!target.closest(IN_TEXT);
	return true;
}

/** Follows one finger: `start` on touch, `move` as it goes, `end` when it lifts. The menu opens after HOLD. */
export class LongPress {
	private timer: number | null = null;
	private body: HTMLElement | null = null;
	private at: { x: number; y: number; target: Element } | null = null;
	/** True once this touch opened a menu (its move and lift are then not the page's). */
	fired = false;
	/** Called when a hold opened a menu. */
	onOpen: (() => void) | null = null;

	constructor(private win: Window = window, private hold = HOLD) {}

	start(target: Element, x: number, y: number): void {
		this.cancel();
		this.fired = false;
		if (!holdOpensMenu(target)) return;
		this.at = { x, y, target };
		this.body = target.ownerDocument.body;
		this.body.classList.add('is-holding');
		this.timer = this.win.setTimeout(() => this.fire(), this.hold);
	}

	move(x: number, y: number): void {
		if (this.at && Math.hypot(x - this.at.x, y - this.at.y) > WANDER) this.cancel();
	}

	/** The finger lifted, or a second one came down. */
	cancel(): void {
		if (this.timer !== null) this.win.clearTimeout(this.timer);
		this.timer = null;
		this.at = null;
		if (!this.fired) this.letGo();
	}

	/** The page under the finger can be selected again (once a menu's finger has lifted, too). */
	letGo(): void {
		this.body?.classList.remove('is-holding');
	}

	private fire(): void {
		const at = this.at;
		this.timer = null;
		this.at = null;
		if (!at || !at.target.isConnected) { this.letGo(); return; }
		const e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: at.x, clientY: at.y, button: 2 });
		at.target.dispatchEvent(e);
		this.fired = e.defaultPrevented;
		if (this.fired) this.onOpen?.();
		else this.letGo();
	}
}

/** How long after the finger lifts WebKit's mouse events from the hold may still come (ms). */
export const AFTER_LIFT = 600;

/** Long-press for menus on the whole page. Returns the follower (the smoke checks drive it). */
export function registerLongPress(doc: Document = document): LongPress {
	const win = doc.defaultView ?? window;
	const press = new LongPress(win);
	/** While a menu opened by a hold is up and the finger is down, and a moment after it lifts. */
	let holding = false;
	let swallowUntil = 0;
	const swallowing = () => holding || Date.now() < swallowUntil;
	doc.addEventListener('touchstart', (e) => {
		const t = e.touches[0];
		if (e.touches.length !== 1 || !t || !(e.target instanceof Element)) { press.cancel(); return; }
		press.start(e.target, t.clientX, t.clientY);
	}, { passive: true, capture: true });
	// Not passive: once the menu is open, the finger lifting or sliding must not select or scroll under it.
	doc.addEventListener('touchmove', (e) => {
		const t = e.touches[0];
		if (press.fired) { e.preventDefault(); return; }
		if (t) press.move(t.clientX, t.clientY);
	}, { passive: false, capture: true });
	press.onOpen = () => { holding = true; };
	const after = () => {
		press.fired = false;
		holding = false;
		swallowUntil = Date.now() + AFTER_LIFT;
		win.setTimeout(() => press.letGo(), AFTER_LIFT);
	};
	const lift = (e: TouchEvent) => {
		press.cancel();
		if (!press.fired) return;
		if (e.cancelable) e.preventDefault();
		after();
	};
	doc.addEventListener('touchend', lift, { passive: false, capture: true });
	doc.addEventListener('touchcancel', () => { press.cancel(); if (press.fired) after(); }, { capture: true });
	// The mouse events of the hold itself: on the window, before the menu's own listener on the document.
	for (const type of ['mousedown', 'mouseup', 'click'] as const) {
		win.addEventListener(type, (e) => {
			if (!e.isTrusted || !swallowing()) return;
			e.preventDefault();
			e.stopImmediatePropagation();
		}, { capture: true });
	}
	// Text the system selected under the menu anyway (a word under a link): let it go.
	doc.addEventListener('selectionchange', () => {
		if (!swallowing()) return;
		const sel = doc.getSelection();
		if (sel && !sel.isCollapsed && !(doc.activeElement instanceof HTMLInputElement || doc.activeElement instanceof HTMLTextAreaElement)) sel.collapseToStart();
	});
	// A real right-click (a trackpad on an iPad) during a hold: that menu is the one.
	doc.addEventListener('contextmenu', (e) => { if (e.isTrusted) press.cancel(); }, { capture: true });
	return press;
}
