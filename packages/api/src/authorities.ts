/**
 * Authorities in a note: cases, legislation and secondary sources, found in the text and footnotes.
 * Pure (no DOM, no files), so it is unit-tested. Detection is pattern-based and errs towards finding
 * things: anything without a citation to back it is marked unconfirmed, for the user to confirm or merge.
 */

export type AuthorityKind = 'case' | 'legislation' | 'secondary';
export const JURISDICTIONS = ['Cth', 'NSW', 'Vic', 'Qld', 'WA', 'SA', 'Tas', 'ACT', 'NT'] as const;
export type Jurisdiction = (typeof JURISDICTIONS)[number];

export interface Occurrence { from: number; to: number; inFootnote: boolean }

export interface Authority {
	/** Stable within a note and across notes: the kind and the normalised name. */
	key: string;
	kind: AuthorityKind;
	/** As written: "Mabo v Queensland [No 2]", "Competition and Consumer Act 2010", "Torts". */
	name: string;
	/** Citations seen with it: "(1992) 175 CLR 1", "[2020] HCA 5", "(Cth)". */
	citations: string[];
	jurisdiction?: Jurisdiction;
	/** Sections and other pinpoints referred to with legislation ("s 18", "pt 4"). */
	sections: string[];
	/** Short titles defined for it ("Mabo"); their later uses count as occurrences. */
	aliases: string[];
	occurrences: Occurrence[];
	/** False when only a bare name was found (no citation, not confirmed by the user). */
	confirmed: boolean;
	/** For secondary sources: the author(s) as written. */
	author?: string;
}

/** What the user decided about unsure finds: confirmed keys, and keys merged into others. */
export interface AuthorityDecisions { confirmed?: string[]; merges?: Record<string, string> }

/** Courts (from medium neutral citations) and report series, by jurisdiction. */
const COURTS: Record<string, Jurisdiction> = {
	HCA: 'Cth', FCA: 'Cth', FCAFC: 'Cth', FamCA: 'Cth', FamCAFC: 'Cth', FedCFamC1A: 'Cth', FedCFamC1F: 'Cth', FedCFamC2F: 'Cth', AATA: 'Cth', ARTA: 'Cth', FCCA: 'Cth',
	NSWSC: 'NSW', NSWCA: 'NSW', NSWCCA: 'NSW', NSWLEC: 'NSW', NSWDC: 'NSW', NSWCATAD: 'NSW',
	VSC: 'Vic', VSCA: 'Vic', VCC: 'Vic', VCAT: 'Vic',
	QSC: 'Qld', QCA: 'Qld', QDC: 'Qld', QCAT: 'Qld',
	WASC: 'WA', WASCA: 'WA', WADC: 'WA', WASAT: 'WA',
	SASC: 'SA', SASCFC: 'SA', SASCA: 'SA', SADC: 'SA',
	TASSC: 'Tas', TASFC: 'Tas', TASCCA: 'Tas',
	ACTSC: 'ACT', ACTCA: 'ACT',
	NTSC: 'NT', NTCA: 'NT', NTCCA: 'NT',
};
const REPORTS: Record<string, Jurisdiction> = {
	CLR: 'Cth', FCR: 'Cth', FLR: 'Cth', ALJR: 'Cth', 'Fam LR': 'Cth',
	NSWLR: 'NSW', SR: 'NSW', VR: 'Vic', 'Qd R': 'Qld', WAR: 'WA', SASR: 'SA', 'Tas R': 'Tas', ACTR: 'ACT', NTR: 'NT', NTLR: 'NT',
};

