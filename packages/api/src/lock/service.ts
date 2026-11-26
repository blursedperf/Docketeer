/**
 * Locking for the homebase: holds the key while unlocked, knows which notes are sealed on disk and which
 * folders are locked, and sits under the vault so reading a locked note decrypts it (or refuses while
 * locked) and writing one encrypts it. See docs/docket/locking.md.
 */
import type { App } from '../app';
import { Events } from '../events';
import { TFile, TFolder, type TAbstractFile } from '../files';
import { type LockFile, changePassphrase, createLock, isSealed, open, recover, seal, unlockWithPassphrase } from './crypto';

/** Thrown when a locked note is read or written while the homebase is locked. Never names the note. */
export class LockedError extends Error {
	constructor(message = 'This note is locked. Unlock to open it.') { super(message); this.name = 'LockedError'; }
}

/** What the vault asks of locking (kept small so the vault does not depend on crypto). */
export interface VaultCrypt {
	onRead(path: string, raw: string): Promise<string>;
	onWrite(path: string, plain: string): Promise<string>;
	isEncrypted(path: string): boolean;
	onCopy(from: string, to: string): void;
}

export class LockService extends Events implements VaultCrypt {
	private lockFile: LockFile | null = null;
	private key: CryptoKey | null = null;
	/** Notes found sealed on disk (or sealed by Docketeer). */
	private sealed = new Set<string>();
	/** Asks the user to unlock (set by the app's interface); resolves true when unlocked. */
	prompt: (() => Promise<boolean>) | null = null;
	private iterations: number | undefined;

	constructor(private app: App, opts: { iterations?: number } = {}) {
		super();
		this.iterations = opts.iterations;
		app.vault.crypt = this;
		app.vault.on('rename', (f: TAbstractFile, old: string) => this.onRename(f, old));
		app.vault.on('delete', (f: TAbstractFile) => { this.sealed.delete(f.path); });
	}

	private get path(): string { return `${this.app.vault.configDir}/lock.json`; }

	async load(): Promise<void> {
		try {
			if (await this.app.vault.adapter.exists(this.path)) this.lockFile = JSON.parse(await this.app.vault.adapter.read(this.path)) as LockFile;
		} catch {
			console.error('Could not read the lock file');
		}
	}

	private async save(): Promise<void> {
		if (this.lockFile) await this.app.vault.adapter.write(this.path, JSON.stringify(this.lockFile, null, '\t'));
	}

	get isSetUp(): boolean { return this.lockFile !== null; }
	get isUnlocked(): boolean { return this.key !== null; }
	get lockedFolders(): string[] { return [...(this.lockFile?.folders ?? [])]; }
	/** Notes sealed on disk that Docketeer knows of. */
	get sealedNotes(): string[] { return [...this.sealed]; }

	private inLockedFolder(path: string): boolean {
		return (this.lockFile?.folders ?? []).some((f) => path === f || path.startsWith(`${f}/`));
	}

	/** Locked on disk (sealed, or a note in a locked folder). */
	isEncrypted(path: string): boolean {
		return path.endsWith('.md') && (this.sealed.has(path) || this.inLockedFolder(path));
	}

	/** Locked and the homebase is locked: nothing about it may be shown. */
	isLocked(path: string): boolean {
		return this.isEncrypted(path) && !this.key;
	}

	isFolderLocked(folder: TFolder): boolean {
		return this.inLockedFolder(folder.path);
	}

	// --- the vault's hooks ------------------------------------------------------------------------------

	async onRead(path: string, raw: string): Promise<string> {
		if (!isSealed(raw)) return raw;
		this.sealed.add(path);
		if (!this.key) throw new LockedError();
		return open(this.key, raw);
	}

	async onWrite(path: string, plain: string): Promise<string> {
		if (!this.isEncrypted(path)) return plain;
		if (!this.key) throw new LockedError('Unlock to change locked notes.');
		this.sealed.add(path);
		return seal(this.key, plain);
	}

	onCopy(from: string, to: string): void {
		if (this.sealed.has(from)) this.sealed.add(to);
	}

	private onRename(f: TAbstractFile, old: string): void {
		if (f instanceof TFile) {
			if (this.sealed.delete(old)) this.sealed.add(f.path);
			return;
		}
		// A folder: notes and locked folders under it move with it.
		for (const p of [...this.sealed]) if (p.startsWith(`${old}/`)) { this.sealed.delete(p); this.sealed.add(f.path + p.slice(old.length)); }
		if (this.lockFile) {
			const moved = this.lockFile.folders.map((x) => (x === old || x.startsWith(`${old}/`) ? f.path + x.slice(old.length) : x));
			if (moved.join('\n') !== this.lockFile.folders.join('\n')) { this.lockFile.folders = moved; void this.save(); }
		}
	}

