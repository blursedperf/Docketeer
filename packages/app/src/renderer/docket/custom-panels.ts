/**
 * Your own Docket panels, and the arrangement of all of them (see panels-model.ts for the file). A panel is a list of
 * elements, each under its own heading: commands, a file tree, a note list, or a built-in panel's contents. Panels
 * are built and arranged in the Docket itself, from the keyboard: "Arrange the Docket's panels" lists every panel
 * (show or hide, move, edit yours, make a new one); "Customise this panel…" at the end of yours edits its contents.
 */
import { type App, type DocketPanel, Notice, type SearchResult, TFile, TFolder, formatHotkey, getAllTags } from '@quire/api';
import type { Docket } from './docket';
import { noteActions } from './actions';
import { openFileIn } from './providers';
import { filesTree } from './panels/homebase';
import { empty, row, section } from './panels/common';
import { byName } from './panels/units';
import { ConfirmModal, NameModal, placeName } from '../dialogs';
import {
	type CustomPanel, type NoteRule, type PanelElement, type PanelsConfig, describeElement, elementHeading, moveItem, newPanelId, panelId, parsePanelsConfig,
} from './panels-model';
import { draggablePath } from './drag';

const ELEMENT_ICONS: Record<PanelElement['type'], string> = { commands: 'terminal', files: 'folder-tree', notes: 'list', section: 'panel-top' };

