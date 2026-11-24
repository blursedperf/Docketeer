/**
 * Units (Mod+3): pinned and recent notes, then subjects (top folders) with their topics (folders inside)
 * and notes. Enter opens a note or opens and closes a folder; → offers creating, renaming, moving,
 * pinning, archiving and deleting. The archive folder is listed last.
 *
 * Words for the levels live in UNIT_LABELS so subjects and topics can become clients and matters.
 */
import { type App, type DocketPanel, TFile, TFolder } from '@quire/api';
import type { ActionItem, Docket } from '../docket';
import { archiveRoot, isArchived, noteActions, pluginFileActions } from '../actions';
import { openFileIn } from '../providers';
import { empty, row, section } from './common';

export const UNIT_LABELS = { level1: 'Subject', level2: 'Topic', plural1: 'Subjects' };

export function unitsPanel(app: App, docket: Docket): DocketPanel {
	const open = new Set<string>();

	const folderActions = (folder: TFolder): ActionItem[] => {
		const cmd = (id: string, title: string, args: Record<string, unknown>): ActionItem | null => {
			const c = app.commands.findCommand(id);
			return c && app.commands.isAvailable(c, args) ? { title, icon: c.icon, run: () => app.commands.executeCommand(c, args) } : null;
		};
		const depth = folder.path.split('/').length;
		const list = [
			cmd('app:new-note', 'New note here', { folder }),
			cmd('app:new-folder', depth === 1 ? `New ${UNIT_LABELS.level2.toLowerCase()} here` : 'New folder here', { folder }),
			cmd('app:rename-file', 'Rename…', { file: folder }),
			cmd('app:move-file', 'Move to…', { file: folder }),
			cmd('app:delete-file', 'Delete…', { file: folder }),
			cmd('app:show-in-folder', 'Show in system file manager', { file: folder }),
			...pluginFileActions(app, folder),
		];
		return list.filter((a): a is ActionItem => !!a);
	};

	const noteRow = (parent: HTMLElement, f: TFile, level: number, detail?: string) => row(parent, docket, f.basename, (where) => {
		if (where === 'insert') return;
		docket.close();
		void openFileIn(app, f, where);
	}, { icon: 'file-text', level, detail, actions: () => noteActions(app, docket, f) });

	const folderTree = (parent: HTMLElement, items: TFolder['children'], level: number) => {
		const children = [...items].sort((a, b) => (a instanceof TFolder ? 0 : 1) - (b instanceof TFolder ? 0 : 1) || a.name.localeCompare(b.name));
		for (const c of children) {
			if (c instanceof TFolder) {
				if (c.name.startsWith('.')) continue;
				const expanded = open.has(c.path);
				const notes = countNotes(c);
				const r = row(parent, docket, c.name, () => { if (expanded) open.delete(c.path); else open.add(c.path); void docket.refreshPanel(); }, {
					icon: expanded ? 'folder-open' : 'folder', level, badge: String(notes), actions: () => folderActions(c),
					detail: level === 0 ? UNIT_LABELS.level1 : level === 1 ? UNIT_LABELS.level2 : null,
				});
				r.setAttribute('aria-expanded', String(expanded));
				if (expanded) folderTree(parent, c.children, level + 1);
			} else if (c instanceof TFile && c.extension === 'md' && !app.isLocked(c)) {
				noteRow(parent, c, level);
			}
		}
	};

	return {
		id: 'core:units', title: 'Units', icon: 'folders', order: 3, source: 'core',
		render: (el) => {
			const active = app.workspace.getActiveFile();
			// Open the way to the open note.
			if (active) { const parts = active.path.split('/'); for (let i = 1; i < parts.length; i++) open.add(parts.slice(0, i).join('/')); }

			const pinned = (app.config.pinnedNotes ?? []).map((p) => app.vault.getFileByPath(p)).filter((f): f is TFile => !!f && !app.isLocked(f));
			if (pinned.length) {
				const sec = section(el, 'Pinned', pinned.length);
				for (const f of pinned) noteRow(sec, f, 0, f.parent && !f.parent.isRoot() ? f.parent.path : undefined);
			}
			const recent = app.search.usage.recent('note', 12).map((p) => app.vault.getFileByPath(p)).filter((f): f is TFile => !!f && !app.isLocked(f) && !pinned.includes(f)).slice(0, 5);
			if (recent.length) {
				const sec = section(el, 'Recent', recent.length);
				for (const f of recent) noteRow(sec, f, 0, f.parent && !f.parent.isRoot() ? f.parent.path : undefined);
			}

			const root = app.vault.getRoot();
			const archive = archiveRoot(app);
			const sec = section(el, UNIT_LABELS.plural1);
			row(sec, docket, `New ${UNIT_LABELS.level1.toLowerCase()}`, () => app.commands.executeCommandById('app:new-folder', { folder: root }), { icon: 'folder-plus', cls: 'is-command' });
			row(sec, docket, 'New note', () => { docket.close(); app.commands.executeCommandById('app:new-note', { folder: active?.parent ?? root }); }, { icon: 'square-pen', cls: 'is-command' });
			if (!root.children.some((c) => c instanceof TFolder || (c instanceof TFile && c.extension === 'md'))) empty(sec, 'No notes yet.');
			folderTree(sec, root.children.filter((c) => !(c instanceof TFolder && isArchived(app, c))), 0);
			const arch = app.vault.getFolderByPath(archive);
			if (arch) {
				const as = section(el, 'Archive', countNotes(arch));
				folderTree(as, arch.children, 0);
			}
		},
	};
}

function countNotes(folder: TFolder): number {
	let n = 0;
	for (const c of folder.children) n += c instanceof TFolder ? countNotes(c) : c instanceof TFile && c.extension === 'md' ? 1 : 0;
	return n;
}
