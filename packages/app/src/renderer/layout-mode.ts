/**
 * The page's layout classes, kept current: `body.is-compact` for a narrow window (an iPhone, an iPad in Slide
 * Over, a narrow desktop window; layoutMode), `body.is-touch` for a touch screen. The layout follows the window,
 * not the device.
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
	return () => {
		win.removeEventListener('resize', update);
		touch.removeEventListener('change', update);
	};
}
