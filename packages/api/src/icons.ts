import { icons as lucide } from 'lucide';

/**
 * Icons. Names are Lucide's ("book-open", "history", "file-output"), which is what plugins use; the
 * icon set chosen in Appearance draws them (Phosphor by default). A name the set cannot draw falls
 * back to Lucide, so any plugin icon still shows.
 */

type LucideNode = [tag: string, attrs: Record<string, string | number>][];

/** One icon of a set: a filled path, or stroked elements. */
export type IconData =
	| { viewBox: string; d: string }
	| { viewBox: string; nodes: LucideNode; stroke: true };

export interface IconPack {
	id: string;
	name: string;
	/** Weights the set comes in ("regular", "light", "bold" …); the first is the default. */
	weights: string[];
	/** Draw icon `name` (in the set's own names) in `weight`, or null. */
	get(name: string, weight: string): IconData | null;
	/** Lucide name to the set's name, where they differ. */
	aliases: Record<string, string>;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

function lucideData(name: string): IconData | null {
	const key = name.replace(/^lucide-/, '').split('-').map((p) => (p ? p[0]!.toUpperCase() + p.slice(1) : p)).join('');
	const node = (lucide as unknown as Record<string, LucideNode>)[key];
	return node ? { viewBox: '0 0 24 24', nodes: node, stroke: true } : null;
}

const lucidePack: IconPack = {
	id: 'lucide',
	name: 'Lucide',
	weights: ['regular'],
	get: (name) => lucideData(name),
	aliases: {},
};

const packs = new Map<string, IconPack>([[lucidePack.id, lucidePack]]);
let active: IconPack = lucidePack;
let activeWeight = 'regular';
const custom = new Map<string, IconData>();

export function registerIconPack(pack: IconPack): void {
	packs.set(pack.id, pack);
}

export function getIconPacks(): IconPack[] {
	return [...packs.values()];
}

/** Use `id` (in `weight`) for every icon, and redraw the icons on screen. */
export function setIconPack(id: string, weight?: string): void {
	const pack = packs.get(id) ?? lucidePack;
	const w = weight && pack.weights.includes(weight) ? weight : pack.weights[0]!;
	if (pack === active && w === activeWeight) return;
	active = pack;
	activeWeight = w;
	if (typeof document === 'undefined') return;
	for (const el of Array.from(document.querySelectorAll<HTMLElement>('[data-icon]'))) setIcon(el, el.dataset.icon!);
}

export function getActiveIconPack(): { id: string; weight: string } {
	return { id: active.id, weight: activeWeight };
}

/** Register an icon under `name`, from Lucide-style node data or a single path. */
export function addIcon(name: string, data: LucideNode | IconData): void {
	custom.set(name, Array.isArray(data) ? { viewBox: '0 0 24 24', nodes: data, stroke: true } : data);
}

function resolve(name: string): { data: IconData; pack: string } | null {
	const c = custom.get(name);
	if (c) return { data: c, pack: 'custom' };
	const bare = name.replace(/^lucide-/, '');
	if (active !== lucidePack) {
		const own = active.get(active.aliases[bare] ?? bare, activeWeight);
		if (own) return { data: own, pack: active.id };
	}
	const l = lucideData(bare);
	return l ? { data: l, pack: 'lucide' } : null;
}

export function getIcon(name: string): SVGSVGElement | null {
	const r = resolve(name);
	if (!r) return null;
	const svg = document.createElementNS(SVG_NS, 'svg');
	svg.setAttribute('xmlns', SVG_NS);
	svg.setAttribute('viewBox', r.data.viewBox);
	svg.setAttribute('width', '24');
	svg.setAttribute('height', '24');
	svg.setAttribute('class', `svg-icon icon-${name} icon-set-${r.pack}`);
	svg.setAttribute('aria-hidden', 'true');
	if ('d' in r.data) {
		svg.setAttribute('fill', 'currentColor');
		const p = document.createElementNS(SVG_NS, 'path');
		p.setAttribute('d', r.data.d);
		svg.appendChild(p);
	} else {
		for (const [k, v] of Object.entries({ fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })) svg.setAttribute(k, v);
		for (const [tag, a] of r.data.nodes) {
			const child = document.createElementNS(SVG_NS, tag);
			for (const [k, v] of Object.entries(a)) child.setAttribute(k, String(v));
			svg.appendChild(child);
		}
	}
	return svg;
}

/** Replace `el`'s content with the icon `name`. The element follows later icon-set changes. */
export function setIcon(el: HTMLElement, name: string): void {
	el.empty();
	el.dataset.icon = name;
	const svg = getIcon(name) ?? getIcon('circle-help');
	if (svg) el.appendChild(svg);
}

export function getIconIds(): string[] {
	return [...custom.keys(), ...Object.keys(lucide).map((k) => k.replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/([a-zA-Z])(\d)/g, '$1-$2').toLowerCase())];
}
