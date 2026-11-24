/** Text helpers for the PDF view, kept apart so they can be tested without a page. */

/** The page in a link subpath ("#page=12"), or null. */
export function pageFromSubpath(subpath: string): number | null {
	const m = /^#page=(\d+)/.exec(subpath.trim());
	return m && Number(m[1]) > 0 ? Number(m[1]) : null;
}

/** Selected text as one line: words split across lines joined, hyphenation at line ends removed. */
export function cleanSelection(text: string): string {
	return text.replace(/(\w)-\s*\n\s*(?=[a-z])/g, '$1').replace(/\s+/g, ' ').trim();
}
