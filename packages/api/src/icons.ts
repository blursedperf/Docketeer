import { icons } from 'lucide';

type IconNode = [tag: string, attrs: Record<string, string | number>][];

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Icon names are Lucide's, in kebab case: "book-open", "history", "file-output". */
function lookup(name: string): IconNode | null {
	const key = name.replace(/^lucide-/, '').split('-').map((p) => (p ? p[0]!.toUpperCase() + p.slice(1) : p)).join('');
	const table = icons as unknown as Record<string, IconNode>;
	return table[key] ?? null;
}

const custom = new Map<string, IconNode>();

/** Register an icon under `name` from Lucide-style node data. */
export function addIcon(name: string, node: IconNode): void {
	custom.set(name, node);
}

export function getIcon(name: string): SVGSVGElement | null {
	const node = custom.get(name) ?? lookup(name);
	if (!node) return null;
	const svg = document.createElementNS(SVG_NS, 'svg');
	const attrs: Record<string, string> = {
		xmlns: SVG_NS, width: '24', height: '24', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
		'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', class: `svg-icon lucide-${name}`,
	};
	for (const [k, v] of Object.entries(attrs)) svg.setAttribute(k, v);
	for (const [tag, a] of node) {
		const child = document.createElementNS(SVG_NS, tag);
		for (const [k, v] of Object.entries(a)) child.setAttribute(k, String(v));
		svg.appendChild(child);
	}
	return svg;
}

/** Replace `el`'s content with the icon `name` (nothing if there is no such icon). */
export function setIcon(el: HTMLElement, name: string): void {
	el.empty();
	const svg = getIcon(name) ?? getIcon('circle-help');
	if (svg) el.appendChild(svg);
}

export function getIconIds(): string[] {
	return [...custom.keys(), ...Object.keys(icons).map((k) => k.replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/([a-zA-Z])(\d)/g, '$1-$2').toLowerCase())];
}
