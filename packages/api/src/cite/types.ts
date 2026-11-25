/**
 * Citation styles: one formatter per edition (AGLC4 first), behind one interface, so a later edition is
 * another file, not a rewrite. Output is Markdown (*italic*), ready for a footnote.
 */

export type SourceKind = 'case-reported' | 'case-mnc' | 'legislation' | 'article' | 'book' | 'report' | 'pc-report' | 'law-reform' | 'web' | 'treaty';

export interface FieldDef {
	id: string;
	label: string;
	placeholder?: string;
	required?: boolean;
	/** A short list to choose from (jurisdictions). */
	options?: string[];
}

export interface SourceKindDef { id: SourceKind; label: string; fields: FieldDef[]; pinpoint: string }

export interface Source { kind: SourceKind; fields: Record<string, string> }

export interface CitationStyle {
	id: string;
	name: string;
	kinds: SourceKindDef[];
	/** The first citation, with a short title defined if one is given. No final full stop. */
	full(s: Source, pin?: string): string;
	/** The full citation without pinpoint or short title: what an earlier footnote would contain. */
	stem(s: Source): string;
	/** A later citation, referring back to footnote `n`. */
	subsequent(s: Source, n: number, pin?: string): string;
	/** The next citation of the same source, straight after. */
	ibid(s: Source, pin?: string): string;
	/** What a later footnote starts with when it cites this source again (to follow Ibid chains). */
	shortForm(s: Source): string;
	/** Missing required fields, by label. */
	missing(s: Source): string[];
}
