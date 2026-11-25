/**
 * Dragging files and folders in the Docket's trees and lists: a row carries its path (so dropping it on a note
 * inserts a link or embed, as dragging from the file manager does), and a folder's rows take drops: what is dropped
 * moves into that folder, links following as with "Move file to another folder".
 */
import { type App, Notice, TFolder } from '@quire/api';
import { moveTarget } from './drag-paths';

/** The type the editor's drop handler reads (see cm-setup.ts, onDropPath). */
export const PATH_TYPE = 'text/x-quire-path';

/** Let `el` be dragged, carrying `path`. */
export function draggablePath(el: HTMLElement, path: string): void {
	el.draggable = true;
	el.addEventListener('dragstart', (e) => {
		e.dataTransfer?.setData(PATH_TYPE, path);
		e.dataTransfer?.setData('text/plain', path);
		if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copyMove';
		el.addClass('is-dragging');
	});
	el.addEventListener('dragend', () => el.removeClass('is-dragging'));
}

/** Let `el` take drops of files and folders, moving them into `folder` ('' for the top of the homebase). */
export function dropIntoFolder(el: HTMLElement, app: App, folder: string): void {
	el.addEventListener('dragover', (e) => {
		if (!e.dataTransfer?.types.includes(PATH_TYPE)) return;
		e.preventDefault();
		e.dataTransfer.dropEffect = 'move';
		el.addClass('is-drop-target');
	});
	el.addEventListener('dragleave', () => el.removeClass('is-drop-target'));
	el.addEventListener('drop', (e) => {
		el.removeClass('is-drop-target');
		const path = e.dataTransfer?.getData(PATH_TYPE);
		if (!path) return;
		e.preventDefault();
		e.stopPropagation();
		const f = app.vault.getAbstractFileByPath(path);
		if (!f) return;
		const t = moveTarget(path, f instanceof TFolder, folder);
		if (!t) return;
		if ('refuse' in t) { new Notice(t.refuse); return; }
		if (app.vault.getAbstractFileByPath(t.to)) { new Notice(`There is already a “${f.name}” there.`); return; }
		app.fileManager.renameFile(f, t.to).catch((err: unknown) => new Notice(err instanceof Error ? err.message : String(err)));
	});
}
