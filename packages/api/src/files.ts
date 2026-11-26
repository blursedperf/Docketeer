import type { Vault } from './vault';

export interface FileStats {
	ctime: number;
	mtime: number;
	size: number;
}

export abstract class TAbstractFile {
	vault!: Vault;
	path: string;
	name: string;
	parent: TFolder | null = null;

	constructor(path: string) {
		this.path = path;
		this.name = path === '/' ? '' : path.slice(path.lastIndexOf('/') + 1);
	}

	/** Update after a rename. */
	setPath(path: string): void {
		this.path = path;
		this.name = path === '/' ? '' : path.slice(path.lastIndexOf('/') + 1);
	}
}

export class TFile extends TAbstractFile {
	stat: FileStats = { ctime: 0, mtime: 0, size: 0 };
	/** Not downloaded to this device yet (iCloud): known by name; indexed when it arrives. */
	pending?: boolean;

	get extension(): string {
		const dot = this.name.lastIndexOf('.');
		return dot <= 0 ? '' : this.name.slice(dot + 1).toLowerCase();
	}

	get basename(): string {
		const dot = this.name.lastIndexOf('.');
		return dot <= 0 ? this.name : this.name.slice(0, dot);
	}
}

export class TFolder extends TAbstractFile {
	children: TAbstractFile[] = [];

	isRoot(): boolean {
		return this.path === '/';
	}
}
