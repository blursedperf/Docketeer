import { describe, expect, it } from 'vitest';
import { cleanSelection, pageFromSubpath } from '../src/renderer/pdf/text';

describe('pageFromSubpath', () => {
	it('reads #page=N', () => {
		expect(pageFromSubpath('#page=12')).toBe(12);
		expect(pageFromSubpath('#page=3&selection=x')).toBe(3);
	});
	it('is null for anything else', () => {
		for (const s of ['', '#page=0', '#page=', '#Heading', '#t=12:34', 'page=2']) expect(pageFromSubpath(s), s).toBeNull();
	});
});

describe('cleanSelection', () => {
	it('joins the lines of a selection into one', () => {
		expect(cleanSelection('The duty of care\nis owed to the\n  neighbour ')).toBe('The duty of care is owed to the neighbour');
	});
	it('removes hyphenation at line ends, not real hyphens', () => {
		expect(cleanSelection('a reasonable fore-\nseeability test')).toBe('a reasonable foreseeability test');
		expect(cleanSelection('a well-known rule')).toBe('a well-known rule');
		expect(cleanSelection('the Trade Practices Act 1974 (Cth)-\nNew South Wales')).toBe('the Trade Practices Act 1974 (Cth)- New South Wales');
	});
});
