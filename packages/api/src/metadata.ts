import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { Events, type EventRef } from './events';
import { TFile, TFolder, type TAbstractFile } from './files';
import type { App } from './app';
import { attachmentFolder, availablePath, safeFileName } from './attachments';
import { errorSummary, normalizePath } from './util';
import { LockedError } from './lock/service';
import { type LinkEdit, applyLinkEdits, rewriteLink } from './link-rewrite';

export interface Loc { line: number; col: number; offset: number; }
export interface Pos { start: Loc; end: Loc; }
export interface CacheItem { position: Pos; }
export interface HeadingCache extends CacheItem { heading: string; level: number; }
export interface ReferenceCache extends CacheItem { link: string; original: string; displayText?: string; }
export type LinkCache = ReferenceCache;
export type EmbedCache = ReferenceCache;
export interface FootnoteCache extends CacheItem { id: string; }
export interface FootnoteRefCache extends CacheItem { id: string; }
export interface TagCache extends CacheItem { tag: string; }
export type FrontMatterCache = Record<string, any>;

export interface CachedMetadata {
	frontmatter?: FrontMatterCache;
	frontmatterPosition?: Pos;
	headings?: HeadingCache[];
	links?: LinkCache[];
	embeds?: EmbedCache[];
	tags?: TagCache[];
	footnotes?: FootnoteCache[];
	footnoteRefs?: FootnoteRefCache[];
}

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n?---[ \t]*(?:\r?\n|$)/;

/** Split a note into its YAML frontmatter (without the fences) and the rest. */
export function splitFrontMatter(text: string): { yaml: string | null; body: string; end: number } {
	const m = FRONTMATTER.exec(text);
	if (!m) return { yaml: null, body: text, end: 0 };
	return { yaml: m[1] ?? '', body: text.slice(m[0].length), end: m[0].length };
}

/** The kind of value a property holds, which decides its field: a list, a checkbox, a number, a date or text. */
export type PropertyType = 'list' | 'checkbox' | 'number' | 'date' | 'text';

export function propertyType(v: unknown): PropertyType {
	if (Array.isArray(v)) return 'list';
	if (typeof v === 'boolean') return 'checkbox';
	if (typeof v === 'number') return 'number';
	if (v instanceof Date || (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v))) return 'date';
	return 'text';
}

export function parseFrontMatter(text: string): FrontMatterCache | undefined {
	const { yaml } = splitFrontMatter(text);
	if (yaml === null) return undefined;
	try {
		const v: unknown = parseYaml(yaml);
		return v && typeof v === 'object' && !Array.isArray(v) ? (v as FrontMatterCache) : {};
	} catch {
		return undefined;
	}
}

export function parseYamlSafe(text: string): unknown {
	return parseYaml(text);
}
export { stringifyYaml };

/** Index of line starts, for offset to line/column. */
function lineStarts(text: string): number[] {
	const starts = [0];
	for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1);
	return starts;
}

function locator(text: string) {
	const starts = lineStarts(text);
	return (offset: number): Loc => {
		let lo = 0;
		let hi = starts.length - 1;
		while (lo < hi) {
			const mid = (lo + hi + 1) >> 1;
			if (starts[mid]! <= offset) lo = mid; else hi = mid - 1;
		}
		return { line: lo, col: offset - starts[lo]!, offset };
	};
}

