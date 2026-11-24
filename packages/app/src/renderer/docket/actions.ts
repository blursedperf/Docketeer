/**
 * Actions on notes, wherever a note appears in the Docket (search results, Units, Authorities): the
 * file commands, pin and archive, links to and from the note, and every action plugins add to the file
 * menu (export to Word, version history …), so nothing that was a right-click away is out of reach.
 */
import { type App, Menu, type SearchResult, TFile, TFolder } from '@quire/api';
import type { ActionItem, Docket } from './docket';
import { openFileIn } from './providers';

/** Pin and archive, as commands (so they are in the Docket, the palette and Hotkeys). */
export function registerNoteCommands(app: App): void {
	const fileArg = (args: Record<string, unknown>) => (args.file instanceof TFile ? args.file : app.workspace.getActiveFile());
	app.commands.addCommand({
		id: 'app:toggle-pin-note', name: 'Pin or unpin note in Units', icon: 'pin', section: 'Notes', aliases: ['Pin note', 'Unpin note'],
		when: (ctx) => !!fileArg(ctx.args),
		run: (ctx) => togglePin(app, fileArg(ctx.args)!),
	});
	app.commands.addCommand({
		id: 'app:archive-note', name: 'Archive note', icon: 'archive', section: 'Notes', aliases: ['Move to archive'],
		when: (ctx) => { const f = fileArg(ctx.args); return !!f && !isArchived(app, f); },
		run: (ctx) => archive(app, fileArg(ctx.args)!),
	});
	// Keep pins pointing at notes that move, and drop pins of deleted notes.
	app.vault.on('rename', (f, old: string) => {
		const pins = app.config.pinnedNotes ?? [];
		if (pins.includes(old)) void app.setConfig('pinnedNotes', pins.map((p) => (p === old ? f.path : p)));
	});
	app.vault.on('delete', (f) => {
		const pins = app.config.pinnedNotes ?? [];
		if (pins.includes(f.path)) void app.setConfig('pinnedNotes', pins.filter((p) => p !== f.path));
	});
}

export function isPinned(app: App, f: TFile): boolean {
	return (app.config.pinnedNotes ?? []).includes(f.path);
}

async function togglePin(app: App, f: TFile): Promise<void> {
	const pins = app.config.pinnedNotes ?? [];
	await app.setConfig('pinnedNotes', pins.includes(f.path) ? pins.filter((p) => p !== f.path) : [...pins, f.path]);
}

export function archiveRoot(app: App): string {
	return String(app.config.archiveFolder || 'Archive').replace(/^\/+|\/+$/g, '');
}

export function isArchived(app: App, f: TFile | TFolder): boolean {
	const root = archiveRoot(app);
	return f.path === root || f.path.startsWith(`${root}/`);
}

/** Move a note into the archive folder, keeping its folders (Torts/Duty/x.md → Archive/Torts/Duty/x.md). */
async function archive(app: App, f: TFile): Promise<void> {
	const to = `${archiveRoot(app)}/${f.path}`;
	const folder = to.slice(0, to.lastIndexOf('/'));
	if (!app.vault.getFolderByPath(folder)) await app.vault.createFolder(folder);
	await app.fileManager.renameFile(f, to);
}

/** The plugins' file-menu items for `file`, as actions. */
export function pluginFileActions(app: App, file: TFile | TFolder): ActionItem[] {
	const menu = new Menu();
	app.workspace.trigger('file-menu', menu, file, 'docket', null);
	return menu.listItems().map((i) => ({ title: i.title, icon: i.icon ?? undefined, run: () => i.run() }));
}

/** Everything that can be done to a note. */
export function noteActions(app: App, docket: Docket, file: TFile): ActionItem[] {
	const cmd = (id: string, title?: string): ActionItem | null => {
		const c = app.commands.findCommand(id);
		const args = { file };
		if (!c || !app.commands.isAvailable(c, args)) return null;
		return { title: title ?? c.name, icon: c.icon, run: () => app.commands.executeCommand(c, args) };
	};
	const list: (ActionItem | null)[] = [
		{ title: 'Open', icon: 'arrow-right', run: () => openFileIn(app, file, 'current') },
		{ title: 'Open to the right', icon: 'separator-vertical', run: () => openFileIn(app, file, 'right') },
		{ title: 'Open below', icon: 'separator-horizontal', run: () => openFileIn(app, file, 'below') },
		cmd('app:open-in-new-tab'),
		{ title: 'Notes linking here', icon: 'link', run: () => showLinksTo(app, docket, file) },
		{ title: 'Links from this note', icon: 'arrow-up-right', run: () => showLinksFrom(app, docket, file) },
		cmd('app:toggle-pin-note', isPinned(app, file) ? 'Unpin from Units' : 'Pin to Units'),
		cmd('app:rename-file', 'Rename…'),
		cmd('app:move-file', 'Move to…'),
		cmd('app:copy-file'),
		cmd('app:archive-note'),
		cmd('app:delete-file', 'Delete…'),
		cmd('app:show-in-folder'),
		...pluginFileActions(app, file),
	];
	return list.filter((a): a is ActionItem => !!a);
}

function noteResult(app: App, file: TFile, detail?: string, at?: { from: number; to: number }): SearchResult {
	return {
		id: `${file.path}:${at?.from ?? 0}`, type: 'Notes', title: file.basename, detail, icon: 'file-text', file,
		open: async (where) => {
			await openFileIn(app, file, where);
			if (at) app.workspace.activeEditor?.editor?.setSelection(app.workspace.activeEditor.editor.offsetToPos(at.from), app.workspace.activeEditor.editor.offsetToPos(at.to));
		},
		insert: () => `[[${app.metadataCache.fileToLinktext(file, app.workspace.getActiveFile()?.path ?? '')}]]`,
	};
}

/** Notes linking to `file`, with the line of each link (Backlinks, in the Docket). */
export async function showLinksTo(app: App, docket: Docket, file: TFile): Promise<void> {
	const out: SearchResult[] = [];
	for (const [path, links] of app.metadataCache.getBacklinksForFile(file)) {
		const src = app.vault.getFileByPath(path);
		if (!src || src === file || app.isLocked(src)) continue;
		const text = await app.vault.cachedRead(src);
		for (const l of links.slice(0, 5)) {
			const a = l.position.start.offset;
			const line = text.slice(text.lastIndexOf('\n', a - 1) + 1, (text.indexOf('\n', a) + 1 || text.length + 1) - 1).trim();
			out.push(noteResult(app, src, line, { from: a, to: l.position.end.offset }));
		}
	}
	docket.showList(`Links to ${file.basename}`, out);
}

/** Links from `file`: notes it links to, and links to notes that do not exist yet (Enter creates them). */
export function showLinksFrom(app: App, docket: Docket, file: TFile): void {
	const out: SearchResult[] = [];
	for (const path of Object.keys(app.metadataCache.resolvedLinks[file.path] ?? {})) {
		const f = app.vault.getFileByPath(path);
		if (f && !app.isLocked(f)) out.push(noteResult(app, f, f.parent && !f.parent.isRoot() ? f.parent.path : undefined));
	}
	for (const name of Object.keys(app.metadataCache.unresolvedLinks[file.path] ?? {})) {
		out.push({
			id: `unresolved:${name}`, type: 'Notes', title: name, detail: 'Not created yet: Enter creates it', icon: 'file-plus',
			open: (where) => app.workspace.openLinkText(name, file.path, where === 'current' ? false : 'split'),
		});
	}
	docket.showList(`Links from ${file.basename}`, out);
}
