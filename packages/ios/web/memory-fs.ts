/**
 * A homebase held in memory, for the Phase 0 spike: the example homebase, seeded from the app bundle, behaves as
 * the desktop host's files do (same paths, same errors, same tree and list rules) but nothing is saved. Phase 1
 * replaces it with the native HomebaseFS.
 */
import type { HostEntry, HostFs, HostStat } from '@quire/api';

interface Node {
	type: 'file' | 'folder';
	data: Uint8Array;
	mtime: number;
	ctime: number;
}

/** A file to start with: its path in the homebase, and its text or bytes. */
export interface SeedFile {
	path: string;
	data: string | Uint8Array;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

function fsError(code: 'ENOENT' | 'EEXIST' | 'ENOTDIR' | 'EISDIR' | 'ENOTEMPTY', op: string, path: string): Error {
	const words = { ENOENT: 'no such file or directory', EEXIST: 'file already exists', ENOTDIR: 'not a directory', EISDIR: 'illegal operation on a directory', ENOTEMPTY: 'directory not empty' };
	return Object.assign(new Error(`${code}: ${words[code]}, ${op} '${path}'`), { code });
}

/** A homebase path: forward slashes, no leading or trailing slash, "" for the root. Refuses ".." and NUL. */
export function normalise(path: string): string {
	if (typeof path !== 'string' || path.includes('\0')) throw new Error('Invalid path');
	const parts: string[] = [];
	for (const p of path.split(/[/\\]+/)) {
		if (p === '' || p === '.') continue;
		if (p === '..') throw new Error(`Path outside the homebase: ${path}`);
		parts.push(p);
	}
	return parts.join('/');
}

const parentOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
const nameOf = (p: string) => p.slice(p.lastIndexOf('/') + 1);
const toBuffer = (u8: Uint8Array): ArrayBuffer => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;

export class MemoryFs implements HostFs {
	private nodes = new Map<string, Node>();
	private clock: () => number;

	constructor(seed: SeedFile[] = [], clock: () => number = Date.now) {
		this.clock = clock;
		const now = clock();
		this.nodes.set('', { type: 'folder', data: new Uint8Array(), mtime: now, ctime: now });
		for (const f of seed) this.put(normalise(f.path), typeof f.data === 'string' ? enc.encode(f.data) : f.data);
	}

	private statOf(n: Node): HostStat {
		return { type: n.type, size: n.type === 'file' ? n.data.byteLength : 0, mtime: n.mtime, ctime: n.ctime };
	}

	private file(p: string, op: string): Node {
		const n = this.nodes.get(p);
		if (!n) throw fsError('ENOENT', op, p);
		if (n.type === 'folder') throw fsError('EISDIR', op, p);
		return n;
	}

	private ensureFolder(p: string): void {
		const n = this.nodes.get(p);
		if (n) {
			if (n.type !== 'folder') throw fsError('ENOTDIR', 'mkdir', p);
			return;
		}
		this.ensureFolder(parentOf(p));
		const now = this.clock();
		this.nodes.set(p, { type: 'folder', data: new Uint8Array(), mtime: now, ctime: now });
	}

	private put(p: string, data: Uint8Array): HostStat {
		if (p === '') throw fsError('EISDIR', 'open', p);
		this.ensureFolder(parentOf(p));
		const old = this.nodes.get(p);
		if (old?.type === 'folder') throw fsError('EISDIR', 'open', p);
		const now = this.clock();
		const n: Node = { type: 'file', data, mtime: now, ctime: old?.ctime ?? now };
		this.nodes.set(p, n);
		return this.statOf(n);
	}

	/** The paths under `p` (not `p` itself), deepest last. */
	private under(p: string): string[] {
		const prefix = p === '' ? '' : `${p}/`;
		return [...this.nodes.keys()].filter((k) => k !== p && k.startsWith(prefix));
	}

	private children(p: string): string[] {
		return this.under(p).filter((k) => parentOf(k) === p).sort();
	}

