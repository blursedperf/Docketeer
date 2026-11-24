/**
 * Australian Guide to Legal Citation, 4th edition: written from the rules' general shape, not copied
 * from the guide. Fixtures in test/cite.test.ts are original and marked "VERIFY against AGLC".
 */
import type { CitationStyle, Source, SourceKindDef } from './types';

const JUR = ['Cth', 'NSW', 'Vic', 'Qld', 'WA', 'SA', 'Tas', 'ACT', 'NT'];

const KINDS: SourceKindDef[] = [
	{
		id: 'case-reported', label: 'Case (reported)', pinpoint: 'Page, e.g. 42',
		fields: [
			{ id: 'name', label: 'Case name', placeholder: 'Mabo v Queensland [No 2]', required: true },
			{ id: 'year', label: 'Year', placeholder: '1992', required: true },
			{ id: 'volume', label: 'Volume', placeholder: '175' },
			{ id: 'report', label: 'Report series', placeholder: 'CLR', required: true },
			{ id: 'page', label: 'First page', placeholder: '1', required: true },
			{ id: 'short', label: 'Short title', placeholder: 'Mabo' },
		],
	},
	{
		id: 'case-mnc', label: 'Case (medium neutral citation)', pinpoint: 'Paragraph, e.g. 12',
		fields: [
			{ id: 'name', label: 'Case name', placeholder: 'Smith v Jones', required: true },
			{ id: 'year', label: 'Year', placeholder: '2020', required: true },
			{ id: 'court', label: 'Court', placeholder: 'HCA', required: true },
			{ id: 'number', label: 'Number', placeholder: '5', required: true },
			{ id: 'short', label: 'Short title', placeholder: 'Smith' },
		],
	},
	{
		id: 'legislation', label: 'Legislation', pinpoint: 'Section, e.g. s 18',
		fields: [
			{ id: 'title', label: 'Title', placeholder: 'Competition and Consumer Act', required: true },
			{ id: 'year', label: 'Year', placeholder: '2010', required: true },
			{ id: 'jurisdiction', label: 'Jurisdiction', options: JUR, required: true },
			{ id: 'short', label: 'Short title', placeholder: 'CCA' },
		],
	},
	{
		id: 'article', label: 'Journal article', pinpoint: 'Page, e.g. 105',
		fields: [
			{ id: 'authors', label: 'Author(s)', placeholder: 'Jane Citizen; Sam Writer', required: true },
			{ id: 'title', label: 'Title', required: true },
			{ id: 'year', label: 'Year', required: true },
			{ id: 'volume', label: 'Volume' },
			{ id: 'issue', label: 'Issue' },
			{ id: 'journal', label: 'Journal', required: true },
			{ id: 'page', label: 'First page', required: true },
			{ id: 'short', label: 'Short title' },
		],
	},
	{
		id: 'book', label: 'Book', pinpoint: 'Page, e.g. 45',
		fields: [
			{ id: 'authors', label: 'Author(s)', placeholder: 'Kim Writer', required: true },
			{ id: 'title', label: 'Title', required: true },
			{ id: 'publisher', label: 'Publisher', required: true },
			{ id: 'edition', label: 'Edition', placeholder: '3' },
			{ id: 'year', label: 'Year', required: true },
			{ id: 'short', label: 'Short title' },
		],
	},
];

/** Report series organised by year, cited with the year in square brackets. VERIFY against AGLC. */
const YEAR_SERIES = new Set(['AC', 'QB', 'KB', 'Ch', 'WLR', 'All ER', 'Qd R', 'VR', 'NZLR']);

const f = (s: Source, k: string) => (s.fields[k] ?? '').trim();

function authors(raw: string): string[] {
	return raw.split(/\s*;\s*|\s+and\s+/).map((a) => a.trim()).filter(Boolean);
}

/** "A", "A and B", "A, B and C", "A et al". */
function authorList(raw: string): string {
	const a = authors(raw);
	if (a.length <= 1) return a[0] ?? '';
	if (a.length === 2) return `${a[0]} and ${a[1]}`;
	if (a.length === 3) return `${a[0]}, ${a[1]} and ${a[2]}`;
	return `${a[0]} et al`;
}

/** Surnames for later references: "Citizen", "Citizen and Writer", "Citizen et al". */
function surnames(raw: string): string {
	const last = (n: string) => n.split(/\s+/).pop() ?? n;
	const a = authors(raw).map(last);
	if (a.length <= 1) return a[0] ?? '';
	if (a.length === 2) return `${a[0]} and ${a[1]}`;
	if (a.length === 3) return `${a[0]}, ${a[1]} and ${a[2]}`;
	return `${a[0]} et al`;
}

