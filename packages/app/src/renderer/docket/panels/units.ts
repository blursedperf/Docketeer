/**
 * Units (Mod+3): pinned and recent notes, then the folders tagged as subjects (units) and topics, each with
 * its notes, A–Z (numbers in order). Tags are kept in .quire/units.json (units-store.ts); other folders are
 * not shown here (Homebase › Files lists everything). Enter opens a note, or opens and closes a folder (the arrow shows
 * which). On a row, N makes a new note there and T a new topic, both asking for the name first; each
 * opened folder ends with "+ New note"; → offers renaming, moving, pinning, archiving and deleting. The
 * archive folder is listed last.
 *
 * Words for the levels live in UNIT_LABELS so subjects and topics can become clients and matters.
 */
import { type App, type DocketPanel, Notice, Platform, TFile, TFolder } from '@quire/api';
import type { ActionItem, Docket } from '../docket';
import { archiveRoot, isArchived, noteActions, pluginFileActions } from '../actions';
import { NameModal, NewNoteModal, notePlaces, placeName } from '../../dialogs';
import { openFileIn } from '../providers';
import { unitsStore } from '../../units-store';
import { type UnitKind, suggestedUnitTags, unitChildren, unitRoots } from '../../units-model';
import { empty, row, section } from './common';
import { draggablePath, dropIntoFolder } from '../drag';

export const UNIT_LABELS = { level1: 'Subject', level2: 'Topic', plural1: 'Subjects' };

/** A folder to open the way to next time Units is drawn (from a "#" folder result). */
let pendingReveal: string | null = null;
export function revealInUnits(path: string): void { pendingReveal = path; }

/** A–Z, ignoring case, with numbers in order ("Week 2" before "Week 10"). */
export function byName(a: { name: string }, b: { name: string }): number {
	return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
}

