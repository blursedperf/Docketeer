// Original fixtures (made-up names, real-looking shapes). Each expected string is marked
// "VERIFY against AGLC": they encode our reading of the rules and should be checked against the guide.
import { describe, expect, it } from 'vitest';
import { AGLC4, footnoteChanges, noteFootnotes, planCitation, type Source } from '../src/cite';

const reported: Source = { kind: 'case-reported', fields: { name: 'Example v Commonwealth', year: '1999', volume: '200', report: 'CLR', page: '10', short: 'Example' } };
const yearSeries: Source = { kind: 'case-reported', fields: { name: 'Sample v Sample', year: '1987', volume: '2', report: 'Qd R', page: '3' } };
const mnc: Source = { kind: 'case-mnc', fields: { name: 'Doe v Roe', year: '2021', court: 'NSWCA', number: '77' } };
const act: Source = { kind: 'legislation', fields: { title: 'Imaginary Rights Act', year: '2005', jurisdiction: 'Vic' } };
const article: Source = { kind: 'article', fields: { authors: 'Alex Citizen; Sam Writer', title: 'Thinking About Duty', year: '2012', volume: '36', issue: '2', journal: 'Example Law Review', page: '300' } };
const book: Source = { kind: 'book', fields: { authors: 'Kim Author', title: 'Principles of Made-Up Law', publisher: 'Example Press', edition: '2', year: '2019', short: 'Principles' } };

describe('AGLC4 full citations', () => {
	it('formats cases', () => {
		expect(AGLC4.full(reported, '15')).toBe('*Example v Commonwealth* (1999) 200 CLR 10, 15 (‘*Example*’)'); // VERIFY against AGLC
		expect(AGLC4.full(yearSeries)).toBe('*Sample v Sample* [1987] 2 Qd R 3'); // VERIFY against AGLC
		expect(AGLC4.full(mnc, '12')).toBe('*Doe v Roe* [2021] NSWCA 77 [12]'); // VERIFY against AGLC
	});
	it('formats legislation with a section', () => {
		expect(AGLC4.full(act, '18')).toBe('*Imaginary Rights Act 2005* (Vic) s 18'); // VERIFY against AGLC
		expect(AGLC4.full(act, 'pt 3')).toBe('*Imaginary Rights Act 2005* (Vic) pt 3'); // VERIFY against AGLC
	});
	it('formats secondary sources', () => {
		expect(AGLC4.full(article, '305')).toBe('Alex Citizen and Sam Writer, ‘Thinking About Duty’ (2012) 36(2) *Example Law Review* 300, 305'); // VERIFY against AGLC
		expect(AGLC4.full(book, '45')).toBe('Kim Author, *Principles of Made-Up Law* (Example Press, 2nd ed, 2019) 45 (‘Principles’)'); // VERIFY against AGLC
	});
	it('reports missing fields', () => {
		expect(AGLC4.missing({ kind: 'case-mnc', fields: { name: 'X v Y' } })).toEqual(['Year', 'Court', 'Number']);
	});
});

describe('Ibid and (n X)', () => {
	const note = 'First.[^1] Second.[^2] Third.[^3] Here.\n\n[^1]: *Example v Commonwealth* (1999) 200 CLR 10, 12 (‘*Example*’).\n[^2]: *Imaginary Rights Act 2005* (Vic) s 4.\n[^3]: Ibid s 5.\n';
	const here = note.indexOf('Here');
	it('numbers footnotes by reference order', () => {
		expect(noteFootnotes(note).map((f) => [f.label, f.number])).toEqual([['1', 1], ['2', 2], ['3', 3]]);
	});
	it('uses Ibid after a footnote citing only the same source, through earlier Ibids', () => {
		expect(planCitation(AGLC4, note, here, act, '7')).toEqual({ form: 'ibid', body: 'Ibid s 7.' }); // VERIFY against AGLC
		expect(planCitation(AGLC4, note, here, act).body).toBe('Ibid.'); // VERIFY against AGLC
	});
	it('refers back with the short title and (n X)', () => {
		const r = planCitation(AGLC4, note, here, reported, '14');
		expect(r).toEqual({ form: 'subsequent', body: '*Example* (n 1) 14.', n: 1 }); // VERIFY against AGLC
	});
	it('cites in full the first time', () => {
		expect(planCitation(AGLC4, note, here, mnc, '3').body).toBe('*Doe v Roe* [2021] NSWCA 77 [3].'); // VERIFY against AGLC
	});
	it('refers back to secondary sources by surname', () => {
		const withArticle = 'A.[^1] B.[^2] C.\n\n[^1]: Alex Citizen and Sam Writer, ‘Thinking About Duty’ (2012) 36(2) *Example Law Review* 300.\n[^2]: *Doe v Roe* [2021] NSWCA 77.\n';
		expect(planCitation(AGLC4, withArticle, withArticle.indexOf('C.'), article, '310').body).toBe('Citizen and Writer (n 1) 310.'); // VERIFY against AGLC
	});
	it('places the reference at the cursor and the definition after the others', () => {
		const r = footnoteChanges(note, here, 'Ibid.');
		expect(r.label).toBe('4');
		expect(r.changes[0]).toEqual({ from: here, insert: '[^4]' });
		expect(r.changes[1]!.insert).toBe('\n[^4]: Ibid.\n');
		const empty = footnoteChanges('Text.', 5, 'X.');
		expect(empty.changes[1]!.insert).toBe('\n\n[^1]: X.\n');
	});
});
