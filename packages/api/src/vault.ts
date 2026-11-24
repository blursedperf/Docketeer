import { Events, type EventRef } from './events';
import { TAbstractFile, TFile, TFolder } from './files';
import type { HostBridge, HostEntry, HostFsEvent, HostStat } from './host';
import { normalizePath } from './util';

/** Direct access to files by path, including hidden folders the vault does not index. */
export class DataAdapter {
	constructor(private host: HostBridge) {}

	getName(): string { return this.host.vault?.name ?? ''; }
	getBasePath(): string { return this.host.vault?.path ?? ''; }

	exists(path: string): Promise<boolean> { return this.host.fs.exists(rel(path)); }
	async stat(path: string): Promise<HostStat | null> { return this.host.fs.stat(rel(path)); }
	read(path: string): Promise<string> { return this.host.fs.read(rel(path)); }
	readBinary(path: string): Promise<ArrayBuffer> { return this.host.fs.readBinary(rel(path)); }
	async write(path: string, data: string): Promise<void> { await this.host.fs.write(rel(path), data); }
	async writeBinary(path: string, data: ArrayBuffer): Promise<void> { await this.host.fs.writeBinary(rel(path), data); }
	async append(path: string, data: string): Promise<void> { await this.host.fs.append(rel(path), data); }
	async process(path: string, fn: (data: string) => string): Promise<string> {
		const next = fn(await this.read(path));
		await this.write(path, next);
		return next;
	}
	mkdir(path: string): Promise<void> { return this.host.fs.mkdir(rel(path)); }
	list(path: string): Promise<{ files: string[]; folders: string[] }> { return this.host.fs.list(rel(path)); }
	remove(path: string): Promise<void> { return this.host.fs.remove(rel(path)); }
	rmdir(path: string, recursive: boolean): Promise<void> { return this.host.fs.rmdir(rel(path), recursive); }
	rename(from: string, to: string): Promise<void> { return this.host.fs.rename(rel(from), rel(to)); }
	copy(from: string, to: string): Promise<void> { return this.host.fs.copy(rel(from), rel(to)); }
	trashSystem(path: string): Promise<boolean> { return this.host.fs.trash(rel(path)); }
}

function rel(path: string): string {
	const p = normalizePath(path);
	return p === '/' ? '' : p;
}

function parentOf(path: string): string {
	const i = path.lastIndexOf('/');
	return i === -1 ? '/' : path.slice(0, i);
}

function isHidden(path: string): boolean {
	return path.split('/').some((seg) => seg.startsWith('.'));
}

/**
 * The vault's files and folders, kept in step with the disk. Hidden files and folders (names starting
 * with ".") are not indexed: reach them through `adapter`.
 */
export class Vault extends Events {
	readonly adapter: DataAdapter;
	private files = new Map<string, TAbstractFile>();
	private root: TFolder;
	private cache = new Map<string, string>();
	/** mtimes of our own writes, so the watcher's echo of them is ignored. */
	private written = new Map<string, number>();
	configDir = '.quire';
	private config: Record<string, unknown> = {};

	constructor(private host: HostBridge) {
		super();
		this.adapter = new DataAdapter(host);
		this.root = new TFolder('/');
		this.root.vault = this;
		this.files.set('/', this.root);
	}

	getName(): string { return this.host.vault?.name ?? ''; }

	/** Read the whole tree from disk. */
	async load(): Promise<void> {
		const entries = await this.host.fs.tree('');
		entries.sort((a, b) => a.path.split('/').length - b.path.split('/').length);
		for (const e of entries) this.addEntry(e, false);
		this.host.onFsEvents((events) => { void this.onExternal(events); });
	}

	setConfigValues(config: Record<string, unknown>): void { this.config = config; }
	getConfig(key: string): unknown { return this.config[key]; }

	// ---------------------------------------------------------------------------------------------
	// Lookup

	getRoot(): TFolder { return this.root; }

	getAbstractFileByPath(path: string): TAbstractFile | null {
		return this.files.get(normalizePath(path)) ?? null;
	}

	getFileByPath(path: string): TFile | null {
		const f = this.getAbstractFileByPath(path);
		return f instanceof TFile ? f : null;
	}

	getFolderByPath(path: string): TFolder | null {
		const f = this.getAbstractFileByPath(path);
		return f instanceof TFolder ? f : null;
	}

	getAllLoadedFiles(): TAbstractFile[] { return [...this.files.values()]; }
	getFiles(): TFile[] { return [...this.files.values()].filter((f): f is TFile => f instanceof TFile); }
	getMarkdownFiles(): TFile[] { return this.getFiles().filter((f) => f.extension === 'md'); }
	getAllFolders(includeRoot = false): TFolder[] {
		return [...this.files.values()].filter((f): f is TFolder => f instanceof TFolder && (includeRoot || !f.isRoot()));
	}