	// --- keys --------------------------------------------------------------------------------------------

	/** Set up locking with a passphrase; returns the recovery key, to show once. */
	async setUp(passphrase: string): Promise<string> {
		if (this.lockFile) throw new Error('Locking is already set up.');
		const { lock, key, recoveryKey } = await createLock(passphrase, this.iterations);
		this.lockFile = lock;
		await this.save();
		this.key = key;
		this.trigger('unlocked');
		return recoveryKey;
	}

	async unlock(passphrase: string): Promise<boolean> {
		if (!this.lockFile) return false;
		const key = await unlockWithPassphrase(this.lockFile, passphrase);
		if (!key) return false;
		this.key = key;
		this.trigger('unlocked');
		return true;
	}

	async recover(recoveryKey: string, newPassphrase: string): Promise<boolean> {
		if (!this.lockFile) return false;
		const r = await recover(this.lockFile, recoveryKey, newPassphrase);
		if (!r) return false;
		this.lockFile = r.lock;
		await this.save();
		this.key = r.key;
		this.trigger('unlocked');
		return true;
	}

	async changePassphrase(oldPassphrase: string, newPassphrase: string): Promise<boolean> {
		if (!this.lockFile) return false;
		const next = await changePassphrase(this.lockFile, oldPassphrase, newPassphrase);
		if (!next) return false;
		this.lockFile = next;
		await this.save();
		return true;
	}

	/** Lock now: listeners save and close what is open ('before-lock'), then the key is forgotten. */
	async lock(): Promise<void> {
		if (!this.key) return;
		const waits: Promise<unknown>[] = [];
		this.trigger('before-lock', (p: Promise<unknown>) => waits.push(p));
		await Promise.allSettled(waits);
		this.key = null;
		this.trigger('locked');
	}

	/** Ask the user to unlock (true when unlocked, or already). */
	async requestUnlock(): Promise<boolean> {
		if (this.key) return true;
		if (!this.lockFile || !this.prompt) return false;
		return this.prompt();
	}

	// --- locking notes and folders -----------------------------------------------------------------------

	private requireKey(): void {
		if (!this.lockFile) throw new Error('Set up locking first.');
		if (!this.key) throw new LockedError('Unlock first.');
	}

	/** Encrypt a note on disk. */
	async lockNote(file: TFile): Promise<void> {
		this.requireKey();
		if (file.extension !== 'md' || this.sealed.has(file.path)) return;
		const text = await this.app.vault.read(file);
		this.sealed.add(file.path);
		try {
			await this.app.vault.modify(file, text);
		} catch (e) {
			this.sealed.delete(file.path);
			throw e;
		}
		this.app.trigger('note-locked', file);
	}

	/** Decrypt a note on disk for good (not inside a locked folder: remove the folder's lock instead). */
	async removeNoteLock(file: TFile): Promise<void> {
		this.requireKey();
		if (this.inLockedFolder(file.path)) throw new Error('This note is in a locked folder: remove the folder\'s lock instead.');
		if (!this.sealed.has(file.path)) return;
		const text = await this.app.vault.read(file);
		this.sealed.delete(file.path);
		try {
			await this.app.vault.modify(file, text);
		} catch (e) {
			this.sealed.add(file.path);
			throw e;
		}
	}

	private notesIn(folder: TFolder): TFile[] {
		const out: TFile[] = [];
		const visit = (f: TFolder) => { for (const c of f.children) { if (c instanceof TFolder) visit(c); else if (c instanceof TFile && c.extension === 'md') out.push(c); } };
		visit(folder);
		return out;
	}

	/** Lock a folder: every note in it now, and new notes made in it. */
	async lockFolder(folder: TFolder): Promise<void> {
		this.requireKey();
		const lf = this.lockFile!;
		if (!lf.folders.includes(folder.path)) { lf.folders = [...lf.folders.filter((x) => !x.startsWith(`${folder.path}/`)), folder.path]; await this.save(); }
		for (const f of this.notesIn(folder)) if (!this.sealed.has(f.path)) await this.lockNote(f);
	}

	/** Remove a folder's lock: its notes are decrypted (unless another locked folder holds them). */
	async removeFolderLock(folder: TFolder): Promise<void> {
		this.requireKey();
		const lf = this.lockFile!;
		lf.folders = lf.folders.filter((x) => x !== folder.path);
		await this.save();
		for (const f of this.notesIn(folder)) if (this.sealed.has(f.path) && !this.inLockedFolder(f.path)) await this.removeNoteLock(f);
	}
}
