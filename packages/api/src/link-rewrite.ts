/**
 * Rewriting a link when the file it points to is renamed or moved. Pure, so it can be tested on its own:
 * `FileManager.renameFile` finds the links (from the metadata cache) and calls this for each.
 *
 * A link keeps the form it was written in: a bare name stays a bare name, a path stays a path (from the
 * homebase's top, or relative to the note when it was written that way), ".md" is written only when it
 * was, and a subpath (#heading, #^block), alias, size and a Markdown link's title are kept.
 */
import { normalizePath } from './util';

const WIKI = /^(!?\[\[)([^\]\n|]+?)((?:\|[^\]\n]*)?\]\])$/;
const MD = /^(!?\[[^\]\n]*\]\()([^)\s]+)((?:\s+"[^"]*")?\))$/;

function dirOf(path: string): string {
	const i = path.lastIndexOf('/');
	return i === -1 ? '' : path.slice(0, i);
}

function nameOf(path: string): string {
	return path.slice(path.lastIndexOf('/') + 1);
}

/** `to` written relative to the folder `fromDir`. */
function relative(fromDir: string, to: string): string {
	const a = fromDir ? fromDir.split('/') : [];
	const b = to.split('/');
	let i = 0;
	while (i < a.length && i < b.length - 1 && a[i] === b[i]) i++;
	return [...a.slice(i).map(() => '..'), ...b.slice(i)].join('/');
}

/** "a/./b/../c" as "a/c". */
function resolveDots(path: string): string {
	const out: string[] = [];
	for (const seg of path.split('/')) {
		if (seg === '..') out.pop();
		else if (seg !== '.') out.push(seg);
	}
	return out.join('/');
}

function splitSubpath(target: string): [string, string] {
	const i = target.search(/[#^]/);
	return i === -1 ? [target, ''] : [target.slice(0, i), target.slice(i)];
}

/** The new path text for a link whose path part was `written`, from the note at `sourcePath`. */
function newPathText(written: string, oldPath: string, newPath: string, sourcePath: string, oldSourcePath: string): string {
	const w = written.trim();
	const withExt = !oldPath.endsWith('.md') || /\.md$/i.test(w);
	const strip = (p: string) => (withExt ? p : p.replace(/\.md$/, ''));
	if (!w.includes('/')) return strip(nameOf(newPath));
	const lower = (p: string) => p.toLowerCase();
	const asWritten = normalizePath(w.replace(/^\//, ''));
	const fromNote = resolveDots(normalizePath(dirOf(oldSourcePath) ? `${dirOf(oldSourcePath)}/${w}` : w));
	const matches = (p: string) => lower(p) === lower(oldPath) || lower(`${p}.md`) === lower(oldPath);
	if (!w.startsWith('/') && (w.startsWith('.') || (!matches(asWritten) && matches(fromNote)))) {
		return strip(relative(dirOf(sourcePath), newPath));
	}
	return (w.startsWith('/') ? '/' : '') + strip(newPath);
}

/**
 * `original` (a `[[wikilink]]`, `![[embed]]`, `[text](path)` or `![](path)` in the note at `sourcePath`)
 * rewritten to point at `newPath` instead of `oldPath`. Returns `original` when it is not one of those.
 * `oldSourcePath` is where the note was when the link was written, if it moved too (a folder renamed).
 */
export function rewriteLink(original: string, oldPath: string, newPath: string, sourcePath: string, oldSourcePath = sourcePath): string {
	const wiki = WIKI.exec(original);
	if (wiki) {
		const [path, sub] = splitSubpath(wiki[2]!);
		return `${wiki[1]}${newPathText(path, oldPath, newPath, sourcePath, oldSourcePath)}${sub}${wiki[3]}`;
	}
	const md = MD.exec(original);
	if (md) {
		const raw = md[2]!;
		let decoded = raw;
		try { decoded = decodeURIComponent(raw); } catch { /* keep as written */ }
		const [path, sub] = splitSubpath(decoded);
		let next = newPathText(path, oldPath, newPath, sourcePath, oldSourcePath);
		// Written encoded ("My%20clip.mp4"), or with a character a Markdown link cannot hold bare: encode.
		if (raw !== decoded || /[\s()<>]/.test(next)) next = encodeURI(next).replace(/[()]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
		return `${md[1]}${next}${sub}${md[3]}`;
	}
	return original;
}

export interface LinkEdit { from: number; to: number; original: string; insert: string }

/**
 * `text` with each edit applied where its `original` still stands. An edit whose text has moved (the note
 * changed since it was indexed) is applied to every occurrence of its `original` instead.
 */
export function applyLinkEdits(text: string, edits: LinkEdit[]): string {
	let out = text;
	const moved: LinkEdit[] = [];
	for (const e of [...edits].sort((a, b) => b.from - a.from)) {
		if (out.slice(e.from, e.to) === e.original) out = out.slice(0, e.from) + e.insert + out.slice(e.to);
		else moved.push(e);
	}
	for (const e of moved) out = out.split(e.original).join(e.insert);
	return out;
}