	// ---------------------------------------------------------------------------------------------
	// Reading

	async read(file: TFile): Promise<string> {
		const text = await this.host.fs.read(file.path);
		this.cache.set(file.path, text);
		return text;
	}

	async cachedRead(file: TFile): Promise<string> {
		const hit = this.cache.get(file.path);
		return hit !== undefined ? hit : this.read(file);
	}

	readBinary(file: TFile): Promise<ArrayBuffer> { return this.host.fs.readBinary(file.path); }

	getResourcePath(file: TFile): string {
		return `quire://app/vault/${file.path.split('/').map(encodeURIComponent).join('/')}?${file.stat.mtime}`;
	}

	// ---------------------------------------------------------------------------------------------
	// Writing

	private assertFree(path: string) {
		if (this.files.has(path)) throw new Error(`File already exists: ${path}`);
	}

	private async ensureFolder(path: string): Promise<TFolder> {
		if (path === '/' || path === '') return this.root;
		const existing = this.files.get(path);
		if (existing instanceof TFolder) return existing;
		if (existing) throw new Error(`Not a folder: ${path}`);
		await this.ensureFolder(parentOf(path));
		await this.host.fs.mkdir(path);
		const stat = await this.host.fs.stat(path);
		const folder = this.addEntry({ path, type: 'folder', size: 0, mtime: stat?.mtime ?? Date.now(), ctime: stat?.ctime ?? Date.now() }, true);
		return folder as TFolder;
	}

	async create(path: string, data: string): Promise<TFile> {
		const p = normalizePath(path);
		this.assertFree(p);
		await this.ensureFolder(parentOf(p));
		const stat = await this.host.fs.write(p, data);
		this.written.set(p, stat.mtime);
		this.cache.set(p, data);
		return this.addEntry({ path: p, ...stat }, true) as TFile;
	}

	async createBinary(path: string, data: ArrayBuffer): Promise<TFile> {
		const p = normalizePath(path);
		this.assertFree(p);
		await this.ensureFolder(parentOf(p));
		const stat = await this.host.fs.writeBinary(p, data);
		this.written.set(p, stat.mtime);
		return this.addEntry({ path: p, ...stat }, true) as TFile;
	}

	async createFolder(path: string): Promise<TFolder> {
		const p = normalizePath(path);
		this.assertFree(p);
		return this.ensureFolder(p);
	}

	async modify(file: TFile, data: string): Promise<void> {
		const stat = await this.host.fs.write(file.path, data);
		this.written.set(file.path, stat.mtime);
		this.cache.set(file.path, data);
		file.stat = { ctime: stat.ctime, mtime: stat.mtime, size: stat.size };
		this.trigger('modify', file);
	}

	async modifyBinary(file: TFile, data: ArrayBuffer): Promise<void> {
		const stat = await this.host.fs.writeBinary(file.path, data);
		this.written.set(file.path, stat.mtime);
		this.cache.delete(file.path);
		file.stat = { ctime: stat.ctime, mtime: stat.mtime, size: stat.size };
		this.trigger('modify', file);
	}

	async append(file: TFile, data: string): Promise<void> {
		const stat = await this.host.fs.append(file.path, data);
		this.written.set(file.path, stat.mtime);
		this.cache.delete(file.path);
		file.stat = { ctime: stat.ctime, mtime: stat.mtime, size: stat.size };
		this.trigger('modify', file);
	}

	/** Change a file's text with `fn`, from its current content on disk. */
	async process(file: TFile, fn: (data: string) => string): Promise<string> {
		const before = await this.read(file);
		const after = fn(before);
		if (after !== before) await this.modify(file, after);
		return after;
	}

	async delete(file: TAbstractFile, force = true): Promise<void> {
		if (file instanceof TFolder) await this.host.fs.rmdir(file.path, force);
		else await this.host.fs.remove(file.path);
		this.removeEntry(file);
	}

	/** Move to the system trash (or delete when that fails and `system` is false). */
	async trash(file: TAbstractFile, system = true): Promise<void> {
		const ok = system ? await this.host.fs.trash(file.path) : false;
		if (!ok) await this.delete(file, true);
		else this.removeEntry(file);
	}

	async rename(file: TAbstractFile, newPath: string): Promise<void> {
		const to = normalizePath(newPath);
		if (to === file.path) return;
		this.assertFree(to);
		await this.ensureFolder(parentOf(to));
		await this.host.fs.rename(file.path, to);
		this.moveEntry(file, to);
	}

