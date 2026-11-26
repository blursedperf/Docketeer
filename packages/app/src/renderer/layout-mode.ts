/**
 * The page's layout classes, kept current: `body.is-compact` for a narrow window (an iPhone, an iPad in Slide
 * Over, a narrow desktop window; layoutMode), `body.is-touch` for a touch screen, and `body.has-keyboard` while an
 * on-screen keyboard is up. The layout follows the window, not the device.
 */
import { layoutMode } from '@quire/api';

export function watchLayout(body: HTMLElement, win: Window = window): () => void {
	const touch = win.matchMedia('(pointer: coarse)');
	const update = () => {
		body.classList.toggle('is-compact', layoutMode(win.innerWidth) === 'compact');
		body.classList.toggle('is-touch', touch.matches);
	};
	update();
	win.addEventListener('resize', update);
	touch.addEventListener('change', update);
	// The on-screen keyboard covers the page rather than resizing it (WebKit): measure it from the visual viewport.
	const keyboard = () => {
		const vv = win.visualViewport;
		applyKeyboard(body, vv ? Math.max(0, win.innerHeight - vv.height - vv.offsetTop) : 0, vv?.height ?? win.innerHeight, win);
	};
	keyboard();
	win.visualViewport?.addEventListener('resize', keyboard);
	win.visualViewport?.addEventListener('scroll', keyboard);
	return () => {
		win.removeEventListener('resize', update);
		touch.removeEventListener('change', update);
		win.visualViewport?.removeEventListener('resize', keyboard);
		win.visualViewport?.removeEventListener('scroll', keyboard);
	};
}

/** Below this, a smaller visual viewport is not a keyboard (a toolbar, a zoom). */
export const KEYBOARD_MIN = 120;

/**
 * How much of the window the keyboard covers (`inset`, from the bottom) and how much is left (`visible`):
 * `--keyboard-inset` and `--visible-height` for what stands on the keyboard (the Docket sheet, the keyboard
 * toolbar), and `body.has-keyboard`, under which a touch screen's app shrinks to what is visible (app.css), so
 * iOS has no need to slide the page up to show the cursor; any slide it made is undone.
 */
export function applyKeyboard(body: HTMLElement, inset: number, visible: number, win: Window = window): void {
	const root = body.ownerDocument.documentElement;
	root.style.setProperty('--keyboard-inset', `${Math.round(inset)}px`);
	root.style.setProperty('--visible-height', `${Math.round(visible)}px`);
	const up = inset >= KEYBOARD_MIN;
	body.classList.toggle('has-keyboard', up);
	if (up && body.classList.contains('is-touch') && win.scrollY) win.scrollTo(0, 0);
}
