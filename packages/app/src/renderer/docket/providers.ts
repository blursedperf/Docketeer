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

/** Open `file` here, in a new pane to the right, or below. */
export function openFileIn(app: App, file: TFile, where: OpenWhere, subpath?: string): Promise<void> {
	const leaf = where === 'current' ? app.workspace.getLeaf(false) : app.workspace.getLeaf('split', where === 'right' ? 'vertical' : 'horizontal');
	return leaf.openFile(file).then(() => {
		if (subpath && leaf.view instanceof MarkdownView) leaf.view.scrollToSubpath(subpath);
		app.workspace.setActiveLeaf(leaf, { focus: true });
	});
}

export function registerCoreProviders(app: App): () => void {
	const { docket, commands, vault, metadataCache, workspace } = app;
	const recent: string[] = [];
	const ref = app.on('command-run', (id: string) => { recent.splice(0, recent.length, id, ...recent.filter((x) => x !== id).slice(0, 29)); });
	const hint = (c: Command) => { const k = commands.hotkeysFor(c)[0]; return k ? formatHotkey(k) : undefined; };
	const activePath = () => workspace.getActiveFile()?.path ?? '';

	const commandResult = (c: Command, score: number): SearchResult => ({
		id: c.id, type: 'Commands', title: c.name, detail: c.section, icon: c.icon ?? 'terminal', score, hint: hint(c),
		open: () => { commands.executeCommand(c); },
	});

	const removers = [
		docket.addSearchProvider({
			id: 'core:commands', title: 'Commands', prefixes: ['', '>'], source: 'core',
			search: ({ text, prefix }) => {
				const out: SearchResult[] = [];
				for (const c of commands.listCommands()) {
					if (c.id === 'app:docket' || !commands.isAvailable(c)) continue;
					if (!text) {
						if (prefix !== '>') continue;
						const r = recent.indexOf(c.id);
						out.push(commandResult(c, r === -1 ? -1000 - c.name.charCodeAt(0) / 1000 : 1000 - r));
						continue;
					}
					const s = best(text, [c.name, ...(c.aliases ?? []), ...(c.keywords ?? []), c.section]);
					if (s !== null) out.push(commandResult(c, s + (recent.includes(c.id) ? 20 - recent.indexOf(c.id) / 2 : 0)));
				}
				return out;
			},
		}),
		docket.addSearchProvider({
			id: 'core:notes', title: 'Notes', prefixes: [''], source: 'core',
			search: ({ text }) => {
				if (!text) return [];
				const out: SearchResult[] = [];
				for (const f of vault.getMarkdownFiles()) {
					if (app.isLocked(f)) continue;
					const s = best(text, [f.basename, f.path]);
					if (s === null) continue;
					out.push({
						id: f.path, type: 'Notes', title: f.basename, detail: f.parent && !f.parent.isRoot() ? f.parent.path : undefined,
						icon: 'file-text', file: f, score: s,
						open: (where) => openFileIn(app, f, where),
						insert: () => `[[${metadataCache.fileToLinktext(f, activePath())}]]`,
					});
				}
				return out;
			},
		}),
		docket.addSearchProvider({
			id: 'core:headings', title: 'Headings in this note', prefixes: ['', '/'], source: 'core',
			search: ({ text, prefix }) => {
				const file = workspace.getActiveFile();
				if (!file || app.isLocked(file) || (!text && prefix !== '/')) return [];
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
	return () => { app.offref(ref); for (const r of removers) r(); };
}

