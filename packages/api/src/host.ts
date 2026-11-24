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
	/** Every file and folder under `path` (the whole homebase for ""), skipping names that start with ".". */
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
		/** Recent homebases, newest first: `missing` when the folder is gone, `current` for the open one. */
		recentVaults(): Promise<{ path: string; name: string; time: number; missing?: boolean; current?: boolean }[]>;
		/** Take a homebase off the recent list (the folder is not touched). */
		forgetVault?(path: string): Promise<void>;
		/** Copy the example homebase into Documents (once) and open it; resolves to its folder. */
		openExample?(): Promise<string>;
		/** Ask for a folder and open it as a vault (reloads the window). */
		chooseVault(create?: boolean): Promise<boolean>;
		openVault(path: string): Promise<boolean>;
		showItemInFolder(path: string): Promise<void>;
		/** Smoke-test mode: report results and exit. */
		smokeReport?(report: unknown): void;
		isSmoke: boolean;
		/** Screenshot mode (--shots), and a capture of the window in smoke modes. */
		isShots?: boolean;
		/** Benchmark mode (--bench): time the Docket on the open homebase and report. */
		isBench?: boolean;
		capture?(name: string): Promise<string | null>;
		/** A spelling dictionary shipped with the app (Hunspell .aff and .dic), or null. */
		dictionary(lang: string): Promise<{ aff: string; dic: string } | null>;
		/** A font or character map shipped for the PDF viewer, by name. */
		pdfAsset?(kind: 'standard_fonts' | 'cmaps', name: string): Promise<Uint8Array>;
		/** Licences of the libraries and dictionaries the app ships. */
		notices(): Promise<string>;
		/** The computer is going to sleep or its screen locked (for locking the homebase). */
		onSystemLock?(cb: () => void): void;
		/** Smoke test only: as if the computer went to sleep. */
		smokeSystemLock?(): void;
		/** Called before the window closes; it waits for the promise (to save open notes). */
		onBeforeQuit(cb: () => Promise<void>): void;
	};
	clipboard: { writeText(text: string): void; readText(): Promise<string> };
}

export function getHost(): HostBridge {
	const h = (globalThis as { quire?: HostBridge }).quire;
	if (!h) throw new Error('Quire host bridge is not available');
	return h;
}