export function registerCustomPanels(app: App, docket: Docket): () => void {
	let config: PanelsConfig = { panels: [], order: [], hidden: [] };
	let registered: (() => void)[] = [];
	/** Open folders of each file tree element, by panel and element. */
	const treeOpen = new Map<string, Set<string>>();
	const path = () => `${app.vault.configDir}/panels.json`;

	const title = (id: string) => app.docket.panels.get(id)?.title ?? null;
	const find = (pid: string) => config.panels.find((p) => p.id === pid);

	// -------------------------------------------------------------------------------------------
	// Loading, saving and registering

	const apply = () => {
		for (const r of registered) r();
		registered = config.panels.map((p) => app.docket.addPanel(makePanel(p)));
		app.docket.setArrangement({ order: config.order, hidden: config.hidden });
	};
	const load = async () => {
		try {
			config = (await app.vault.adapter.exists(path())) ? parsePanelsConfig(await app.vault.adapter.read(path())) : { panels: [], order: [], hidden: [] };
		} catch {
			config = { panels: [], order: [], hidden: [] };
		}
		apply();
	};
	const save = async (next: PanelsConfig) => {
		config = next;
		await app.vault.adapter.write(path(), JSON.stringify(config, null, '\t'));
		apply();
	};
	const update = (pid: string, f: (p: CustomPanel) => CustomPanel) => save({ ...config, panels: config.panels.map((p) => (p.id === pid ? f(p) : p)) });

	// -------------------------------------------------------------------------------------------
	// Drawing a panel

	const notesFor = (rule: NoteRule, limit: number): TFile[] => {
		const ok = (f: TFile | null): f is TFile => !!f && f.extension === 'md' && !app.isLocked(f);
		let files: TFile[] = [];
		switch (rule.kind) {
			case 'folder': {
				const folder = rule.folder ? app.vault.getFolderByPath(rule.folder) : app.vault.getRoot();
				const all: TFile[] = [];
				const visit = (f: TFolder) => { for (const c of f.children) { if (c instanceof TFolder) visit(c); else if (c instanceof TFile) all.push(c); } };
				if (folder) visit(folder);
				files = all.filter(ok).sort((a, b) => byName({ name: a.basename }, { name: b.basename }));
				break;
			}
			case 'tag': {
				const want = `#${rule.tag.toLowerCase()}`;
				files = app.vault.getMarkdownFiles().filter((f) => {
					const cache = app.metadataCache.getFileCache(f);
					return !!cache && (getAllTags(cache) ?? []).some((t) => t.toLowerCase() === want || t.toLowerCase().startsWith(`${want}/`));
				}).filter(ok).sort((a, b) => byName({ name: a.basename }, { name: b.basename }));
				break;
			}
			case 'recent': files = app.search.usage.recent('note', limit * 2).map((p) => app.vault.getFileByPath(p)).filter(ok); break;
			case 'pinned': files = (app.config.pinnedNotes ?? []).map((p) => app.vault.getFileByPath(p)).filter(ok); break;
			case 'search': {
				const paths = new Set([...app.search.index.searchNames(rule.query, limit).hits.map((h) => h.path), ...app.search.index.searchText(rule.query, limit).hits.map((h) => h.path)]);
				files = [...paths].map((p) => app.vault.getFileByPath(p)).filter(ok);
				break;
			}
		}
		return files.slice(0, limit);
	};

	const drawElement = async (p: CustomPanel, e: PanelElement, i: number, sec: HTMLElement) => {
		switch (e.type) {
			case 'commands': {
				if (!e.commands.length) empty(sec, 'No commands yet: choose some in "Customise this panel".');
				for (const id of e.commands) {
					const c = app.commands.findCommand(id);
					if (!c) { empty(sec, `${id} (not available: its plugin may be off)`); continue; }
					const key = app.commands.hotkeysFor(c)[0];
					const available = app.commands.isAvailable(c);
					row(sec, docket, c.name, () => { docket.close(); app.commands.executeCommand(c); }, {
						icon: c.icon ?? 'terminal', badge: key ? formatHotkey(key) : undefined, detail: available ? undefined : 'Not available here', cls: 'is-command',
					});
				}
				return;
			}
			case 'files': {
				const folder = e.folder ? app.vault.getFolderByPath(e.folder) : app.vault.getRoot();
				if (!folder) { empty(sec, `${e.folder} is not in this homebase.`); return; }
				const key = `${p.id}:${i}`;
				if (!treeOpen.has(key)) treeOpen.set(key, new Set());
				filesTree(app, docket, sec, treeOpen.get(key)!, folder, false);
				return;
			}
			case 'notes': {
				const files = notesFor(e.rule, e.limit ?? 20);
				if (!files.length) { empty(sec, 'No notes match.'); return; }
				for (const f of files) {
					const r = row(sec, docket, f.basename, (where) => { if (where === 'insert') return; docket.close(); void openFileIn(app, f, where); }, {
						icon: 'file-text', detail: f.parent && !f.parent.isRoot() ? placeName(f.parent) : undefined, actions: () => noteActions(app, docket, f),
					});
					r.dataset.path = f.path;
					draggablePath(r, f.path);
				}
				return;
			}
			case 'section': {
				const panel = app.docket.panels.get(e.panel);
				if (!panel || e.panel.startsWith('custom:')) { empty(sec, `${e.panel} is not available (its plugin may be off).`); return; }
				await panel.render(sec, {});
				return;
			}
		}
	};

	function makePanel(p: CustomPanel): DocketPanel {
		return {
			id: panelId(p), title: p.title, icon: p.icon ?? 'layout-list', source: 'custom',
			render: async (el) => {
				if (!p.elements.length) empty(el, 'This panel is empty: add commands, a file tree, a note list or a built-in section.');
				for (const [i, e] of p.elements.entries()) await drawElement(p, e, i, section(el, elementHeading(e, title)));
				row(el, docket, 'Customise this panel…', () => editContents(p.id), { icon: 'settings-2', cls: 'is-command', detail: 'Add, change, move or remove what it shows' });
			},
		};
	}

	// -------------------------------------------------------------------------------------------
	// Editing, as lists in the Docket

	const item = (id: string, type: string, t: string, icon: string, detail: string | undefined, run: () => unknown): SearchResult => ({ id, type, title: t, icon, detail, open: () => { void run(); } });

	/** Every panel: shown or hidden, in order; Enter on one for what to do with it. */
	const arrange = () => {
		const hidden = new Set(config.hidden);
		let n = 0;
		const ids = app.docket.allPanels().map((p) => p.id);
		const items = app.docket.allPanels().map((p, i) => {
			const shown = !hidden.has(p.id);
			if (shown) n++;
			const it = item(`arrange:${p.id}`, 'Panels', p.title, p.icon ?? 'panel-top', `${shown ? (n <= 9 ? `Tab ${n}` : 'Shown') : 'Hidden'}${p.id.startsWith('custom:') ? ' · yours' : ''}`, () => panelMenu(p.id));
			// Drag a panel onto another to put it there.
			it.reorder = { group: 'panels', index: i, move: (to) => save({ ...config, order: moveItem(ids, i, to - i) }).then(arrange) };
			return it;
		});
		items.push(item('arrange:new', 'Change', 'New panel…', 'plus', 'Build one from commands, file trees, note lists and sections', newPanel));
		if (config.order.length || config.hidden.length) items.push(item('arrange:reset', 'Change', 'Show every panel in its usual order', 'rotate-ccw', 'Your own panels stay', () => save({ ...config, order: [], hidden: [] }).then(arrange)));
		docket.showList("Arrange the Docket's panels", items);
	};

	const panelMenu = (id: string) => {
		const p = app.docket.panels.get(id);
		if (!p) { arrange(); return; }
		const hidden = config.hidden.includes(id);
		const ids = app.docket.allPanels().map((x) => x.id);
		const at = ids.indexOf(id);
		const move = (by: number) => save({ ...config, order: moveItem(ids, at, by) }).then(() => panelMenu(id));
		const items: SearchResult[] = [
			hidden
				? item('panel:show', p.title, 'Show it as a tab', 'eye', undefined, () => save({ ...config, hidden: config.hidden.filter((h) => h !== id) }).then(() => panelMenu(id)))
				: item('panel:hide', p.title, 'Hide it', 'eye-off', 'It can still be opened by its command', () => save({ ...config, hidden: [...config.hidden, id] }).then(() => panelMenu(id))),
		];
		if (at > 0) items.push(item('panel:earlier', p.title, 'Move it earlier', 'arrow-up', undefined, () => move(-1)));
		if (at < ids.length - 1) items.push(item('panel:later', p.title, 'Move it later', 'arrow-down', undefined, () => move(1)));
		const own = id.startsWith('custom:') ? find(id.slice('custom:'.length)) : undefined;
		if (own) {
			items.push(item('panel:edit', p.title, 'Change what it shows…', 'settings-2', `${own.elements.length} ${own.elements.length === 1 ? 'element' : 'elements'}`, () => editContents(own.id)));
			items.push(item('panel:rename', p.title, 'Rename…', 'pencil', undefined, () => new NameModal(app, 'Rename panel', own.title, 'Rename', (name) => {
				if (name.trim()) void update(own.id, (x) => ({ ...x, title: name.trim() })).then(() => panelMenu(id));
			}).open()));
			items.push(item('panel:delete', p.title, 'Delete this panel…', 'trash-2', 'Only the panel: no notes or files', () => new ConfirmModal(app, `Delete “${own.title}”?`, 'The panel goes; the notes, folders and commands it showed are not touched.', 'Delete', () => {
				void save({ ...config, panels: config.panels.filter((x) => x.id !== own.id), order: config.order.filter((x) => x !== id), hidden: config.hidden.filter((x) => x !== id) }).then(arrange);
			}).open()));
		} else items.push(item('panel:open', p.title, 'Open it', 'arrow-right', undefined, () => docket.showPanel(id)));
		items.push(item('panel:back', p.title, 'Back to all panels', 'arrow-left', undefined, arrange));
		docket.showList(p.title, items);
	};

	const newPanel = () => new NameModal(app, 'New panel', '', 'Create', (name) => {
		const t = name.trim();
		if (!t) return;
		const id = newPanelId(t, config.panels.map((p) => p.id));
		void save({ ...config, panels: [...config.panels, { id, title: t, elements: [] }] }).then(() => editContents(id));
	}).open();

	/** A panel's contents: Enter on an element for what to do with it; then ways to add one. */
	const editContents = (pid: string) => {
		const p = find(pid);
		if (!p) { arrange(); return; }
		const items = p.elements.map((e, i) => {
			const it = item(`el:${i}`, 'Shows', describeElement(e, title), ELEMENT_ICONS[e.type], e.title ? `Heading: ${e.title}` : undefined, () => elementMenu(pid, i));
			// Drag an element onto another to put it there.
			it.reorder = { group: 'elements', index: i, move: (to) => update(pid, (x) => ({ ...x, elements: moveItem(x.elements, i, to - i) })).then(() => editContents(pid)) };
			return it;
		});
		const add = (e: PanelElement) => update(pid, (x) => ({ ...x, elements: [...x.elements, e] }));
		items.push(item('add:commands', 'Add', 'Add commands…', 'terminal', 'Buttons for any command, a plugin\'s too', () => add({ type: 'commands', commands: [] }).then(() => pickCommands(pid, find(pid)!.elements.length - 1))));
		items.push(item('add:files', 'Add', 'Add a file tree…', 'folder-tree', 'A folder and everything in it, or the whole homebase', () => pickFolder('File tree of…', (folder) => add({ type: 'files', folder }).then(() => editContents(pid)))));
		items.push(item('add:notes', 'Add', 'Add a note list…', 'list', 'Notes in a folder, with a tag, recent, pinned, or matching words', () => pickRule((rule) => add({ type: 'notes', rule }).then(() => editContents(pid)))));
		items.push(item('add:section', 'Add', 'Add a built-in section…', 'panel-top', 'Subjects, Outline, Authorities, Layout …', () => pickSection((panel) => add({ type: 'section', panel }).then(() => editContents(pid)))));
		items.push(item('done', 'Add', `Show “${p.title}”`, 'arrow-right', undefined, () => docket.showPanel(panelId(p))));
		docket.showList(`${p.title}: what it shows`, items);
	};

	const elementMenu = (pid: string, i: number) => {
		const p = find(pid);
		const e = p?.elements[i];
		if (!p || !e) { editContents(pid); return; }
		const set = (next: PanelElement) => update(pid, (x) => ({ ...x, elements: x.elements.map((y, j) => (j === i ? next : y)) }));
		const name = describeElement(e, title);
		const items: SearchResult[] = [];
		if (e.type === 'commands') items.push(item('el:change', name, 'Choose its commands…', 'terminal', undefined, () => pickCommands(pid, i)));
		if (e.type === 'files') items.push(item('el:change', name, 'Change its folder…', 'folder-tree', undefined, () => pickFolder('File tree of…', (folder) => set({ ...e, folder }).then(() => elementMenu(pid, i)))));
		if (e.type === 'notes') items.push(item('el:change', name, 'Change which notes…', 'list', undefined, () => pickRule((rule) => set({ ...e, rule }).then(() => elementMenu(pid, i)))));
		if (e.type === 'section') items.push(item('el:change', name, 'Change the section…', 'panel-top', undefined, () => pickSection((panel) => set({ ...e, panel }).then(() => elementMenu(pid, i)))));
		items.push(item('el:heading', name, 'Heading…', 'heading', e.title ? `Now: ${e.title}` : `Now: ${elementHeading(e, title)}`, () => new NameModal(app, 'Heading (empty for the usual one)', e.title ?? '', 'Save', (t) => {
			const { title: _old, ...rest } = e;
			void set(t.trim() ? { ...rest, title: t.trim() } as PanelElement : rest as PanelElement).then(() => elementMenu(pid, i));
		}).open()));
		if (i > 0) items.push(item('el:up', name, 'Move it up', 'arrow-up', undefined, () => update(pid, (x) => ({ ...x, elements: moveItem(x.elements, i, -1) })).then(() => elementMenu(pid, i - 1))));
		if (i < p.elements.length - 1) items.push(item('el:down', name, 'Move it down', 'arrow-down', undefined, () => update(pid, (x) => ({ ...x, elements: moveItem(x.elements, i, 1) })).then(() => elementMenu(pid, i + 1))));
		items.push(item('el:remove', name, 'Remove it', 'trash-2', 'From this panel only', () => update(pid, (x) => ({ ...x, elements: x.elements.filter((_, j) => j !== i) })).then(() => editContents(pid))));
		items.push(item('el:back', name, `Back to “${p.title}”`, 'arrow-left', undefined, () => editContents(pid)));
		docket.showList(name, items);
	};

	/** Every command, those already in element `i` ticked: Enter adds or removes one; type to filter. */
	const pickCommands = (pid: string, i: number) => {
		const e = find(pid)?.elements[i];
		if (!e || e.type !== 'commands') { editContents(pid); return; }
		const chosen = new Set(e.commands);
		const items: SearchResult[] = [item('cmd:done', 'Done', `Done (${chosen.size} chosen)`, 'check', 'Back to the panel', () => editContents(pid))];
		const all = app.commands.listCommands().filter((c) => !c.id.startsWith('app:docket-panel-')).sort((a, b) => a.name.localeCompare(b.name));
		for (const c of all) {
			const on = chosen.has(c.id);
			items.push(item(`cmd:${c.id}`, on ? 'In this panel' : 'Commands', c.name, on ? 'check-square' : (c.icon ?? 'square'), c.section, () => {
				const commands = on ? e.commands.filter((x) => x !== c.id) : [...e.commands, c.id];
				void update(pid, (x) => ({ ...x, elements: x.elements.map((y, j) => (j === i ? { ...e, commands } : y)) })).then(() => pickCommands(pid, i));
			}));
		}
		docket.showList('Choose commands (Enter adds or removes one)', items);
	};

	const pickFolder = (heading: string, then: (folder: string) => unknown) => {
		const folders = app.vault.getAllFolders().filter((f) => !f.isRoot() && !f.path.split('/').some((x) => x.startsWith('.'))).sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true, sensitivity: 'base' }));
		docket.showList(heading, [
			item('folder:', 'Folders', 'The whole homebase', 'house', undefined, () => then('')),
			...folders.map((f) => item(`folder:${f.path}`, 'Folders', f.path.replace(/\//g, ' › '), 'folder', undefined, () => then(f.path))),
		]);
	};

	const pickRule = (then: (rule: NoteRule) => unknown) => {
		docket.showList('Which notes?', [
			item('rule:folder', 'Notes', 'In a folder…', 'folder', 'Its notes and those in folders inside it', () => pickFolder('Notes in…', (folder) => then({ kind: 'folder', folder }))),
			item('rule:tag', 'Notes', 'With a tag…', 'tag', 'In their properties or text', pickTag(then)),
			item('rule:recent', 'Notes', 'Recent notes', 'clock', undefined, () => then({ kind: 'recent' })),
			item('rule:pinned', 'Notes', 'Pinned notes', 'pin', undefined, () => then({ kind: 'pinned' })),
			item('rule:search', 'Notes', 'Matching words…', 'search', 'In their names or text, as in the Docket\'s search', () => new NameModal(app, 'Notes matching', '', 'Save', (q) => { if (q.trim()) void then({ kind: 'search', query: q.trim() }); }).open()),
		]);
	};

	const pickTag = (then: (rule: NoteRule) => unknown) => () => {
		const counts = new Map<string, number>();
		for (const f of app.vault.getMarkdownFiles()) {
			const cache = app.metadataCache.getFileCache(f);
			for (const t of new Set((cache ? getAllTags(cache) ?? [] : []).map((x) => x.replace(/^#/, '')))) counts.set(t, (counts.get(t) ?? 0) + 1);
		}
		const tags = [...counts].sort((a, b) => a[0].localeCompare(b[0]));
		if (!tags.length) { new Notice('No note has a tag yet.'); return; }
		docket.showList('Notes tagged…', tags.map(([t, n]) => item(`tag:${t}`, 'Tags', `#${t}`, 'tag', `${n} ${n === 1 ? 'note' : 'notes'}`, () => then({ kind: 'tag', tag: t }))));
	};

	const pickSection = (then: (panel: string) => unknown) => {
		const panels = app.docket.allPanels().filter((p) => !p.id.startsWith('custom:'));
		docket.showList('Show the contents of…', panels.map((p) => item(`section:${p.id}`, 'Panels', p.title, p.icon ?? 'panel-top', p.source && p.source !== 'core' ? 'From a plugin' : undefined, () => then(p.id))));
	};

	// -------------------------------------------------------------------------------------------

	// A Docket tab dragged onto another: the dragged panel takes that place.
	const tabMoved = app.workspace.on('docket-move-panel', (id: string, target: string) => {
		const ids = app.docket.allPanels().map((p) => p.id);
		const from = ids.indexOf(id);
		const to = ids.indexOf(target);
		if (from < 0 || to < 0 || from === to) return;
		void save({ ...config, order: moveItem(ids, from, to - from) });
	});

	app.commands.addCommand({ id: 'app:arrange-panels', name: "Arrange and customise the Docket's panels", icon: 'layout-list', section: 'Docket', aliases: ['Customise panels', 'Hide panel', 'Reorder panels', 'Edit panels'], run: () => arrange() });
	app.commands.addCommand({ id: 'app:new-panel', name: 'New Docket panel…', icon: 'plus', section: 'Docket', aliases: ['Custom panel', 'Make a panel'], run: () => newPanel() });
	void load();
	return () => {
		app.workspace.offref(tabMoved);
		for (const r of registered) r();
		registered = [];
		app.docket.setArrangement({ order: [], hidden: [] });
		app.commands.removeCommand('app:arrange-panels');
		app.commands.removeCommand('app:new-panel');
	};
}
