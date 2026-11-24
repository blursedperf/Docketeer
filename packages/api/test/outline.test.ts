import { describe, expect, it } from 'vitest';
import { addBriefField, isCaseBrief, moveSection, outlineHeadings, shiftLevel } from '../src/outline-edit';

const doc = '# Case\n\n## Facts\n\nA.\n\n### Detail\n\nB.\n\n## Held\n\nC.\n\n```\n# not a heading\n```\n';

describe('outline edits', () => {
	it('lists headings outside code', () => {
		expect(outlineHeadings(doc).map((h) => h.text)).toEqual(['Case', 'Facts', 'Detail', 'Held']);
	});
	it('moves a section with its subsections below its sibling', () => {
		const r = moveSection(doc, 2, 1)!;
		expect(outlineHeadings(r.text).map((h) => h.text)).toEqual(['Case', 'Held', 'Facts', 'Detail']);
		expect(r.text.split('\n')[r.line]).toBe('## Facts');
		expect(r.text).toContain('```\n# not a heading\n```');
	});
	it('moves a section up past its sibling, and back', () => {
		const held = outlineHeadings(doc).find((h) => h.text === 'Held')!.line;
		const r = moveSection(doc, held, -1)!;
		expect(outlineHeadings(r.text).map((h) => h.text)).toEqual(['Case', 'Held', 'Facts', 'Detail']);
		expect(r.text.split('\n')[r.line]).toBe('## Held');
		const back = moveSection(r.text, outlineHeadings(r.text).find((h) => h.text === 'Facts')!.line, -1)!;
		expect(outlineHeadings(back.text).map((h) => h.text)).toEqual(['Case', 'Facts', 'Detail', 'Held']);
	});
	it('refuses to move past a parent', () => {
		expect(moveSection(doc, 2, -1)).toBeNull();
		expect(moveSection(doc, 0, 1)).toBeNull();
	});
	it('promotes and demotes a heading with its subheadings', () => {
		const d = shiftLevel(doc, 2, 1)!;
		expect(outlineHeadings(d).map((h) => h.level)).toEqual([1, 3, 4, 2]);
		expect(shiftLevel(doc, 0, -1)).toBeNull();
	});
	it('recognises case briefs and adds missing fields', () => {
		expect(isCaseBrief({ type: 'case-brief' }, [])).toBe(true);
		expect(isCaseBrief({ tags: ['torts', 'case-brief'] }, [])).toBe(true);
		expect(isCaseBrief(undefined, [{ text: 'Facts' }, { text: 'Issues' }, { text: 'Held' }])).toBe(true);
		expect(isCaseBrief(undefined, [{ text: 'Facts' }])).toBe(false);
		const r = addBriefField('# Case\n', 'Ratio');
		expect(r.text).toBe('# Case\n\n## Ratio\n\n');
		expect(r.text.split('\n')[r.line]).toBe('## Ratio');
	});
});
