/**
 * The Docket's built-in search providers (Phase 2: enough to drive the shell; Phase 3 adds the index,
 * full text and ranking by use). Locked notes are left out here and again by the Docket itself.
 */
import {
	type App, type Command, type OpenWhere, type SearchResult, MarkdownView, Platform, TFile,
	formatHotkey, fuzzyScore, getAllTags, wordMatch,
} from '@quire/api';
import type { Docket } from './docket';
import { countNotes, revealInUnits } from './panels/units';
import { createNote, notePlaces, placeName } from '../dialogs';

/** The best score of `q` against any of `texts` (the first counts most); word-wise for commands and settings. */
function best(q: string, texts: (string | undefined)[], match: (q: string, t: string) => number | null = fuzzyScore): number | null {
	let top: number | null = null;
	texts.forEach((t, i) => {
		if (!t) return;
		const s = match(q, t);
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

export function registerCoreProviders(app: App, ui: Docket): () => void {
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
		id: f.path, type: 'Notes', title: f.basename, detail: f.parent && !f.parent.isRoot() ? placeName(f.parent) : undefined,
		icon: 'file-text', file: f, score,
		open: (where) => openFileIn(app, f, where),
		insert: () => `[[${metadataCache.fileToLinktext(f, activePath())}]]`,
	});

	// Tag counts, worked out again only after a note changes.
	let tags: Map<string, number> | null = null;
	const tagsStale = [metadataCache.on('changed', () => { tags = null; }), metadataCache.on('deleted', () => { tags = null; }), vault.on('rename', () => { tags = null; })];
	const tagCounts = () => {
		if (tags) return tags;
		tags = new Map();
		for (const f of vault.getMarkdownFiles()) {
			if (app.isLocked(f)) continue;
			const cache = metadataCache.getFileCache(f);
			for (const t of new Set(cache ? getAllTags(cache) ?? [] : [])) tags.set(t, (tags.get(t) ?? 0) + 1);
		}
		return tags;
	};

	// Settings: read once a session, when the Docket first opens (drawing every page takes a moment).
	let settings: ReturnType<typeof app.setting.listSettings> | null = null;
	const warm = app.on('docket-open', () => { window.setTimeout(() => { settings ??= app.setting.listSettings(); tagCounts(); }, 0); });

	/** Notes with a tag (or a tag under it: #torts finds #torts/duty). */
	const notesTagged = (tag: string): SearchResult[] => {
		const out: SearchResult[] = [];
		const t = tag.toLowerCase();
		for (const f of vault.getMarkdownFiles()) {
			if (app.isLocked(f)) continue;
			const cache = metadataCache.getFileCache(f);
			const tags = (cache ? getAllTags(cache) ?? [] : []).map((x) => x.toLowerCase());
			if (tags.some((x) => x === t || x.startsWith(`${t}/`))) out.push(noteResult(f, 0));
		}
		return out.sort((a, b) => a.title.localeCompare(b.title));
	};

	// "Create note" → : the other places it could go.
	const createElsewhere = docket.addResultAction({
		id: 'core:create-in', title: 'Create it in another subject or topic…', icon: 'folder-input', source: 'core',
		appliesTo: (r) => r.id.startsWith('create:'),
		run: (r) => {
			const name = r.id.slice('create:'.length);
			ui.open();
			ui.showActionList(`Create “${name}” in`, notePlaces(app, String(app.config.archiveFolder || 'Archive')).map((f) => ({ title: placeName(f), icon: f.isRoot() ? 'house' : 'folder', run: () => createNote(app, f, name) })));
		},
	});

	const removers = [
		createElsewhere,
		docket.addSearchProvider({
			id: 'core:commands', title: 'Commands', prefixes: ['', '>'], source: 'core',
			search: ({ text, prefix }) => {
				const out: SearchResult[] = [];
				const now = Date.now();
				for (const c of commands.listCommands()) {
					if (c.id === 'app:docket' || !commands.isAvailable(c)) continue;
					const used = search.usage.score('command', c.id, now);
					if (!text) {
						// The whole list, to browse: recently used first, then by section, A–Z.
						if (prefix === '>') {
							const r = commandResult(c, -c.name.toLowerCase().charCodeAt(0) / 1000 - c.name.length / 1e6);
							r.type = used > 0 ? 'Recently used' : c.section ?? 'Other';
							if (used > 0) r.score = used;
							out.push(r);
						}
						continue;
					}
					const s = best(text, [c.name, ...(c.aliases ?? []), ...(c.keywords ?? []), c.section], wordMatch);
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
				// No note by exactly that name: offer to create it (what the quick switcher did).
				if ((!only || only === 'Notes') && !/[\\/:]/.test(text) && !vault.getMarkdownFiles().some((f) => f.basename.toLowerCase() === text.toLowerCase())) {
					const parent = app.fileManager.getNewFileParent(activePath());
					results.push({
						// Its own group, last: Enter opens the best match, never makes a note by accident.
						id: `create:${text}`, type: 'New note', title: `Create note “${text}”`, detail: `in ${placeName(parent)} · → to choose another place`, icon: 'file-plus', score: -1e6,
						open: async (where) => {
							const file = await createNote(app, parent, text);
							if (file && where !== 'current') await openFileIn(app, file, where);
						},
					});
				}
				// Subjects and topics by name (Enter shows them in Units).
				if (!only || only === 'Folders') {
					const archive = String(app.config.archiveFolder || 'Archive');
					const folders: SearchResult[] = [];
					for (const folder of vault.getAllFolders()) {
						if (folder.name.startsWith('.') || folder.path === archive || folder.path.startsWith(`${archive}/`)) continue;
						const s = fuzzyScore(text, folder.name);
						if (s === null || s < 500) continue; // the name contains what was typed
						const notes = countNotes(folder);
						folders.push({
							id: `folder:${folder.path}`, type: 'Folders', title: folder.name, icon: 'folder',
							detail: `${folder.parent && !folder.parent.isRoot() ? `in ${placeName(folder.parent)} · ` : ''}${notes} note${notes === 1 ? '' : 's'} · Enter shows it in Units`,
							score: s, open: () => { revealInUnits(folder.path); ui.showPanel('core:units'); },
						});
					}
					totals.Folders = folders.length;
					results.push(...folders);
				}
				// Full text: every word, as a prefix, anywhere in a note.
				// From three characters: two match nearly every note, and cost a keystroke's budget for nothing.
				if (search.isReady && text.length >= 3 && (!only || only === 'In notes')) {
					const r = search.index.searchText(text, many(only, 'In notes'), ctx);
					// A note already listed by its name is not listed again for its text.
					const named = new Set(results.filter((x) => x.type === 'Notes').map((x) => x.id));
					totals['In notes'] = Math.max(0, r.total - named.size);
					for (const h of r.hits) {
						const f = fileAt(h.path);
						if (!f || named.has(h.path)) continue;
						results.push({
							id: `${h.path}:${h.line}`, type: 'In notes', title: f.basename, detail: h.snippet.trim() || undefined, detailRanges: h.snippet.trim() ? h.ranges : undefined,
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
							id: `${h.path}#${h.heading.line}`, type: 'Headings', title, detail: `in ${f.basename}`,
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
					const s = best(text, [st.name, st.tabName, st.desc], wordMatch);
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
						open: () => { revealInUnits(folder.path); ui.showPanel('core:units'); },
					});
				}
				for (const [tag, n] of tagCounts()) {
					const s = text ? fuzzyScore(text.replace(/^#/, ''), tag.replace(/^#/, '')) : n / 1000;
					if (s === null) continue;
					out.push({
						id: tag, type: 'Tags', title: tag, detail: `${n} note${n === 1 ? '' : 's'}`, icon: 'tag', score: s,
						open: () => ui.showList(`Notes tagged ${tag}`, notesTagged(tag)),
						insert: () => tag,
					});
				}
				return out;
			},
		}),
		docket.addSearchProvider({
			id: 'core:shortcuts', title: 'Shortcuts', prefixes: ['?'], source: 'core',
			// The cheat sheet: every shortcut from the keymap (as remapped), grouped by section, after the
			// Docket's own keys and prefixes. Typing narrows it; Enter runs the command.
			search: ({ text }) => {
				const out: SearchResult[] = [];
				const mod = Platform.isMacOS ? '⌘' : 'Ctrl+';
				const fixed: [string, string, string][] = [
					['In the Docket', '↑ ↓', 'Move through results and panel rows (↑ at the top: back to the search)'],
					['In the Docket', '← →', 'Previous or next panel (with nothing typed)'],
					['In the Docket', '↵', 'Open here'],
					['In the Docket', `${mod}↵`, 'Open to the right'],
					['In the Docket', Platform.isMacOS ? '⌥↵' : 'Alt+↵', 'Open below'],
					['In the Docket', Platform.isMacOS ? '⇧↵' : 'Shift+↵', 'Insert as a link at the cursor'],
					['In the Docket', `→ or ${mod}.`, 'More actions'],
					['In the Docket', 'Tab', 'Input, results or panel, panel tabs'],
					['In the Docket', 'Esc', 'Back one step, or close'],
					['In Units', 'N / T', 'New note / new topic in the selected folder'],
					['In Units', 'F2', 'Rename the selected note or folder'],
					['In Units', Platform.isMacOS ? '⌘⌫' : 'Delete', 'Delete the selected note or folder (asks first)'],
					['Prefixes', '>', 'Commands'],
					['Prefixes', '#', 'Folders and tags'],
					['Prefixes', '/', 'Headings in this note'],
					['Prefixes', '@', 'Authorities in this note'],
					['Prefixes', '?', 'This cheat sheet'],
				];
				fixed.forEach(([type, keys, title], i) => {
					const s = text ? best(text, [title, keys]) : 1000 - i;
					if (s !== null) out.push({ id: `fixed:${i}`, type, title, icon: 'keyboard', score: s, hint: keys });
				});
				for (const c of commands.listCommands()) {
					const keys = commands.hotkeysFor(c);
					if (!keys.length) continue;
					const s = text ? best(text, [c.name, keys.map(formatHotkey).join(' '), c.section]) : -c.name.charCodeAt(0) / 1000;
					if (s === null) continue;
					out.push({
						id: c.id, type: c.section ?? 'Other', title: c.name, icon: c.icon ?? 'keyboard', score: s,
						hint: keys.map(formatHotkey).join('  '),
						open: () => { commands.executeCommand(c); },
					});
				}
				return out;
			},
		}),
	];
	return () => {
		app.offref(warm);
		metadataCache.offref(tagsStale[0]!); metadataCache.offref(tagsStale[1]!); vault.offref(tagsStale[2]!);
		for (const r of removers) r();
	};
}

