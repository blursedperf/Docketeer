import type { App } from './app';
import { TFile } from './files';
import { normalizePath } from './util';

/** File types drawn as pictures when embedded. */
export const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif']);

export function isImage(name: string): boolean {
	return IMAGE_EXTENSIONS.has(name.slice(name.lastIndexOf('.') + 1).toLowerCase());
}

/**
 * The folder for attachments of the note at `sourcePath`, from the setting "Folder for attachments":
 * a path from the homebase root ("attachments"), "./" for the note's own folder, or "./name" for a
 * folder beside the note.
 */
export function attachmentFolder(app: App, sourcePath: string): string {
	const setting = String(app.vault.getConfig('attachmentFolder') ?? 'attachments').trim() || 'attachments';
	const noteDir = sourcePath.includes('/') ? sourcePath.slice(0, sourcePath.lastIndexOf('/')) : '';
	if (setting === '.' || setting === './') return noteDir;
	if (setting.startsWith('./')) return normalizePath(`${noteDir}/${setting.slice(2)}`).replace(/^\/$/, '');
	const p = normalizePath(setting);
	return p === '/' ? '' : p;
}

/** A path in `folder` for `name` that is not taken ("name 1.png", "name 2.png" …). */
export function availablePath(app: App, folder: string, name: string): string {
	const dot = name.lastIndexOf('.');
	const base = dot > 0 ? name.slice(0, dot) : name;
	const ext = dot > 0 ? name.slice(dot) : '';
	const at = (n: number) => normalizePath(`${folder ? `${folder}/` : ''}${base}${n ? ` ${n}` : ''}${ext}`);
	let n = 0;
	while (app.vault.getAbstractFileByPath(at(n))) n++;
	return at(n);
}

/** A file name safe on every system (no / \ : * ? " < > | # ^ [ ]). */
export function safeFileName(name: string): string {
	return name.replace(/[\\/:*?"<>|#^[\]]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Attachment';
}

/** Name for a pasted image that has no name of its own. */
export function pastedName(ext: string): string {
	const d = new Date();
	const p = (n: number) => String(n).padStart(2, '0');
	return `Pasted image ${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.${ext}`;
}

/** Save `data` as an attachment of the note at `sourcePath`; returns the new file. */
export async function saveAttachment(app: App, data: ArrayBuffer, name: string, sourcePath: string): Promise<TFile> {
	const folder = attachmentFolder(app, sourcePath);
	return app.vault.createBinary(availablePath(app, folder, safeFileName(name)), data);
}

/** The Markdown that embeds (pictures) or links (anything else) `file` from the note at `sourcePath`. */
export function embedMarkdown(app: App, file: TFile, sourcePath: string): string {
	const link = app.metadataCache.fileToLinktext(file, sourcePath, file.extension === 'md');
	return isImage(file.name) ? `![[${link}]]` : `[[${link}]]`;
}

/** Save files pasted or dropped into a note; returns the Markdown to insert for them. */
export async function attachFiles(app: App, files: File[], sourcePath: string): Promise<string> {
	const parts: string[] = [];
	for (const f of files) {
		const ext = (f.type.split('/')[1] ?? 'png').replace('jpeg', 'jpg').replace('svg+xml', 'svg');
		const name = f.name && f.name !== 'image.png' ? f.name : pastedName(ext);
		const file = await saveAttachment(app, await f.arrayBuffer(), name, sourcePath);
		parts.push(embedMarkdown(app, file, sourcePath));
	}
	return parts.join('\n');
}