	async tree(path: string): Promise<HostEntry[]> {
		const out: HostEntry[] = [];
		const walk = (dir: string) => {
			for (const c of this.children(dir)) {
				if (nameOf(c).startsWith('.')) continue;
				const n = this.nodes.get(c)!;
				out.push({ path: c, ...this.statOf(n) });
				if (n.type === 'folder') walk(c);
			}
		};
		const root = normalise(path);
		if (this.nodes.get(root)?.type === 'folder') walk(root);
		return out;
	}

	async stat(path: string): Promise<HostStat | null> {
		const n = this.nodes.get(normalise(path));
		return n ? this.statOf(n) : null;
	}

	async exists(path: string): Promise<boolean> {
		return this.nodes.has(normalise(path));
	}

	async read(path: string): Promise<string> {
		return dec.decode(this.file(normalise(path), 'open').data);
	}

	async readBinary(path: string): Promise<ArrayBuffer> {
		return toBuffer(this.file(normalise(path), 'open').data);
	}

	async write(path: string, data: string): Promise<HostStat> {
		return this.put(normalise(path), enc.encode(String(data)));
	}

	async writeBinary(path: string, data: ArrayBuffer): Promise<HostStat> {
		return this.put(normalise(path), new Uint8Array(data.slice(0)));
	}

	async append(path: string, data: string): Promise<HostStat> {
		const p = normalise(path);
		const old = this.nodes.get(p);
		const add = enc.encode(String(data));
		if (!old) return this.put(p, add);
		const both = new Uint8Array(this.file(p, 'open').data.byteLength + add.byteLength);
		both.set(old.data);
		both.set(add, old.data.byteLength);
		return this.put(p, both);
	}

	async mkdir(path: string): Promise<void> {
		this.ensureFolder(normalise(path));
	}

	async list(path: string): Promise<{ files: string[]; folders: string[] }> {
		const p = normalise(path);
		const n = this.nodes.get(p);
		if (!n) throw fsError('ENOENT', 'scandir', p);
		if (n.type !== 'folder') throw fsError('ENOTDIR', 'scandir', p);
		const files: string[] = [];
		const folders: string[] = [];
		for (const c of this.children(p)) (this.nodes.get(c)!.type === 'folder' ? folders : files).push(c);
		return { files, folders };
	}

	async remove(path: string): Promise<void> {
		const p = normalise(path);
		this.file(p, 'unlink');
		this.nodes.delete(p);
	}

	async rmdir(path: string, recursive: boolean): Promise<void> {
		const p = normalise(path);
		if (p === '') throw new Error('Cannot remove the homebase');
		const n = this.nodes.get(p);
		if (!n) throw fsError('ENOENT', 'rm', p);
		const inside = this.under(p);
		if (n.type === 'folder' && inside.length && !recursive) throw fsError('ENOTEMPTY', 'rm', p);
		for (const k of inside) this.nodes.delete(k);
		this.nodes.delete(p);
	}

	async rename(from: string, to: string): Promise<void> {
		const a = normalise(from);
		const b = normalise(to);
		const n = this.nodes.get(a);
		if (!n || a === '') throw fsError('ENOENT', 'rename', a);
		if (a === b) return;
		if (b.startsWith(`${a}/`)) throw new Error(`Cannot move a folder into itself: ${a}`);
		this.ensureFolder(parentOf(b));
		const moved = [a, ...this.under(a)].map((k) => [k, this.nodes.get(k)!] as const);
		for (const [k] of moved) this.nodes.delete(k);
		for (const k of this.under(b)) this.nodes.delete(k);
		for (const [k, node] of moved) this.nodes.set(b + k.slice(a.length), node);
	}

	async copy(from: string, to: string): Promise<void> {
		const src = this.file(normalise(from), 'copyfile');
		this.put(normalise(to), src.data.slice());
	}

	async trash(path: string): Promise<boolean> {
		const p = normalise(path);
		if (p === '') throw new Error('Cannot remove the homebase');
		if (!this.nodes.has(p)) return false;
		await this.rmdir(p, true);
		return true;
	}
}
