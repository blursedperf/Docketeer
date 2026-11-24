/**
 * The Docket's built-in search providers (Phase 2: enough to drive the shell; Phase 3 adds the index,
 * full text and ranking by use). Locked notes are left out here and again by the Docket itself.
 */
import {
	type App, type Command, type OpenWhere, type SearchResult, MarkdownView, TFile,
	formatHotkey, fuzzyScore, getAllTags,
} from '@quire/api';
import { SEARCH_VIEW, type SearchView } from '../panes/search';
import { FILE_EXPLORER, type FileExplorerView } from '../explorer';

/** The best fuzzy score of `q` against any of `texts` (the first counts most). */
function best(q: string, texts: (string | undefined)[]): number | null {
	let top: number | null = null;
	texts.forEach((t, i) => {
		if (!t) return;
		const s = fuzzyScore(q, t);
		if (s !== null) { const w = s - i * 2; if (top === null || w > top) top = w; }
	});
	return top;
}

/** A heading as text: "From *Terra Nullius* to `x`" → "From Terra Nullius to x". */
export function plainHeading(h: string): string {
	return h.replace(/(\*\*|__|\*|_|`|~~|==)(?=\S)(.+?)(?<=\S)\1/g, '$2').replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1');
}

/** Open `file` with the cursor on `line`. */
export async function openFileAtLine(app: App, file: TFile, line: number, where: OpenWhere): Promise<void> {
	await openFileIn(app, file, where);
	const view = app.workspace.getActiveViewOfType(MarkdownView);
	if (view?.file === file && view.getMode() === 'source') {
		view.editor.setCursor({ line, ch: 0 });
		view.editor.scrollIntoView({ from: { line, ch: 0 }, to: { line, ch: 0 } }, true);
	}
}

/** Open `file` here, in a new pane to the right, or below. */
export function openFileIn(app: App, file: TFile, where: OpenWhere, subpath?: string): Promise<void> {
	const leaf = where === 'current' ? app.workspace.getLeaf(false) : app.workspace.getLeaf('split', where === 'right' ? 'vertical' : 'horizontal');
	return leaf.openFile(file).then(() => {
		if (subpath && leaf.view instanceof MarkdownView) leaf.view.scrollToSubpath(subpath);
		app.workspace.setActiveLeaf(leaf, { focus: true });
	});
}

export function registerCoreProviders(app: App): () => void {
	const { docket, commands, vault, metadataCache, workspace, search } = app;
	const hint = (c: Command) => { const k = commands.hotkeysFor(c)[0]; return k ? formatHotkey(k) : undefined; };
	const activePath = () => workspace.getActiveFile()?.path ?? '';
	const fileAt = (path: string) => vault.getFileByPath(path);
	const many = (only: string | undefined, type: string) => (only === type ? 200 : 8);

	const commandResult = (c: Command, score: number): SearchResult => ({
		id: c.id, type: 'Commands', title: c.name, detail: c.section, icon: c.icon ?? 'terminal', score, hint: hint(c),
		open: () => { commands.executeCommand(c); },
	});

	const noteResult = (f: TFile, score: number): SearchResult => ({
		id: f.path, type: 'Notes', title: f.basename, detail: f.parent && !f.parent.isRoot() ? f.parent.path : undefined,
		icon: 'file-text', file: f, score,
		open: (where) => openFileIn(app, f, where),
		insert: () => `[[${metadataCache.fileToLinktext(f, activePath())}]]`,
	});

	// Settings: read once a session, when the Docket first opens (drawing every page takes a moment).
	let settings: ReturnType<typeof app.setting.listSettings> | null = null;
	const warm = app.on('docket-open', () => { if (!settings) window.setTimeout(() => { settings ??= app.setting.listSettings(); }, 0); });

	const removers = [
		docket.addSearchProvider({
			id: 'core:commands', title: 'Commands', prefixes: ['', '>'], source: 'core',
			search: ({ text, prefix }) => {
				const out: SearchResult[] = [];
				const now = Date.now();
				for (const c of commands.listCommands()) {
					if (c.id === 'app:docket' || !commands.isAvailable(c)) continue;
					const used = search.usage.score('command', c.id, now);
					if (!text) {
						if (prefix === '>') out.push(commandResult(c, used * 10 - c.name.charCodeAt(0) / 1000));
						continue;
					}
					const s = best(text, [c.name, ...(c.aliases ?? []), ...(c.keywords ?? []), c.section]);
					if (s !== null) out.push(commandResult(c, s + used));
				}
				return out;
			},
		}),
		docket.addSearchProvider({
			id: 'core:notes', title: 'Notes', prefixes: [''], source: 'core',
			search: ({ text, only }) => {
				if (!text) return [];
				const ctx = search.rankContext();
				const results: SearchResult[] = [];
				const totals: Record<string, number> = {};
				// Names (fuzzy). Until the index is built, straight from the file list.
				if (!only || only === 'Notes') {
					if (search.isReady) {
						const r = search.index.searchNames(text, many(only, 'Notes'), ctx);
						totals.Notes = r.total;
						for (const h of r.hits) { const f = fileAt(h.path); if (f) results.push(noteResult(f, h.score)); }
					} else {
						for (const f of vault.getMarkdownFiles()) {
							if (app.isLocked(f)) continue;
							const s = best(text, [f.basename, f.path]);
							if (s !== null) results.push(noteResult(f, s + (ctx.usage?.(f.path) ?? 0)));
						}
					}
				}
				// Full text: every word, as a prefix, anywhere in a note.
				if (search.isReady && text.length >= 2 && (!only || only === 'In notes')) {
					const r = search.index.searchText(text, many(only, 'In notes'), ctx);
					totals['In notes'] = r.total;
					for (const h of r.hits) {
						const f = fileAt(h.path);
						if (!f) continue;
						results.push({
							id: `${h.path}:${h.line}`, type: 'In notes', title: f.basename, detail: h.snippet, detailRanges: h.ranges,
							icon: 'text-search', file: f, score: h.score,
							open: (where) => openFileAtLine(app, f, h.line, where),
							insert: () => `[[${metadataCache.fileToLinktext(f, activePath())}]]`,
						});
					}
				}
				// Headings in every note.
				if (search.isReady && text.length >= 2 && (!only || only === 'Headings')) {
					const r = search.index.searchHeadings(text, many(only, 'Headings'), ctx);
					totals.Headings = r.total;
					for (const h of r.hits) {
						const f = fileAt(h.path);
						if (!f) continue;
						const title = plainHeading(h.heading.text);
						results.push({
							id: `${h.path}#${h.heading.line}`, type: 'Headings', title, detail: `${'#'.repeat(h.heading.level)} in ${f.basename}`,
							icon: 'hash', file: f, score: h.score,
							open: (where) => openFileIn(app, f, where, `#${h.heading.text}`),
							insert: () => `[[${metadataCache.fileToLinktext(f, activePath())}#${h.heading.text}]]`,
						});
					}
				}
				return { results, totals };
			},
		}),
		docket.addSearchProvider({
			id: 'core:settings', title: 'Settings', prefixes: [''], source: 'core',
			search: ({ text }) => {
				if (text.length < 2) return [];
				settings ??= app.setting.listSettings();
				const out: SearchResult[] = [];
				for (const st of settings) {
					const s = best(text, [st.name, st.tabName, st.desc]);
					if (s === null || s < 50) continue; // close matches only: descriptions are long
					out.push({
						id: `${st.tabId}:${st.name}`, type: 'Settings', title: st.name, detail: st.tabName, icon: 'settings', score: s,
						open: () => { app.setting.open(); app.setting.search(st.name); },
					});
				}
				return out;
			},
		}),
		docket.addSearchProvider({
			id: 'core:headings', title: 'Headings in this note', prefixes: ['/'], source: 'core',
			search: ({ text }) => {
				const file = workspace.getActiveFile();
				if (!file || app.isLocked(file)) return [];
				const out: SearchResult[] = [];
				(metadataCache.getFileCache(file)?.headings ?? []).forEach((h, i) => {
					const title = plainHeading(h.heading);
					const s = text ? fuzzyScore(text, title) : -i;
					if (s === null) return;
					out.push({
						id: `${file.path}#${i}`, type: 'Headings', title, detail: `${'#'.repeat(h.level)} in ${file.basename}`,
						icon: 'hash', file, score: s,
						open: (where) => {
							const view = workspace.getActiveViewOfType(MarkdownView);
							if (where === 'current' && view?.file === file && view.getMode() === 'source') {
								const line = h.position.start.line;
								view.editor.setCursor({ line, ch: 0 });
								view.editor.scrollIntoView({ from: { line, ch: 0 }, to: { line, ch: 0 } }, true);
								view.editor.focus();
								return;
							}
							return openFileIn(app, file, where, `#${h.heading}`);
						},
						insert: () => `[[#${h.heading}]]`,
					});
				});
				return out;
			},
		}),
		docket.addSearchProvider({
			id: 'core:folders-tags', title: 'Folders and tags', prefixes: ['#'], source: 'core',
			search: ({ text }) => {
				const out: SearchResult[] = [];
				for (const folder of vault.getAllFolders()) {
					const s = text ? best(text, [folder.name, folder.path]) : 0;
					if (s === null) continue;
					const notes = folder.children.filter((c) => c instanceof TFile && c.extension === 'md').length;
					out.push({
						id: folder.path, type: 'Folders', title: folder.name, detail: `${folder.path} · ${notes} note${notes === 1 ? '' : 's'}`,
						icon: 'folder', score: s,
						open: () => workspace.ensureSideLeaf(FILE_EXPLORER, 'left', { reveal: true }).then((leaf) => (leaf.view as FileExplorerView).reveal(folder)),
					});
				}
				const counts = new Map<string, number>();
				for (const f of vault.getMarkdownFiles()) {
					if (app.isLocked(f)) continue;
					const cache = metadataCache.getFileCache(f);
					for (const t of new Set(cache ? getAllTags(cache) ?? [] : [])) counts.set(t, (counts.get(t) ?? 0) + 1);
				}
				for (const [tag, n] of counts) {
					const s = text ? fuzzyScore(text.replace(/^#/, ''), tag.replace(/^#/, '')) : n / 1000;
					if (s === null) continue;
					out.push({
						id: tag, type: 'Tags', title: tag, detail: `${n} note${n === 1 ? '' : 's'}`, icon: 'tag', score: s,
						open: () => workspace.ensureSideLeaf(SEARCH_VIEW, 'left', { reveal: true }).then((leaf) => (leaf.view as SearchView).setQuery(`tag:${tag}`)),
						insert: () => tag,
					});
				}
				return out;
			},
		}),
		docket.addSearchProvider({
			id: 'core:shortcuts', title: 'Shortcuts', prefixes: ['?'], source: 'core',
			search: ({ text }) => {
				const out: SearchResult[] = [];
				for (const c of commands.listCommands()) {
					const keys = commands.hotkeysFor(c);
					if (!keys.length) continue;
					const s = text ? best(text, [c.name, keys.map(formatHotkey).join(' '), c.section]) : -c.name.charCodeAt(0) / 1000;
					if (s === null) continue;
					out.push({
						id: c.id, type: 'Shortcuts', title: c.name, detail: c.section, icon: 'keyboard', score: s,
						hint: keys.map(formatHotkey).join('  '),
						open: () => { commands.executeCommand(c); },
					});
				}
				return out;
			},
		}),
	];
	return () => { app.offref(warm); for (const r of removers) r(); };
}

