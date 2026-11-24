/**
 * Units (Mod+3): pinned and recent notes, then subjects (top folders) with their topics (folders inside)
 * and notes, A–Z (numbers in order). Enter opens a note, or opens and closes a folder (the arrow shows
 * which). On a row, N makes a new note there and T a new topic, both asking for the name first; each
 * opened folder ends with "+ New note"; → offers renaming, moving, pinning, archiving and deleting. The
 * archive folder is listed last.
 *
 * Words for the levels live in UNIT_LABELS so subjects and topics can become clients and matters.
 */
import { type App, type DocketPanel, Notice, TFile, TFolder } from '@quire/api';
import type { ActionItem, Docket } from '../docket';
import { archiveRoot, isArchived, noteActions, pluginFileActions } from '../actions';
import { NameModal, NewNoteModal, notePlaces, placeName } from '../../dialogs';
import { openFileIn } from '../providers';
import { empty, row, section } from './common';

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
			app.vault.createFolder(path).then(() => {
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
		keys(r, f.parent ?? app.vault.getRoot());
		return r;
	};

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

			const help = el.createDiv({ cls: 'docket-help' });
			help.createSpan({ text: `${UNIT_LABELS.plural1} are your top folders; ${UNIT_LABELS.level2.toLowerCase()}s are folders inside them.` });
			for (const [k, t] of [['Enter', 'open'], ['N', 'new note here'], ['T', `new ${UNIT_LABELS.level2.toLowerCase()} here`], ['→', 'more']] as const) {
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
			if (!root.children.some((c) => c instanceof TFolder || (c instanceof TFile && c.extension === 'md'))) empty(sec, `No notes yet. Make a ${UNIT_LABELS.level1.toLowerCase()}, then notes in it.`);
			folderTree(sec, root.children.filter((c) => !(c instanceof TFolder && isArchived(app, c))), 0);
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

/** Notes in a folder and every folder inside it. */
export function countNotes(folder: TFolder): number {
	let n = 0;
	for (const c of folder.children) n += c instanceof TFolder ? countNotes(c) : c instanceof TFile && c.extension === 'md' ? 1 : 0;
	return n;
}