/** Offsets covered by fenced code blocks and inline code, which hold no links, tags or footnotes. */
function codeRanges(text: string): [number, number][] {
	const ranges: [number, number][] = [];
	const fence = /^( {0,3})(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:\n\1\2[`~]*[ \t]*(?=\n|$)|$)/gm;
	for (let m = fence.exec(text); m; m = fence.exec(text)) ranges.push([m.index, m.index + m[0].length]);
	const inline = /(`+)[^`\n]+?\1/g;
	for (let m = inline.exec(text); m; m = inline.exec(text)) ranges.push([m.index, m.index + m[0].length]);
	return ranges;
}

/** Parse a note's metadata. */
export function parseMetadata(text: string): CachedMetadata {
	const at = locator(text);
	const pos = (from: number, to: number): Pos => ({ start: at(from), end: at(to) });
	const meta: CachedMetadata = {};
	const fm = splitFrontMatter(text);
	if (fm.yaml !== null) {
		meta.frontmatter = parseFrontMatter(text);
		meta.frontmatterPosition = pos(0, fm.end);
	}
	const code = codeRanges(text);
	const inCode = (i: number) => i < fm.end || code.some(([a, b]) => i >= a && i < b);

	const headings: HeadingCache[] = [];
	const hre = /^(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/gm;
	for (let m = hre.exec(text); m; m = hre.exec(text)) {
		if (inCode(m.index)) continue;
		headings.push({ heading: m[2] ?? '', level: m[1]!.length, position: pos(m.index, m.index + m[0].length) });
	}
	if (headings.length) meta.headings = headings;

	const links: LinkCache[] = [];
	const embeds: EmbedCache[] = [];
	const wre = /(!?)\[\[([^\]\n|]+?)(?:\|([^\]\n]*))?\]\]/g;
	for (let m = wre.exec(text); m; m = wre.exec(text)) {
		if (inCode(m.index)) continue;
		const item = { link: (m[2] ?? '').trim(), original: m[0], displayText: m[3] ?? m[2], position: pos(m.index, m.index + m[0].length) };
		(m[1] ? embeds : links).push(item);
	}
	const mre = /(!?)\[([^\]\n]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
	for (let m = mre.exec(text); m; m = mre.exec(text)) {
		if (inCode(m.index)) continue;
		const target = m[3] ?? '';
		if (/^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
		let link = target;
		try { link = decodeURIComponent(target); } catch { /* keep as written */ }
		const item = { link, original: m[0], displayText: m[2], position: pos(m.index, m.index + m[0].length) };
		(m[1] ? embeds : links).push(item);
	}
	if (links.length) meta.links = links;
	if (embeds.length) meta.embeds = embeds;

	const tags: TagCache[] = [];
	const tre = /(^|[\s(])#([\p{L}\p{N}_/-]*[\p{L}_/-][\p{L}\p{N}_/-]*)/gu;
	for (let m = tre.exec(text); m; m = tre.exec(text)) {
		const start = m.index + (m[1]?.length ?? 0);
		if (inCode(start)) continue;
		tags.push({ tag: `#${m[2]}`, position: pos(start, start + 1 + (m[2]?.length ?? 0)) });
	}
	if (tags.length) meta.tags = tags;

	const footnotes: FootnoteCache[] = [];
	const refs: FootnoteRefCache[] = [];
	const fre = /\[\^([^\]\s]+)\](:)?/g;
	for (let m = fre.exec(text); m; m = fre.exec(text)) {
		if (inCode(m.index)) continue;
		const lineStart = text.lastIndexOf('\n', m.index - 1) + 1;
		const isDef = m[2] === ':' && /^ {0,3}$/.test(text.slice(lineStart, m.index));
		const item = { id: m[1] ?? '', position: pos(m.index, m.index + m[0].length) };
		(isDef ? footnotes : refs).push(item);
	}
	if (footnotes.length) meta.footnotes = footnotes;
	if (refs.length) meta.footnoteRefs = refs;
	return meta;
}

/** Tags from the frontmatter and the text, with "#". */
export function getAllTags(cache: CachedMetadata): string[] | null {
	const out = new Set<string>();
	const fmTags = cache.frontmatter?.tags ?? cache.frontmatter?.tag;
	const list = Array.isArray(fmTags) ? fmTags : typeof fmTags === 'string' ? fmTags.split(/[,\s]+/) : [];
	for (const t of list) if (t) out.add(`#${String(t).replace(/^#/, '')}`);
	for (const t of cache.tags ?? []) out.add(t.tag);
	return out.size ? [...out] : null;
}