function ordinal(n: string): string {
	const x = Number.parseInt(n, 10);
	if (!Number.isFinite(x)) return n;
	const t = x % 100;
	const suffix = t >= 11 && t <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[x % 10] ?? 'th';
	return `${x}${suffix}`;
}

/** The pinpoint as it follows the citation: ", 42", ", [12]", " s 18", " 45". */
function pinpoint(s: Source, pin: string | undefined, after: 'full' | 'short'): string {
	const p = (pin ?? '').trim();
	if (!p) return '';
	switch (s.kind) {
		case 'case-reported': return after === 'full' ? `, ${p}` : ` ${p}`;
		case 'case-mnc': { const para = /^\d+(?:[–-]\d+)?$/.test(p) ? `[${p.replace('-', '–')}]` : p; return after === 'full' ? ` ${para}` : ` ${para}`; }
		case 'legislation': return ` ${/^\d/.test(p) ? `s ${p}` : p}`;
		case 'article': return after === 'full' ? `, ${p}` : ` ${p}`;
		case 'book': return ` ${p}`;
	}
}

function stem(s: Source): string {
	switch (s.kind) {
		case 'case-reported': {
			const vol = f(s, 'volume');
			const year = YEAR_SERIES.has(f(s, 'report')) || !vol ? `[${f(s, 'year')}]` : `(${f(s, 'year')})`;
			return `*${f(s, 'name')}* ${year}${vol ? ` ${vol}` : ''} ${f(s, 'report')} ${f(s, 'page')}`;
		}
		case 'case-mnc': return `*${f(s, 'name')}* [${f(s, 'year')}] ${f(s, 'court')} ${f(s, 'number')}`;
		case 'legislation': return `*${f(s, 'title')} ${f(s, 'year')}* (${f(s, 'jurisdiction')})`;
		case 'article': {
			const vol = f(s, 'volume');
			const issue = f(s, 'issue');
			return `${authorList(f(s, 'authors'))}, ‘${f(s, 'title')}’ (${f(s, 'year')})${vol ? ` ${vol}` : ''}${issue ? `(${issue})` : ''} *${f(s, 'journal')}* ${f(s, 'page')}`;
		}
		case 'book': {
			const ed = f(s, 'edition');
			return `${authorList(f(s, 'authors'))}, *${f(s, 'title')}* (${f(s, 'publisher')}, ${ed ? `${ordinal(ed)} ed, ` : ''}${f(s, 'year')})`;
		}
	}
}

/** Short title definition: cases and legislation in italics, secondary sources plain. */
function defineShort(s: Source): string {
	const short = f(s, 'short');
	if (!short) return '';
	return s.kind === 'article' || s.kind === 'book' ? ` (‘${short}’)` : ` (‘*${short}*’)`;
}

function shortForm(s: Source): string {
	const short = f(s, 'short');
	switch (s.kind) {
		case 'case-reported':
		case 'case-mnc': return `*${short || f(s, 'name')}*`;
		case 'legislation': return short ? `*${short}*` : `*${f(s, 'title')} ${f(s, 'year')}*`;
		case 'article':
		case 'book': return short ? `${surnames(f(s, 'authors'))}, ‘${short}’` : surnames(f(s, 'authors'));
	}
}

export const AGLC4: CitationStyle = {
	id: 'aglc4',
	name: 'AGLC 4th edition',
	kinds: KINDS,
	stem,
	shortForm,
	full(s, pin) {
		// The short title follows the pinpoint for cases ("1, 42 ('Mabo')"). VERIFY against AGLC.
		return `${stem(s)}${pinpoint(s, pin, 'full')}${defineShort(s)}`;
	},
	subsequent(s, n, pin) {
		// Legislation is referred to by its (short) title, without "(n X)". VERIFY against AGLC.
		if (s.kind === 'legislation') return `${shortForm(s)}${pinpoint(s, pin, 'short')}`;
		return `${shortForm(s)} (n ${n})${pinpoint(s, pin, 'short')}`;
	},
	ibid(s, pin) {
		const p = pinpoint(s, pin, 'short').trim();
		return p ? `Ibid ${p}` : 'Ibid';
	},
	missing(s) {
		const kind = KINDS.find((k) => k.id === s.kind);
		return (kind?.fields ?? []).filter((d) => d.required && !f(s, d.id)).map((d) => d.label);
	},
};
