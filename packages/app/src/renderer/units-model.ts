/**
 * Which folders are units: subjects (units) and the topics inside them. Kept by path in `.quire/units.json`
 * ({ "Torts": "subject", "Torts/Negligence": "topic" }); the folders themselves are untouched. Pure functions
 * here (paths only), tested on their own; the store that loads and saves them is units-store.ts.
 */

export type UnitKind = 'subject' | 'topic';
export type UnitTagMap = Record<string, UnitKind>;

/** Parse the file's JSON: unknown kinds and bad entries are dropped. */
export function parseUnitTags(json: string): UnitTagMap {
	const out: UnitTagMap = {};
	try {
		const data: unknown = JSON.parse(json);
		if (data && typeof data === 'object' && !Array.isArray(data)) {
			for (const [path, kind] of Object.entries(data as Record<string, unknown>)) {
				if (typeof path === 'string' && path && (kind === 'subject' || kind === 'topic')) out[path] = kind;
			}
		}
	} catch { /* an unreadable file means no tags */ }
	return out;
}

/** The nearest tagged folder above `path` (not `path` itself), or null. */
export function taggedParent(tags: UnitTagMap, path: string): string | null {
	const parts = path.split('/');
	for (let i = parts.length - 1; i > 0; i--) {
		const p = parts.slice(0, i).join('/');
		if (tags[p]) return p;
	}
	return null;
}

/** Tagged folders shown at the top of Units: those with no tagged folder above them. */
export function unitRoots(tags: UnitTagMap): string[] {
	return Object.keys(tags).filter((p) => taggedParent(tags, p) === null);
}

/** Tagged folders shown directly under `path`: those whose nearest tagged folder above is `path`. */
export function unitChildren(tags: UnitTagMap, path: string): string[] {
	return Object.keys(tags).filter((p) => p.startsWith(`${path}/`) && taggedParent(tags, p) === path);
}

/** After `from` was renamed or moved to `to`: tags on it and on folders inside it follow. */
export function renameUnitTags(tags: UnitTagMap, from: string, to: string): UnitTagMap {
	const out: UnitTagMap = {};
	for (const [p, k] of Object.entries(tags)) {
		if (p === from) out[to] = k;
		else if (p.startsWith(`${from}/`)) out[`${to}${p.slice(from.length)}`] = k;
		else out[p] = k;
	}
	return out;
}

/** After `path` was deleted: its tag and those of folders inside it go. */
export function deleteUnitTags(tags: UnitTagMap, path: string): UnitTagMap {
	const out: UnitTagMap = {};
	for (const [p, k] of Object.entries(tags)) if (p !== path && !p.startsWith(`${path}/`)) out[p] = k;
	return out;
}

/**
 * What tagging an existing homebase's folders would give, the way Units showed them before tags: each top folder a
 * subject, each folder directly inside one a topic. `folders` are every folder's path; `skip` are folders that are
 * not units (attachments, the archive, hidden ones).
 */
export function suggestedUnitTags(folders: string[], skip: (path: string) => boolean): UnitTagMap {
	const out: UnitTagMap = {};
	for (const p of folders) {
		if (skip(p) || p.split('/').some((part) => part.startsWith('.'))) continue;
		const depth = p.split('/').length;
		if (depth === 1) out[p] = 'subject';
		else if (depth === 2 && !skip(p.split('/')[0]!)) out[p] = 'topic';
	}
	return out;
}