/** Split "Note#Heading" into its path and subpath. */
export function parseLinktext(linktext: string): { path: string; subpath: string } {
	const i = linktext.search(/[#^]/);
	return i === -1 ? { path: linktext, subpath: '' } : { path: linktext.slice(0, i), subpath: linktext.slice(i) };
}

/**
 * Metadata of every Markdown note: frontmatter, headings, links, tags, footnotes. Kept current as notes
 * change; `changed` fires with (file, text, cache) after each change.
 */
export class MetadataCache extends Events {
	private caches = new Map<string, CachedMetadata>();
	resolvedLinks: Record<string, Record<string, number>> = {};
	unresolvedLinks: Record<string, Record<string, number>> = {};
	private ready = false;

	/** Files by lowercased name ("note.md" and, for notes, "note"), for resolving links without a scan. */
	private byName: Map<string, TFile[]> | null = null;

	constructor(private app: App) {
		super();
		const stale = () => { this.byName = null; };
		app.vault.on('create', stale);
		app.vault.on('delete', stale);
		app.vault.on('rename', stale);
	}

	private filesNamed(name: string): TFile[] {
		if (!this.byName) {
			this.byName = new Map();
			const add = (k: string, f: TFile) => { const l = this.byName!.get(k); if (l) l.push(f); else this.byName!.set(k, [f]); };
			for (const f of this.app.vault.getFiles()) {
				add(f.name.toLowerCase(), f);
				if (f.extension === 'md') add(f.basename.toLowerCase(), f);
			}
		}
		return this.byName.get(name) ?? [];
	}

	async indexAll(): Promise<void> {
		const { vault } = this.app;
		const files = vault.getMarkdownFiles();
		const batch = 32;
		for (let i = 0; i < files.length; i += batch) {
			await Promise.all(files.slice(i, i + batch).map(async (f) => {
				try { this.caches.set(f.path, parseMetadata(await vault.cachedRead(f))); } catch (e) {
					// A locked note while locked: known by name only, nothing parsed.
					if (e instanceof LockedError) this.caches.set(f.path, parseMetadata(''));
					else console.error('Could not index a note:', errorSummary(e));
				}
			}));
		}
		for (const f of files) this.resolveLinksOf(f);
		// A new file can be what other notes' unresolved links pointed to: resolve everything again (cheap
		// now that files are found by name). Backlinks rely on resolvedLinks being current.
		vault.on('create', (f) => { if (f instanceof TFile && f.extension === 'md') void this.update(f).then(() => this.resolveAll()); else this.resolveAll(); });
		vault.on('modify', (f) => { if (f instanceof TFile && f.extension === 'md') void this.update(f); });
		vault.on('delete', (f) => {
			this.caches.delete(f.path);
			delete this.resolvedLinks[f.path];
			delete this.unresolvedLinks[f.path];
			this.trigger('deleted', f, null);
			this.resolveAll();
		});
		vault.on('rename', (f, old: string) => {
			const c = this.caches.get(old);
			if (c) { this.caches.delete(old); this.caches.set(f.path, c); }
			this.resolveAll();
		});
		this.ready = true;
		this.trigger('resolved');
	}

	get initialized(): boolean { return this.ready; }

	/** Re-parse from `text` (the editor's) or from disk. */
	async update(file: TFile, text?: string): Promise<void> {
		let data: string;
		try {
			data = text ?? await this.app.vault.cachedRead(file);
		} catch (e) {
			if (!(e instanceof LockedError)) throw e;
			data = ''; // locked: nothing of it is kept
		}
		const cache = parseMetadata(data);
		this.caches.set(file.path, cache);
		this.resolveLinksOf(file);
		this.trigger('changed', file, data, cache);
		this.trigger('resolve', file);
		this.trigger('resolved');
	}

	getFileCache(file: TFile | null): CachedMetadata | null {
		return file ? this.caches.get(file.path) ?? null : null;
	}

	getCache(path: string): CachedMetadata | null {
		return this.caches.get(normalizePath(path)) ?? null;
	}

	/** The file a link points to, from the note at `sourcePath`. */
	getFirstLinkpathDest(linkpath: string, sourcePath: string): TFile | null {
		const { vault } = this.app;
		let target = normalizePath(linkpath.trim());
		if (target === '/' || target === '') return vault.getFileByPath(sourcePath);
		const dir = sourcePath.includes('/') ? sourcePath.slice(0, sourcePath.lastIndexOf('/')) : '';
		const candidates = [target, `${target}.md`];
		if (dir) candidates.unshift(normalizePath(`${dir}/${target}`), normalizePath(`${dir}/${target}.md`));
		for (const c of candidates) {
			const f = vault.getFileByPath(c);
			if (f) return f;
		}
		// Anywhere in the homebase: the file with that name (and trailing folders, if given) and the shortest path.
		const name = target.toLowerCase();
		const last = name.slice(name.lastIndexOf('/') + 1);
		let best: TFile | null = null;
		for (const f of this.filesNamed(last)) {
			const p = f.path.toLowerCase();
			const matches = p === name || p === `${name}.md` || p.endsWith(`/${name}`) || p.endsWith(`/${name}.md`);
			if (matches && (!best || f.path.length < best.path.length)) best = f;
		}
		return best;
	}

	fileToLinktext(file: TFile, sourcePath: string, omitMdExtension = true): string {
		const unique = this.app.vault.getFiles().filter((f) => f.basename === file.basename).length === 1;
		const base = unique ? file.name : file.path;
		void sourcePath;
		return omitMdExtension && file.extension === 'md' ? base.replace(/\.md$/, '') : base;
	}

	/**
	 * The properties used in the homebase's notes: each name with how many notes use it and the kind of value
	 * it usually holds, most used first. For suggesting names and choosing a new property's field.
	 */
	getPropertyKeys(): { key: string; count: number; type: PropertyType }[] {
		const seen = new Map<string, { count: number; types: Map<PropertyType, number> }>();
		for (const cache of this.caches.values()) {
			for (const [k, v] of Object.entries(cache.frontmatter ?? {})) {
				const e = seen.get(k) ?? { count: 0, types: new Map() };
				e.count++;
				const t = propertyType(v);
				e.types.set(t, (e.types.get(t) ?? 0) + 1);
				seen.set(k, e);
			}
		}
		return [...seen].map(([key, e]) => ({ key, count: e.count, type: [...e.types].sort((a, b) => b[1] - a[1])[0]![0] }))
			.sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
	}

	/** The values used for the property `key` across the homebase (a list's items one by one), most used first. */
	getPropertyValues(key: string): string[] {
		const counts = new Map<string, number>();
		const addValue = (v: unknown) => {
			if (v === null || v === undefined || typeof v === 'object') return;
			const s = String(v).trim();
			if (s) counts.set(s, (counts.get(s) ?? 0) + 1);
		};
		for (const cache of this.caches.values()) {
			const v = cache.frontmatter?.[key];
			if (Array.isArray(v)) v.forEach(addValue); else addValue(v);
		}
		// Tags: also the ones written in notes' text (without their "#").
		if (key === 'tags' || key === 'tag') {
			for (const cache of this.caches.values()) for (const t of cache.tags ?? []) addValue(t.tag.replace(/^#/, ''));
		}
		return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([v]) => v);
	}

	/** Notes linking to `file`, with their link caches. */
	getBacklinksForFile(file: TFile): Map<string, LinkCache[]> {
		const out = new Map<string, LinkCache[]>();
		for (const [path, cache] of this.caches) {
			// Only notes whose resolved links include this one (resolvedLinks is kept up to date).
			if (!this.resolvedLinks[path]?.[file.path]) continue;
			const hits = [...(cache.links ?? []), ...(cache.embeds ?? [])].filter((l) => this.getFirstLinkpathDest(parseLinktext(l.link).path, path) === file);
			if (hits.length) out.set(path, hits);
		}
		return out;
	}

	private resolveLinksOf(file: TFile) {
		const cache = this.caches.get(file.path);
		const resolved: Record<string, number> = {};
		const unresolved: Record<string, number> = {};
		for (const l of [...(cache?.links ?? []), ...(cache?.embeds ?? [])]) {
			const { path } = parseLinktext(l.link);
			const dest = this.getFirstLinkpathDest(path, file.path);
			if (dest) resolved[dest.path] = (resolved[dest.path] ?? 0) + 1;
			else unresolved[path] = (unresolved[path] ?? 0) + 1;
		}
		this.resolvedLinks[file.path] = resolved;
		this.unresolvedLinks[file.path] = unresolved;
	}

	private resolveAll() {
		for (const f of this.app.vault.getMarkdownFiles()) this.resolveLinksOf(f);
		this.trigger('resolved');
	}

	override on(name: 'changed', callback: (file: TFile, data: string, cache: CachedMetadata) => unknown, ctx?: unknown): EventRef;
	override on(name: 'deleted', callback: (file: TFile, prevCache: CachedMetadata | null) => unknown, ctx?: unknown): EventRef;
	override on(name: 'resolve', callback: (file: TFile) => unknown, ctx?: unknown): EventRef;
	override on(name: 'resolved', callback: () => unknown, ctx?: unknown): EventRef;
	override on(name: string, callback: (...data: any[]) => unknown, ctx?: unknown): EventRef;
	override on(name: string, callback: (...data: any[]) => unknown, ctx?: unknown): EventRef {
		return super.on(name, callback, ctx);
	}
}

/** Rebuild a note's text with `fm` as its frontmatter (removed when empty). */
export function withFrontMatter(text: string, fm: Record<string, unknown>): string {
	const { yaml, body } = splitFrontMatter(text);
	if (Object.keys(fm).length === 0) return yaml === null ? text : body.replace(/^\r?\n/, '');
	const block = `---\n${stringifyYaml(fm, { lineWidth: 0 }).replace(/\n$/, '')}\n---\n`;
	return yaml === null ? `${block}${text.length && !text.startsWith('\n') ? '\n' : ''}${text}` : `${block}${body}`;
}

export class FileManager {
	constructor(private app: App) {}

	/** The folder new notes go in, from the setting "Default location for new notes". */
	getNewFileParent(sourcePath: string, _newFilePath?: string): TFolder {
		const { vault } = this.app;
		const where = (vault.getConfig('newFileLocation') as string | undefined) ?? 'current';
		if (where === 'folder') {
			const f = vault.getFolderByPath(String(vault.getConfig('newFileFolderPath') ?? ''));
			if (f) return f;
		}
		if (where === 'current' && sourcePath) {
			const src = vault.getAbstractFileByPath(sourcePath);
			if (src?.parent) return src.parent;
		}
		return vault.getRoot();
	}

	/**
	 * Change a note's frontmatter with `fn`, which edits the object in place. When the note is open, the
	 * change is made in its editor (so it can be undone); otherwise on disk.
	 */
	async processFrontMatter(file: TFile, fn: (frontmatter: any) => void): Promise<void> {
		const ws = this.app.workspace;
		const editor = ws.editorForFile(file);
		const text = editor ? editor.getValue() : await this.app.vault.read(file);
		const fm = parseFrontMatter(text) ?? {};
		fn(fm);
		const next = withFrontMatter(text, fm);
		if (next === text) return;
		if (editor) {
			editor.replaceWhole(next);
			await ws.saveFile(file);
		} else {
			await this.app.vault.modify(file, next);
		}
	}

	async renameFile(file: TAbstractFile, newPath: string): Promise<void> {
		const update = this.app.vault.getConfig('alwaysUpdateLinks') !== false;
		// Before the move, while they still resolve: every link to the file (or to a file in the folder),
		// of any kind (a note, a recording, a picture), with its old path and the note it is in.
		const refs: { source: TFile; oldSource: string; target: TFile; oldPath: string; link: ReferenceCache }[] = [];
		if (update) {
			const targets = file instanceof TFile ? [file] : file instanceof TFolder ? filesIn(file) : [];
			for (const target of targets) {
				for (const [sourcePath, links] of this.app.metadataCache.getBacklinksForFile(target)) {
					const source = this.app.vault.getFileByPath(sourcePath);
					if (source) for (const link of links) refs.push({ source, oldSource: sourcePath, target, oldPath: target.path, link });
				}
			}
		}
		await this.app.vault.rename(file, newPath);
		if (refs.length === 0) return;
		const bySource = new Map<TFile, LinkEdit[]>();
		for (const r of refs) {
			// A link in a note that moved with the folder is written from the note's new place.
			const insert = rewriteLink(r.link.original, r.oldPath, r.target.path, r.source.path, r.oldSource);
			if (insert === r.link.original) continue;
			const edits = bySource.get(r.source) ?? [];
			edits.push({ from: r.link.position.start.offset, to: r.link.position.end.offset, original: r.link.original, insert });
			bySource.set(r.source, edits);
		}
		for (const [f, edits] of bySource) {
			const editor = this.app.workspace.editorForFile(f);
			const text = editor ? editor.getValue() : await this.app.vault.read(f);
			const next = applyLinkEdits(text, edits);
			if (next === text) continue;
			if (editor) editor.replaceWhole(next);
			else await this.app.vault.modify(f, next);
		}
	}

	generateMarkdownLink(file: TFile, sourcePath: string, subpath = '', alias = ''): string {
		const text = this.app.metadataCache.fileToLinktext(file, sourcePath);
		return `[[${text}${subpath}${alias ? `|${alias}` : ''}]]`;
	}

	/** A free path for a new attachment called `filename` of the note at `sourcePath`. */
	async getAvailablePathForAttachment(filename: string, sourcePath?: string): Promise<string> {
		return availablePath(this.app, attachmentFolder(this.app, sourcePath ?? ''), safeFileName(filename));
	}

	async trashFile(file: TAbstractFile): Promise<void> {
		await this.app.vault.trash(file, true);
	}
}

/** Every file in a folder, at any depth. */
function filesIn(folder: TFolder): TFile[] {
	const out: TFile[] = [];
	for (const c of folder.children) {
		if (c instanceof TFile) out.push(c);
		else if (c instanceof TFolder) out.push(...filesIn(c));
	}
	return out;
}
