/**
 * The bridge the desktop shell gives the renderer (window.quire). Every path is relative to the vault
 * root, with forward slashes; the shell refuses any path outside the vault.
 */
export interface HostStat {
	type: 'file' | 'folder';
	size: number;
	mtime: number;
	ctime: number;
}

export interface HostEntry extends HostStat {
	path: string;
}

export interface HostFs {
	/** Every file and folder under `path` (the whole vault for ""), skipping names that start with ".". */
	tree(path: string): Promise<HostEntry[]>;
	stat(path: string): Promise<HostStat | null>;
	exists(path: string): Promise<boolean>;
	read(path: string): Promise<string>;
	readBinary(path: string): Promise<ArrayBuffer>;
	/** Atomic write; creates missing parent folders. Returns the new stat. */
	write(path: string, data: string): Promise<HostStat>;
	writeBinary(path: string, data: ArrayBuffer): Promise<HostStat>;
	append(path: string, data: string): Promise<HostStat>;
	mkdir(path: string): Promise<void>;
	/** Direct children of a folder, as vault paths (includes hidden names). */
	list(path: string): Promise<{ files: string[]; folders: string[] }>;
	remove(path: string): Promise<void>;
	rmdir(path: string, recursive: boolean): Promise<void>;
	rename(from: string, to: string): Promise<void>;
	copy(from: string, to: string): Promise<void>;
	/** Move to the system trash. */
	trash(path: string): Promise<boolean>;
}

export interface HostFsEvent {
	path: string;
	stat: HostStat | null;
}

export interface HostPluginInfo {
	manifest: PluginManifestData;
	/** Where it was found. */
	source: 'builtin' | 'vault';
	hasStyles: boolean;
}

export interface PluginManifestData {
	id: string;
	name: string;
	version: string;
	minAppVersion?: string;
	description?: string;
	author?: string;
	authorUrl?: string;
	isDesktopOnly?: boolean;
	[key: string]: unknown;
}

export interface HostBridge {
	platform: string;
	appVersion: string;
	vault: { path: string; name: string } | null;
	fs: HostFs;
	onFsEvents(cb: (events: HostFsEvent[]) => void): void;
	plugins: { list(): Promise<HostPluginInfo[]> };
	app: {
		getConfig(): Promise<Record<string, unknown>>;
		setConfig(patch: Record<string, unknown>): Promise<void>;
		recentVaults(): Promise<{ path: string; name: string; time: number }[]>;
		/** Ask for a folder and open it as a vault (reloads the window). */
		chooseVault(create?: boolean): Promise<boolean>;
		openVault(path: string): Promise<boolean>;
		showItemInFolder(path: string): Promise<void>;
		/** Smoke-test mode: report results and exit. */
		smokeReport?(report: unknown): void;
		isSmoke: boolean;
		/** Called before the window closes; it waits for the promise (to save open notes). */
		onBeforeQuit(cb: () => Promise<void>): void;
	};
	clipboard: { writeText(text: string): void };
}

export function getHost(): HostBridge {
	const h = (globalThis as { quire?: HostBridge }).quire;
	if (!h) throw new Error('Quire host bridge is not available');
	return h;
}
