/**
 * Tiling, as pure functions over a plain tree, so the geometry is unit-tested apart from the screen:
 * which pane is to the left, how a resize changes the weights, which panes a zoom keeps.
 *
 * A split lays its children out in a row (side by side) or a column (stacked), sized by weight; a pane is
 * a group of tabs.
 */

export type LayoutNode =
	| { kind: 'split'; dir: 'row' | 'column'; weights: number[]; children: LayoutNode[] }
	| { kind: 'pane'; id: string };

export type Direction = 'left' | 'right' | 'up' | 'down';
export interface Rect { x: number; y: number; w: number; h: number }

/** Each pane's rectangle in a unit square. */
export function paneRects(node: LayoutNode, box: Rect = { x: 0, y: 0, w: 1, h: 1 }, out = new Map<string, Rect>()): Map<string, Rect> {
	if (node.kind === 'pane') { out.set(node.id, box); return out; }
	const total = node.weights.reduce((a, b) => a + b, 0) || 1;
	let at = 0;
	node.children.forEach((c, i) => {
		const share = (node.weights[i] ?? 1) / total;
		const r = node.dir === 'row' ? { x: box.x + at * box.w, y: box.y, w: share * box.w, h: box.h } : { x: box.x, y: box.y + at * box.h, w: box.w, h: share * box.h };
		paneRects(c, r, out);
		at += share;
	});
	return out;
}

/**
 * The pane next to `id` in a direction: the nearest one beyond that edge that overlaps it across the
 * other axis (most overlap first, then nearest centre).
 */
export function neighbour(root: LayoutNode, id: string, dir: Direction): string | null {
	const rects = paneRects(root);
	const me = rects.get(id);
	if (!me) return null;
	const eps = 1e-6;
	let best: { id: string; gap: number; overlap: number; dist: number } | null = null;
	for (const [other, r] of rects) {
		if (other === id) continue;
		let gap: number;
		let overlap: number;
		if (dir === 'left' || dir === 'right') {
			gap = dir === 'right' ? r.x - (me.x + me.w) : me.x - (r.x + r.w);
			overlap = Math.min(me.y + me.h, r.y + r.h) - Math.max(me.y, r.y);
		} else {
			gap = dir === 'down' ? r.y - (me.y + me.h) : me.y - (r.y + r.h);
			overlap = Math.min(me.x + me.w, r.x + r.w) - Math.max(me.x, r.x);
		}
		if (gap < -eps || overlap <= eps) continue;
		const dist = dir === 'left' || dir === 'right' ? Math.abs((r.y + r.h / 2) - (me.y + me.h / 2)) : Math.abs((r.x + r.w / 2) - (me.x + me.w / 2));
		const cand = { id: other, gap, overlap, dist };
		if (!best || gap < best.gap - eps || (Math.abs(gap - best.gap) <= eps && (overlap > best.overlap + eps || (Math.abs(overlap - best.overlap) <= eps && dist < best.dist)))) best = cand;
	}
	return best?.id ?? null;
}

/** The path (child indexes from the root) to the pane, or null. */
export function pathTo(node: LayoutNode, id: string, path: number[] = []): number[] | null {
	if (node.kind === 'pane') return node.id === id ? path : null;
	for (let i = 0; i < node.children.length; i++) {
		const p = pathTo(node.children[i]!, id, [...path, i]);
		if (p) return p;
	}
	return null;
}

function at(root: LayoutNode, path: number[]): LayoutNode {
	let n = root;
	for (const i of path) n = (n as Extract<LayoutNode, { kind: 'split' }>).children[i]!;
	return n;
}

/**
 * Grow (positive) or shrink the pane along an axis: in the nearest split of that orientation, the child
 * holding the pane takes `amount` (a share of the split) from the neighbour after it (or before it, at the
 * end). Returns the split's path and its new weights, or null when nothing can change. Shares stay ≥ min.
 */
export function resizePane(root: LayoutNode, id: string, axis: 'width' | 'height', amount: number, min = 0.1): { path: number[]; weights: number[] } | null {
	const path = pathTo(root, id);
	if (!path) return null;
	const want = axis === 'width' ? 'row' : 'column';
	for (let depth = path.length - 1; depth >= 0; depth--) {
		const splitPath = path.slice(0, depth);
		const split = at(root, splitPath);
		if (split.kind !== 'split' || split.dir !== want || split.children.length < 2) continue;
		const i = path[depth]!;
		const j = i < split.children.length - 1 ? i + 1 : i - 1;
		const total = split.weights.reduce((a, b) => a + b, 0) || 1;
		const shares = split.weights.map((w) => w / total);
		const pair = shares[i]! + shares[j]!;
		const next = Math.max(min, Math.min(pair - min, shares[i]! + amount));
		if (Math.abs(next - shares[i]!) < 1e-9) return null;
		shares[j] = pair - next;
		shares[i] = next;
		return { path: splitPath, weights: shares.map((s) => s * total) };
	}
	return null;
}

/** Every split with equal weights. */
export function equalise(node: LayoutNode): LayoutNode {
	if (node.kind === 'pane') return node;
	return { ...node, weights: node.children.map(() => 1), children: node.children.map(equalise) };
}

/** The splits and pane to keep showing when `id` is zoomed: every node on its path. */
export function zoomChain(root: LayoutNode, id: string): number[][] {
	const path = pathTo(root, id);
	if (!path) return [];
	return path.map((_, i) => path.slice(0, i + 1));
}

/** Layout presets: columns of panes; each says what it shows. */
export interface Preset { id: string; name: string; description: string; columns: { weight: number; show: 'current' | 'previous' | 'empty' }[]; docket?: { mode: 'peek' | 'pinned'; panel: string } }

export const PRESETS: Preset[] = [
	{ id: 'single', name: 'Single', description: 'One pane with every tab in it', columns: [{ weight: 1, show: 'current' }] },
	{ id: 'brief-source', name: 'Brief + Source', description: 'Your brief on the left, the judgment or reading on the right', columns: [{ weight: 1, show: 'current' }, { weight: 1, show: 'previous' }] },
	{ id: 'revision', name: 'Revision', description: 'Notes side by side, with the Docket pinned on Authorities', columns: [{ weight: 1, show: 'current' }, { weight: 1, show: 'previous' }], docket: { mode: 'pinned', panel: 'core:authorities' } },
	{ id: 'exam', name: 'Exam', description: 'Exam outline on the left (wider), scratch notes on the right', columns: [{ weight: 3, show: 'current' }, { weight: 2, show: 'empty' }] },
];
