/** The sections of CHANGELOG.md, for "What's new" after an upgrade. Kept free of the DOM so it can be tested. */

export interface ChangelogSection {
	/** "0.26.0", or "Unreleased" for changes not in a release yet. */
	version: string;
	/** The section's Markdown, without its heading. */
	body: string;
}

/** Every "## vX.Y.Z" (and "## Unreleased") section, in the file's order: newest first. */
export function parseChangelog(text: string): ChangelogSection[] {
	const out: ChangelogSection[] = [];
	let current: ChangelogSection | null = null;
	for (const line of text.split(/\r?\n/)) {
		const head = /^## +(?:v(\d[\w.-]*)|(Unreleased))\s*$/.exec(line);
		if (head) {
			current = { version: head[1] ?? 'Unreleased', body: '' };
			out.push(current);
		}
		else if (/^## /.test(line)) current = null;
		else if (current) current.body += `${line}\n`;
	}
	for (const s of out) s.body = s.body.trim();
	return out.filter((s) => s.body);
}

/** Compare two versions like "0.25.4" (a "-beta.1" suffix sorts before the plain version). */
export function compareVersions(a: string, b: string): number {
	const parse = (v: string) => {
		const [main, pre = ''] = v.replace(/^v/, '').split('-', 2);
		return { nums: main.split('.').map((n) => Number.parseInt(n, 10) || 0), pre };
	};
	const x = parse(a);
	const y = parse(b);
	for (let i = 0; i < Math.max(x.nums.length, y.nums.length); i++) {
		const d = (x.nums[i] ?? 0) - (y.nums[i] ?? 0);
		if (d) return Math.sign(d);
	}
	if (x.pre === y.pre) return 0;
	if (!x.pre) return 1;
	if (!y.pre) return -1;
	return x.pre < y.pre ? -1 : 1;
}

/**
 * The sections a person upgrading from `from` to `to` hasn't seen: newer than `from`, up to `to`, newest first.
 * Without `from` (an upgrade from before versions were recorded) only `to`'s own section. "Unreleased" changes
 * come first when there are any (a build made between releases).
 */
export function changesSince(sections: ChangelogSection[], to: string, from?: string): ChangelogSection[] {
	return sections.filter((s) => {
		if (s.version === 'Unreleased') return true;
		if (compareVersions(s.version, to) > 0) return false;
		return from ? compareVersions(s.version, from) > 0 : compareVersions(s.version, to) === 0;
	});
}
