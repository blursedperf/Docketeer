/**
 * Long-press on a touch screen opens the menu a right-click opens on desktop (docs/mobile/PLAN.md, Phase 2).
 * iOS sends no `contextmenu` for a held finger, so after a still hold this sends one where the finger is, and
 * every right-click menu (tabs, view headers, the Docket's rows and panels, PDFs, the editor's links) opens as it
 * would. In a note's text a hold is the system's own (the cursor, selecting words): there it opens the menu only on
 * a link, an embed or a misspelt word. A trackpad's right-click on an iPad already sends `contextmenu`.
 */

/** How long a finger must stay still (ms), how far it may wander (CSS pixels). */
export const HOLD = 450;
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
	private at: { x: number; y: number; target: Element } | null = null;
	/** True once this touch opened a menu (its move and lift are then not the page's). */
	fired = false;

	constructor(private win: Window = window, private hold = HOLD) {}

	start(target: Element, x: number, y: number): void {
		this.cancel();
		this.fired = false;
		if (!holdOpensMenu(target)) return;
		this.at = { x, y, target };
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
	}

	private fire(): void {
		const at = this.at;
		this.cancel();
		if (!at || !at.target.isConnected) return;
		const e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: at.x, clientY: at.y, button: 2 });
		at.target.dispatchEvent(e);
		this.fired = e.defaultPrevented;
	}
}

/** Long-press for menus on the whole page. Returns the follower (the smoke checks drive it). */
export function registerLongPress(doc: Document = document): LongPress {
	const press = new LongPress(doc.defaultView ?? window);
	let swallowUntil = 0;
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
	const lift = (e: TouchEvent) => {
		press.cancel();
		if (!press.fired) return;
		press.fired = false;
		if (e.cancelable) e.preventDefault();
		// A tap that WebKit still makes of the lift must not choose the item under the finger.
		swallowUntil = Date.now() + 400;
	};
	doc.addEventListener('touchend', lift, { passive: false, capture: true });
	doc.addEventListener('touchcancel', () => { press.cancel(); press.fired = false; }, { capture: true });
	doc.addEventListener('click', (e) => {
		if (Date.now() < swallowUntil) { swallowUntil = 0; e.preventDefault(); e.stopPropagation(); }
	}, { capture: true });
	// A real right-click (a trackpad on an iPad) during a hold: that menu is the one.
	doc.addEventListener('contextmenu', (e) => { if (e.isTrusted) press.cancel(); }, { capture: true });
	return press;
}