const NAME_WORD = String.raw`(?:[A-Z][\w'’&.()-]*|of|the|and|for|de|van|von|du|la|le)`;
const NO = String.raw`(?: \[No \d+\])?`;
const CASE = new RegExp(String.raw`${NAME_WORD}(?: ${NAME_WORD}){0,7} v ${NAME_WORD}(?: ${NAME_WORD}){0,7}${NO}`, 'g');
/** [2020] HCA 5 */
const MNC = /\[(\d{4})\]\s+([A-Z][A-Za-z0-9]*[A-Z][A-Za-z0-9]*)\s+(\d+)/y;
/** (1992) 175 CLR 1, [1932] AC 562, [1987] 2 Qd R 1 */
const REPORT = /(?:\((\d{4})\)\s+(\d+)|\[(\d{4})\](?:\s+(\d+))?)\s+([A-Z][A-Za-z]*(?: [A-Z][A-Za-z]*)?)\s+(\d+)/y;
const LEAD = new Set(['In', 'See', 'Cf', 'Also', 'But', 'And', 'As', 'Following', 'Unlike', 'Like', 'Under', 'Applying', 'Compare', 'Contra', 'Since', 'After', 'Before', 'Per', 'The', 'Then', 'When', 'While', 'Although', 'Here', 'Thus', 'This', 'That', 'Both', 'Neither', 'Either', 'Unless', 'If']);
const LEG = new RegExp(String.raw`((?:[A-Z][\w'’-]*|of|and|the|for|to|in|on|\([A-Z][A-Za-z ]+\))(?: (?:[A-Z][\w'’-]*|of|and|the|for|to|in|on|\([A-Z][A-Za-z ]+\))){0,10} (?:Act|Regulations?|Rules|Code|Ordinance|Constitution))(?: (\d{4}))?(?:\s*\((${JURISDICTIONS.join('|')})\))?`, 'g');
const SECTIONS = /\s*,?\s*((?:ss?|pts?|divs?|schs?|rr?|cls?|regs?)\s+[\dA-Z][\w().–-]*(?:(?:,\s*|\s+and\s+|–|-)[\dA-Z][\w().–-]*)*)/y;
const JOURNAL = /([^,;:\[\]^]{2,80}?), ['‘]([^'’]{3,200})['’] \((\d{4})\) (\d+)(?:\((\d+)\))? \*?([A-Z][^*\d]{2,80}?)\*? (\d+)/g;
/** Author, *Title* (Publisher, 3rd ed, 2015); the asterisks are blanked to spaces before matching. */
const BOOK = /([^,;:\[\]^]{2,80}?), +([^,()]{3,200}?) +\(([^,()]{2,80}), (?:([0-9]+(?:st|nd|rd|th)) ed, )?(\d{4})\)/g;
const SHORT = /\s*\((?:['‘]\*?([^'’*]{2,60})\*?['’])\)/y;

/** Same text with code, comments and frontmatter blanked out (offsets kept), and footnote spans. */
function prepare(text: string): { clean: string; footnotes: [number, number][] } {
	let clean = text;
	const blank = (from: number, to: number) => { clean = clean.slice(0, from) + clean.slice(from, to).replace(/[^\n]/g, ' ') + clean.slice(to); };
	const fm = /^---\n[\s\S]*?\n---(?:\n|$)/.exec(text);
	if (fm) blank(0, fm[0].length);
	for (const m of text.matchAll(/```[\s\S]*?```|`[^`\n]*`|%%[\s\S]*?%%|<!--[\s\S]*?-->/g)) blank(m.index, m.index + m[0].length);
	// Emphasis markers would split names ("*Mabo* v Queensland"); blank them too.
	clean = clean.replace(/[*_]/g, ' ');
	const footnotes: [number, number][] = [];
	for (const m of clean.matchAll(/^ {0,3}\[\^[^\]\n]+\]:[^\n]*(?:\n(?: {4}|\t)[^\n]*)*/gm)) footnotes.push([m.index, m.index + m[0].length]);
	for (const m of clean.matchAll(/\^\[[^\]\n]*\]/g)) footnotes.push([m.index, m.index + m[0].length]);
	return { clean, footnotes };
}

export function normaliseName(name: string): string {
	return name.toLowerCase().replace(/[‘’']/g, "'").replace(/\s+/g, ' ').trim();
}

/** Find the authorities in `text`, in order of first appearance. */
export function findAuthorities(text: string, decisions: AuthorityDecisions = {}): Authority[] {
	const { clean, footnotes } = prepare(text);
	const inFn = (at: number) => footnotes.some(([a, b]) => at >= a && at < b);
	const byKey = new Map<string, Authority>();
	const add = (kind: AuthorityKind, name: string, from: number, to: number, extra: Partial<Authority> = {}) => {
		const key = `${kind}:${normaliseName(name)}`;
		let a = byKey.get(key);
		if (!a) {
			a = { key, kind, name, citations: [], sections: [], aliases: [], occurrences: [], confirmed: false };
			byKey.set(key, a);
		}
		for (const c of extra.citations ?? []) if (!a.citations.includes(c)) a.citations.push(c);
		for (const s of extra.sections ?? []) if (!a.sections.includes(s)) a.sections.push(s);
		for (const s of extra.aliases ?? []) if (!a.aliases.includes(s)) a.aliases.push(s);
		if (extra.jurisdiction && !a.jurisdiction) a.jurisdiction = extra.jurisdiction;
		if (extra.author && !a.author) a.author = extra.author;
		if (extra.confirmed) a.confirmed = true;
		if (!a.occurrences.some((o) => o.from === from)) a.occurrences.push({ from, to, inFootnote: inFn(from) });
		return a;
	};
	const shortAfter = (at: number): { alias: string; end: number } | null => {
		SHORT.lastIndex = at;
		const m = SHORT.exec(clean);
		return m ? { alias: m[1]!.trim(), end: SHORT.lastIndex } : null;
	};

	// Cases, with any citation that follows.
	for (const m of clean.matchAll(CASE)) {
		const words = m[0].split(' ');
		let from = m.index;
		while (words.length > 3 && LEAD.has(words[0]!)) from += words.shift()!.length + 1;
		while (words.length > 3 && /^(?:of|the|and|for)$/.test(words[words.length - 1]!)) words.pop();
		const name = words.join(' ');
		if (!/ v /.test(name) || name.startsWith('v ')) continue;
		let end = from + name.length;
		const citations: string[] = [];
		let jurisdiction: Jurisdiction | undefined;
		for (;;) {
			const at = end + (/^[\s,]*/.exec(clean.slice(end))?.[0].length ?? 0);
			MNC.lastIndex = at;
			const mn = MNC.exec(clean);
			if (mn) { citations.push(`[${mn[1]}] ${mn[2]} ${mn[3]}`); jurisdiction ??= COURTS[mn[2]!]; end = MNC.lastIndex; continue; }
			REPORT.lastIndex = at;
			const rp = REPORT.exec(clean);
			if (rp) {
				const series = rp[5]!;
				citations.push(rp[1] ? `(${rp[1]}) ${rp[2]} ${series} ${rp[6]}` : `[${rp[3]}]${rp[4] ? ` ${rp[4]}` : ''} ${series} ${rp[6]}`);
				jurisdiction ??= REPORTS[series];
				end = REPORT.lastIndex;
				continue;
			}
			break;
		}
		const short = shortAfter(end + (/^,?\s*(?:\d+(?:–\d+)?|\[\d+\](?:–\[\d+\])?)?/.exec(clean.slice(end))?.[0].length ?? 0));
		add('case', name, from, from + name.length, { citations, jurisdiction, confirmed: citations.length > 0, aliases: short ? [short.alias] : [] });
	}

	// Legislation: a title ending in Act, Regulations …, with the year and jurisdiction when given.
	for (const m of clean.matchAll(LEG)) {
		const words = m[1]!.split(' ');
		let from = m.index;
		while (words.length > 1 && (LEAD.has(words[0]!) || /^(?:of|and|the|for|to|in|on)$/.test(words[0]!))) from += words.shift()!.length + 1;
		if (words.length < 2 && words[0] !== 'Constitution') continue;
		const title = words.join(' ');
		const year = m[2];
		const jur = m[3] as Jurisdiction | undefined;
		const name = year ? `${title} ${year}` : title;
		let end = m.index + m[0].length;
		SECTIONS.lastIndex = end;
		const sec = SECTIONS.exec(clean);
		const sections = sec ? [sec[1]!.replace(/\s+/g, ' ').replace(/[.,]+$/, '')] : [];
		if (sec) end = SECTIONS.lastIndex;
		const short = shortAfter(end);
		add('legislation', name, from, m.index + m[0].length, {
			citations: jur ? [`(${jur})`] : [], jurisdiction: jur, sections, confirmed: !!(year && jur), aliases: short ? [short.alias] : [],
		});
	}

	// Secondary sources, in footnotes: journal articles and books.
	for (const [a, b] of footnotes) {
		const fn = clean.slice(a, b).replace(/^ {0,3}\[\^[^\]\n]+\]:\s*|^\^\[/, (s) => ' '.repeat(s.length));
		for (const m of fn.matchAll(JOURNAL)) {
			const author = m[1]!.trim();
			const title = m[2]!.trim();
			const from = a + m.index + m[0].indexOf(m[2]!);
			const short = shortAfter(a + m.index + m[0].length + (/^,? ?[\d–-]*/.exec(fn.slice(m.index + m[0].length))?.[0].length ?? 0));
			add('secondary', title, from, from + title.length, { author, citations: [`(${m[3]}) ${m[4]}${m[5] ? `(${m[5]})` : ''} ${m[6]!.trim()} ${m[7]}`], confirmed: true, aliases: short ? [short.alias] : [] });
		}
		for (const m of fn.matchAll(BOOK)) {
			const author = m[1]!.trim();
			const title = m[2]!.trim();
			const from = a + m.index + m[0].indexOf(m[2]!);
			add('secondary', title, from, from + title.length, { author, citations: [`(${m[3]}${m[4] ? `, ${m[4]} ed` : ''}, ${m[5]})`], confirmed: true });
		}
	}

	// Later uses of short titles ("Mabo") count as occurrences, unless inside another find (an article
	// titled "Title After Mabo" is not a citation of the case).
	const spans = [...byKey.values()].flatMap((x) => x.occurrences.map((o) => [o.from, o.to, x] as const));
	for (const auth of byKey.values()) {
		for (const alias of auth.aliases) {
			const re = new RegExp(String.raw`(?<![\p{L}\p{N}])${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\p{L}\p{N}])`, 'gu');
			for (const m of clean.matchAll(re)) {
				if (auth.occurrences.some((o) => m.index >= o.from && m.index < o.to + 60)) continue;
				if (spans.some(([f, t, other]) => other !== auth && m.index >= f && m.index < t)) continue;
				auth.occurrences.push({ from: m.index, to: m.index + alias.length, inFootnote: inFn(m.index) });
			}
		}
		auth.occurrences.sort((x, y) => x.from - y.from);
	}

	// The user's decisions: confirmations, and merges of one find into another.
	const merges = decisions.merges ?? {};
	for (const [from, into] of Object.entries(merges)) {
		const src = byKey.get(from);
		const dst = byKey.get(into);
		if (!src || !dst || src === dst) continue;
		dst.occurrences = [...dst.occurrences, ...src.occurrences].sort((x, y) => x.from - y.from);
		for (const c of src.citations) if (!dst.citations.includes(c)) dst.citations.push(c);
		byKey.delete(from);
	}
	for (const k of decisions.confirmed ?? []) { const a = byKey.get(k); if (a) a.confirmed = true; }
	return [...byKey.values()].sort((x, y) => (x.occurrences[0]?.from ?? 0) - (y.occurrences[0]?.from ?? 0));
}

/** The next occurrence after `pos` (wrapping to the first). */
export function nextOccurrence(a: Authority, pos: number): Occurrence | null {
	if (!a.occurrences.length) return null;
	return a.occurrences.find((o) => o.from > pos) ?? a.occurrences[0]!;
}