export function unitsPanel(app: App, docket: Docket): DocketPanel {
	const open = new Set<string>();
	const archive = () => archiveRoot(app);

	/** New note in `folder`: the name first (Enter creates it there). */
	const newNote = (folder: TFolder) => {
		docket.close();
		new NewNoteModal(app, folder, notePlaces(app, archive())).open();
	};

	/** New topic (folder) in `folder`, or a new subject at the top; opened in Units afterwards. */
	const newTopic = (folder: TFolder) => {
		const label = (folder.isRoot() ? UNIT_LABELS.level1 : UNIT_LABELS.level2).toLowerCase();
		new NameModal(app, folder.isRoot() ? `New ${label}` : `New ${label} in ${placeName(folder)}`, '', 'Create', (name) => {
			const n = name.trim();
			if (!n) return;
			if (/[\\/:]/.test(n)) { new Notice('A name cannot contain / \\ or :'); return; }
			const path = folder.isRoot() ? n : `${folder.path}/${n}`;
			app.vault.createFolder(path).then(async () => {
				// Made here, so it is a unit: a subject at the top, a topic inside another.
				await unitsStore(app).set(path, folder.isRoot() ? 'subject' : 'topic');
				if (!folder.isRoot()) open.add(folder.path);
				open.add(path);
				docket.showPanel('core:units');
			}).catch((e: unknown) => new Notice(e instanceof Error ? e.message : String(e)));
		}).open();
	};

	const folderActions = (folder: TFolder): ActionItem[] => {
		const cmd = (id: string, title: string, args: Record<string, unknown>): ActionItem | null => {
			const c = app.commands.findCommand(id);
			return c && app.commands.isAvailable(c, args) ? { title, icon: c.icon, run: () => app.commands.executeCommand(c, args) } : null;
		};
		const list = [
			{ title: 'New note here (N)', icon: 'square-pen', run: () => newNote(folder) },
			{ title: `New ${UNIT_LABELS.level2.toLowerCase()} here (T)`, icon: 'folder-plus', run: () => newTopic(folder) },
			...unitTagActions(app, folder),
			cmd('app:lock-folder', 'Lock folder', { folder }),
			cmd('app:remove-folder-lock', 'Remove lock from folder', { folder }),
			cmd('app:rename-file', 'Rename…', { file: folder }),
			cmd('app:move-file', 'Move to…', { file: folder }),
			cmd('app:delete-file', 'Delete…', { file: folder }),
			cmd('app:show-in-folder', 'Show in system file manager', { file: folder }),
			...pluginFileActions(app, folder),
		];
		return list.filter((a): a is ActionItem => !!a);
	};

	/** N and T on a row: a new note or topic in that folder (a note's own folder, for a note row). */
	const keys = (el: HTMLElement, folder: TFolder) => {
		el.addEventListener('keydown', (e) => {
			if (e.ctrlKey || e.metaKey || e.altKey) return;
			const k = e.key.toLowerCase();
			if (k !== 'n' && k !== 't') return;
			e.preventDefault();
			e.stopPropagation();
			if (k === 'n') newNote(folder);
			else newTopic(folder);
		});
	};

	const noteRow = (parent: HTMLElement, f: TFile, level: number, detail?: string) => {
		const r = row(parent, docket, f.basename, (where) => {
			if (where === 'insert') return;
			docket.close();
			void openFileIn(app, f, where);
		}, { icon: app.isEncrypted(f) ? (app.isLocked(f) ? 'lock' : 'lock-open') : 'file-text', level, detail, actions: () => (app.isLocked(f) ? [] : noteActions(app, docket, f)) });
		if (app.isLocked(f)) { r.addClass('is-locked'); r.setAttribute('aria-description', 'Locked: Enter asks for the passphrase'); }
		r.dataset.path = f.path;
		draggablePath(r, f.path);
		keys(r, f.parent ?? app.vault.getRoot());
		return r;
	};

	/** A tagged folder's row; opened, its tagged folders, then its notes, then "+ New note". */
	const unitRow = (parent: HTMLElement, folder: TFolder, level: number) => {
		const store = unitsStore(app);
		const expanded = open.has(folder.path);
		const r = row(parent, docket, folder.name, () => { if (expanded) open.delete(folder.path); else open.add(folder.path); void docket.refreshPanel(); }, {
			icon: expanded ? 'chevron-down' : 'chevron-right', level, badge: `${app.lock.isFolderLocked(folder) ? 'locked · ' : ''}${unitNoteCount(app, folder)}`, actions: () => folderActions(folder), cls: 'docket-folder',
		});
		r.setAttribute('aria-expanded', String(expanded));
		r.dataset.path = folder.path;
		r.dataset.unit = store.kind(folder.path) ?? '';
		draggablePath(r, folder.path);
		dropIntoFolder(r, app, folder.path);
		keys(r, folder);
		if (!expanded) return;
		for (const p of unitChildren(store.tags, folder.path).map((x) => app.vault.getFolderByPath(x)).filter((f): f is TFolder => !!f).sort(byName)) unitRow(parent, p, level + 1);
		const notes = folder.children.filter((c): c is TFile => c instanceof TFile && c.extension === 'md').sort((a, b) => byName({ name: a.basename }, { name: b.basename }));
		for (const f of notes) noteRow(parent, f, level + 1);
		const add = row(parent, docket, `New note in ${folder.name}`, () => newNote(folder), { icon: 'plus', level: level + 1, cls: 'is-command' });
		keys(add, folder);
		dropIntoFolder(add, app, folder.path);
	};

	/** Folders as they are (for the archive): every folder and note inside `items`. */
	const folderTree = (parent: HTMLElement, items: TFolder['children'], level: number) => {
		// The attachments folder (pictures and files pasted into notes) is not a subject.
		const attachments = String(app.config.attachmentFolder ?? '').replace(/^\/+|\/+$/g, '');
		const folders = items.filter((c): c is TFolder => c instanceof TFolder && !c.name.startsWith('.') && !(attachments && !attachments.startsWith('.') && c.path === attachments)).sort(byName);
		// Locked notes are listed by name, with a lock: Enter asks for the passphrase. Nothing else of them shows.
		const notes = items.filter((c): c is TFile => c instanceof TFile && c.extension === 'md')
			.sort((a, b) => byName({ name: a.basename }, { name: b.basename }));
		for (const c of folders) {
			const expanded = open.has(c.path);
			const r = row(parent, docket, c.name, () => { if (expanded) open.delete(c.path); else open.add(c.path); void docket.refreshPanel(); }, {
				icon: expanded ? 'chevron-down' : 'chevron-right', level, badge: `${app.lock.isFolderLocked(c) ? 'locked · ' : ''}${countNotes(c)}`, actions: () => folderActions(c), cls: 'docket-folder',
			});
			r.setAttribute('aria-expanded', String(expanded));
			r.dataset.path = c.path;
			keys(r, c);
			if (expanded) {
				folderTree(parent, c.children, level + 1);
				const add = row(parent, docket, `New note in ${c.name}`, () => newNote(c), { icon: 'plus', level: level + 1, cls: 'is-command' });
				keys(add, c);
			}
		}
		for (const f of notes) noteRow(parent, f, level);
	};

	return {
		id: 'core:units', title: 'Units', icon: 'folders', order: 3, source: 'core',
		render: (el) => {
			const active = app.workspace.getActiveFile();
			// Open the way to the open note, and to a folder chosen from a "#" result.
			if (active) { const parts = active.path.split('/'); for (let i = 1; i < parts.length; i++) open.add(parts.slice(0, i).join('/')); }
			if (pendingReveal) { const parts = pendingReveal.split('/'); for (let i = 1; i <= parts.length; i++) open.add(parts.slice(0, i).join('/')); pendingReveal = null; }

			const store = unitsStore(app);
			const help = el.createDiv({ cls: 'docket-help' });
			help.createSpan({ text: `${UNIT_LABELS.plural1} (units) and ${UNIT_LABELS.level2.toLowerCase()}s are folders you mark: → on a folder here or in Homebase › Files.` });
			const del = Platform.isMacOS ? '⌘⌫' : 'Del';
			for (const [k, t] of [['Enter', 'open'], ['N', 'new note here'], ['T', `new ${UNIT_LABELS.level2.toLowerCase()} here`], ['F2', 'rename'], [del, 'delete'], ['→', 'more']] as const) {
				const s = help.createSpan({ cls: 'docket-help-key' });
				s.createEl('kbd', { text: k });
				s.appendText(` ${t}`);
			}

			const pinned = (app.config.pinnedNotes ?? []).map((p) => app.vault.getFileByPath(p)).filter((f): f is TFile => !!f && !app.isLocked(f));
			if (pinned.length) {
				const sec = section(el, 'Pinned', pinned.length);
				for (const f of pinned) noteRow(sec, f, 0, f.parent && !f.parent.isRoot() ? placeName(f.parent) : undefined);
			}
			const recent = app.search.usage.recent('note', 12).map((p) => app.vault.getFileByPath(p)).filter((f): f is TFile => !!f && !app.isLocked(f) && !pinned.includes(f)).slice(0, 5);
			if (recent.length) {
				const sec = section(el, 'Recent', recent.length);
				for (const f of recent) noteRow(sec, f, 0, f.parent && !f.parent.isRoot() ? placeName(f.parent) : undefined);
			}

			const root = app.vault.getRoot();
			const sec = section(el, UNIT_LABELS.plural1);
			if (!store.loaded) empty(sec, 'Loading…');
			else if (store.isEmpty) {
				// Nothing tagged yet: offer to tag the folders as Units used to show them, so nothing seems lost.
				const suggested = suggestedTags(app);
				const n = Object.keys(suggested).length;
				if (n) {
					empty(sec, `Units shows the folders you mark as ${UNIT_LABELS.plural1.toLowerCase()} (units) and ${UNIT_LABELS.level2.toLowerCase()}s. None are marked yet.`);
					row(sec, docket, `Mark my folders: top folders as ${UNIT_LABELS.plural1.toLowerCase()}, folders inside them as ${UNIT_LABELS.level2.toLowerCase()}s`, () => { void store.replace(suggested); }, { icon: 'wand', detail: `${n} folder${n === 1 ? '' : 's'}; change any later with → on it`, cls: 'is-command' });
				} else empty(sec, `No ${UNIT_LABELS.plural1.toLowerCase()} yet. Make one, then notes in it.`);
			}
			const roots = unitRoots(store.tags).map((p) => app.vault.getFolderByPath(p)).filter((f): f is TFolder => !!f && !isArchived(app, f)).sort(byName);
			for (const f of roots) unitRow(sec, f, 0);
			const addSubject = row(sec, docket, `New ${UNIT_LABELS.level1.toLowerCase()}`, () => newTopic(root), { icon: 'plus', cls: 'is-command' });
			keys(addSubject, root);
			const arch = app.vault.getFolderByPath(archive());
			if (arch) {
				const as = section(el, 'Archive', countNotes(arch));
				folderTree(as, arch.children, 0);
			}
		},
	};
}

