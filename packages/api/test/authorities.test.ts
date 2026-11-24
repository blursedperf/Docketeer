// Fixtures are made up for these tests (names and citations shaped like Australian ones); they are not
// quoted from any guide. Citation shapes marked VERIFY are worth checking against AGLC4 itself.
import { describe, expect, it } from 'vitest';
import { findAuthorities, nextOccurrence } from '../src/authorities';

const note = `---
tags: [torts]
---
# Native title

In *Mabo v Queensland [No 2]* (1992) 175 CLR 1 ('*Mabo*') the court rejected terra nullius.[^1]
Later, *Mabo* was applied. Compare Smith v Jones, which nobody cited properly.

The *Native Title Act 1993* (Cth) s 223 defines native title. See also *Racial Discrimination Act 1975* (Cth) ss 9–10.

\`Fake v Case\` in code is ignored.

[^1]: *Wik Peoples v Queensland* [1996] HCA 40; Jane Citizen, 'Title After Mabo' (2001) 25(3) Melbourne University Law Review 100, 102.
[^2]: Kim Writer, *Property Law Basics* (Federation Press, 3rd ed, 2015) 45.
`;

describe('authorities', () => {
	const found = findAuthorities(note);
	const by = (name: string) => found.find((a) => a.name === name);

	it('finds a reported case with its citation, jurisdiction and short title', () => {
		const mabo = by('Mabo v Queensland [No 2]')!;
		expect(mabo.kind).toBe('case');
		expect(mabo.citations).toEqual(['(1992) 175 CLR 1']); // VERIFY: reported citation shape
		expect(mabo.jurisdiction).toBe('Cth');
		expect(mabo.aliases).toEqual(['Mabo']);
		expect(mabo.confirmed).toBe(true);
		// The full name, the short title in its definition is part of it, and the later "Mabo".
		expect(mabo.occurrences.length).toBe(2);
	});
	it('finds a medium neutral citation in a footnote', () => {
		const wik = by('Wik Peoples v Queensland')!;
		expect(wik.citations).toEqual(['[1996] HCA 40']);
		expect(wik.occurrences[0]!.inFootnote).toBe(true);
	});
	it('marks a bare case name unconfirmed', () => {
		const sj = by('Smith v Jones')!;
		expect(sj.confirmed).toBe(false);
		expect(found.some((a) => a.name.includes('Fake'))).toBe(false);
	});
	it('finds legislation with jurisdiction and sections', () => {
		const nta = by('Native Title Act 1993')!;
		expect(nta.kind).toBe('legislation');
		expect(nta.jurisdiction).toBe('Cth');
		expect(nta.sections).toEqual(['s 223']);
		expect(by('Racial Discrimination Act 1975')!.sections).toEqual(['ss 9–10']);
	});
	it('finds journal articles and books in footnotes', () => {
		const art = by('Title After Mabo')!;
		expect(art.kind).toBe('secondary');
		expect(art.author).toBe('Jane Citizen');
		expect(art.citations[0]).toBe('(2001) 25(3) Melbourne University Law Review 100'); // VERIFY: article shape
		const book = by('Property Law Basics')!;
		expect(book.citations[0]).toBe('(Federation Press, 3rd ed, 2015)'); // VERIFY: book shape
	});
	it('applies confirmations and merges', () => {
		const merged = findAuthorities(note, { merges: { 'case:smith v jones': 'case:mabo v queensland [no 2]' }, confirmed: [] });
		expect(merged.some((a) => a.name === 'Smith v Jones')).toBe(false);
		expect(merged.find((a) => a.name.startsWith('Mabo'))!.occurrences.length).toBe(3);
		const confirmed = findAuthorities(note, { confirmed: ['case:smith v jones'] });
		expect(confirmed.find((a) => a.name === 'Smith v Jones')!.confirmed).toBe(true);
	});
	it('steps through occurrences, wrapping round', () => {
		const mabo = by('Mabo v Queensland [No 2]')!;
		const first = mabo.occurrences[0]!.from;
		expect(nextOccurrence(mabo, first)!.from).toBe(mabo.occurrences[1]!.from);
		expect(nextOccurrence(mabo, 1e9)!.from).toBe(first);
	});
	it('lists in order of first appearance', () => {
		expect(found.map((a) => a.kind)).toContain('legislation');
		expect(found[0]!.name).toBe('Mabo v Queensland [No 2]');
	});
});
