/** The iOS page's first script (index.html loads it instead of renderer.js): installs window.quire, then the renderer. */
import { webkitNative } from './host';
import { start } from './start';

Promise.resolve().then(() => start(webkitNative(), (url) => import(url))).catch((e: unknown) => {
	console.error('Caselore failed to start', e);
	const h = document.createElement('h2');
	h.textContent = 'Caselore failed to start';
	const p = document.createElement('pre');
	p.textContent = String(e instanceof Error ? e.stack ?? e.message : e);
	document.body.append(h, p);
});