/** The folders Units would mark for a homebase with no tags: see suggestedUnitTags. */
export function suggestedTags(app: App): Record<string, UnitKind> {
	const attachments = String(app.config.attachmentFolder ?? '').replace(/^\/+|\/+$/g, '');
	const archive = archiveRoot(app);
	const skip = (p: string) => p === attachments || p === archive || p.startsWith(`${archive}/`);
	return suggestedUnitTags(app.vault.getAllFolders().filter((f) => !f.isRoot()).map((f) => f.path), skip);
}

/** Mark-as actions for a folder: subject (unit), topic, or out of Units. */
export function unitTagActions(app: App, folder: TFolder): ActionItem[] {
	const store = unitsStore(app);
	const kind = store.kind(folder.path);
	const out: ActionItem[] = [];
	if (kind !== 'subject') out.push({ title: `Mark as ${UNIT_LABELS.level1.toLowerCase()} (unit)`, icon: 'book', run: () => { void store.set(folder.path, 'subject'); } });
	if (kind !== 'topic') out.push({ title: `Mark as ${UNIT_LABELS.level2.toLowerCase()}`, icon: 'bookmark', run: () => { void store.set(folder.path, 'topic'); } });
	if (kind) out.push({ title: 'Remove from Units (the folder stays)', icon: 'bookmark-minus', run: () => { void store.set(folder.path, null); } });
	return out;
}

/** Notes Units lists under a tagged folder: its own, and those of the tagged folders inside it. */
export function unitNoteCount(app: App, folder: TFolder): number {
	const store = unitsStore(app);
	let n = folder.children.filter((c) => c instanceof TFile && c.extension === 'md').length;
	for (const p of unitChildren(store.tags, folder.path)) { const f = app.vault.getFolderByPath(p); if (f) n += unitNoteCount(app, f); }
	return n;
}

/** Notes in a folder and every folder inside it. */
export function countNotes(folder: TFolder): number {
	let n = 0;
	for (const c of folder.children) n += c instanceof TFolder ? countNotes(c) : c instanceof TFile && c.extension === 'md' ? 1 : 0;
	return n;
}
