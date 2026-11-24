import { describe, expect, it } from 'vitest';
import { type LayoutNode, equalise, neighbour, paneRects, resizePane, zoomChain } from '../src/layout-tree';

// A | (B over C), with A twice as wide as the right column.
const tree: LayoutNode = {
	kind: 'split', dir: 'row', weights: [2, 1],
	children: [{ kind: 'pane', id: 'A' }, { kind: 'split', dir: 'column', weights: [1, 1], children: [{ kind: 'pane', id: 'B' }, { kind: 'pane', id: 'C' }] }],
};

describe('layout tree', () => {
	it('works out rectangles', () => {
		const r = paneRects(tree);
		expect(r.get('A')).toEqual({ x: 0, y: 0, w: 2 / 3, h: 1 });
		expect(r.get('C')!.y).toBeCloseTo(0.5);
	});
	it('finds neighbours in every direction', () => {
		expect(neighbour(tree, 'A', 'right')).toBe('B'); // equal overlap: nearest centre is a tie, first wins
		expect(neighbour(tree, 'B', 'left')).toBe('A');
		expect(neighbour(tree, 'C', 'left')).toBe('A');
		expect(neighbour(tree, 'B', 'down')).toBe('C');
		expect(neighbour(tree, 'C', 'up')).toBe('B');
		expect(neighbour(tree, 'A', 'left')).toBeNull();
		expect(neighbour(tree, 'B', 'up')).toBeNull();
	});
	it('resizes within the nearest split of that orientation', () => {
		const wider = resizePane(tree, 'B', 'width', 0.1)!;
		expect(wider.path).toEqual([]);
		expect(wider.weights[1]! / (wider.weights[0]! + wider.weights[1]!)).toBeCloseTo(1 / 3 + 0.1);
		const taller = resizePane(tree, 'C', 'height', 0.1)!;
		expect(taller.path).toEqual([1]);
		expect(taller.weights[1]!).toBeCloseTo(1.2); // takes from B, the neighbour before it
		expect(resizePane(tree, 'A', 'height', 0.1)).toBeNull();
		expect(resizePane(tree, 'A', 'width', 5)!.weights[1]! / 3).toBeCloseTo(0.1); // never below the minimum
	});
	it('equalises and zooms', () => {
		const eq = equalise(tree) as Extract<LayoutNode, { kind: 'split' }>;
		expect(eq.weights).toEqual([1, 1]);
		expect(zoomChain(tree, 'C')).toEqual([[1], [1, 1]]);
	});
});