	async copy(file: TFile, newPath: string): Promise<TFile> {
		const to = normalizePath(newPath);
		this.assertFree(to);
		await this.host.fs.copy(file.path, to);
		const stat = await this.host.fs.stat(to);
		return this.addEntry({ path: to, type: 'file', size: stat?.size ?? 0, mtime: stat?.mtime ?? Date.now(), ctime: stat?.ctime ?? Date.now() }, true) as TFile;
	}

	// ---------------------------------------------------------------------------------------------
	// Index

	private addEntry(e: HostEntry, notify: boolean): TAbstractFile {
		const existing = this.files.get(e.path);
		if (existing) return existing;
		const parentPath = parentOf(e.path);
		let parent = this.files.get(parentPath);
		if (!(parent instanceof TFolder)) {
			parent = this.addEntry({ path: parentPath, type: 'folder', size: 0, mtime: e.mtime, ctime: e.ctime }, notify);
		}
		const f = e.type === 'folder' ? new TFolder(e.path) : new TFile(e.path);
		f.vault = this;
		if (f instanceof TFile) f.stat = { ctime: e.ctime, mtime: e.mtime, size: e.size };
		f.parent = parent as TFolder;
		(parent as TFolder).children.push(f);
		this.files.set(e.path, f);
		if (notify) this.trigger('create', f);
		return f;
	}

	private removeEntry(f: TAbstractFile) {
		if (!this.files.has(f.path)) return;
		if (f instanceof TFolder) for (const c of [...f.children]) this.removeEntry(c);
		this.files.delete(f.path);
		this.cache.delete(f.path);
		if (f.parent) f.parent.children = f.parent.children.filter((c) => c !== f);
		this.trigger('delete', f);
	}

	private moveEntry(f: TAbstractFile, to: string) {
		const old = f.path;
		const newParent = this.files.get(parentOf(to)) as TFolder;
		if (f.parent) f.parent.children = f.parent.children.filter((c) => c !== f);
		f.parent = newParent;
		newParent.children.push(f);
		const moves: [TAbstractFile, string][] = [];
		const visit = (x: TAbstractFile, path: string) => {
			moves.push([x, x.path]);
			this.files.delete(x.path);
			const cached = this.cache.get(x.path);
			this.cache.delete(x.path);
			x.setPath(path);
			this.files.set(path, x);
			if (cached !== undefined) this.cache.set(path, cached);
			if (x instanceof TFolder) for (const c of x.children) visit(c, `${path}/${c.name}`);
		};
		visit(f, to);
		for (const [x, oldPath] of moves) this.trigger('rename', x, oldPath);
		void old;
	}

	/** Changes made outside the app (or echoes of ours, which are ignored). */
	private async onExternal(events: HostFsEvent[]) {
		for (const ev of events) {
			const path = normalizePath(ev.path);
			if (path === '/' || isHidden(path)) continue;
			const known = this.files.get(path);
			if (!ev.stat) {
				if (known) this.removeEntry(known);
				continue;
			}
			if (!known) {
				if (ev.stat.type === 'folder') {
					this.addEntry({ path, ...ev.stat }, true);
					for (const e of (await this.host.fs.tree(path)).sort((a, b) => a.path.length - b.path.length)) this.addEntry(e, true);
				} else {
					this.addEntry({ path, ...ev.stat }, true);
				}
				continue;
			}
			if (known instanceof TFile && ev.stat.type === 'file') {
				if (this.written.get(path) === ev.stat.mtime || known.stat.mtime === ev.stat.mtime) continue;
				known.stat = { ctime: ev.stat.ctime, mtime: ev.stat.mtime, size: ev.stat.size };
				this.cache.delete(path);
				this.trigger('modify', known);
			}
		}
	}

	override on(name: 'create' | 'modify' | 'delete', callback: (file: TAbstractFile) => unknown, ctx?: unknown): EventRef;
	override on(name: 'rename', callback: (file: TAbstractFile, oldPath: string) => unknown, ctx?: unknown): EventRef;
	override on(name: string, callback: (...data: any[]) => unknown, ctx?: unknown): EventRef;
	override on(name: string, callback: (...data: any[]) => unknown, ctx?: unknown): EventRef {
		return super.on(name, callback, ctx);
	}

	static recurseChildren(root: TFolder, cb: (file: TAbstractFile) => unknown): void {
		const stack: TAbstractFile[] = [root];
		while (stack.length) {
			const f = stack.pop()!;
			cb(f);
			if (f instanceof TFolder) stack.push(...f.children);
		}
	}
}
