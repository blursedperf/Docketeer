/** Path logic for dragging files and folders (no app, no DOM: tested on its own). */

/** Where `path` would go when dropped into `folder` ('' for the top), or why it cannot. */
export function moveTarget(path: string, isFolder: boolean, folder: string): { to: string } | { refuse: string } | null {
	const name = path.split('/').pop()!;
	const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
	if (parent === folder) return null; // already there: nothing to do
	if (isFolder && (folder === path || folder.startsWith(`${path}/`))) return { refuse: 'A folder cannot go inside itself.' };
	return { to: folder ? `${folder}/${name}` : name };
}
