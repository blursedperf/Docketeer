/**
 * The bridge the desktop shell gives the renderer (window.quire). Every path is relative to the vault
 * root, with forward slashes; the shell refuses any path outside the vault.
 */
export interface HostStat {
	type: 'file' | 'folder';
	size: number;
	mtime: number;
	ctime: number;
	/** Not downloaded to this device yet (iCloud): its contents arrive later, with an fs event. Desktop leaves it out. */
	pending?: true;
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
	/**
	 * The host refuses to overwrite a file that changed on disk since Docketeer last read or wrote it (iOS, where
	 * iCloud brings changes from other devices): `write` and `writeBinary` then reject with an error whose `code`
	 * is 'conflict' (see isConflict). Desktop leaves it out.
	 */
	guardsConflicts?: boolean;
}

/** A write the host refused because the file changed on disk meanwhile (HostFs.guardsConflicts). */
export function isConflict(e: unknown): boolean {
	return typeof e === 'object' && e !== null && (e as { code?: unknown }).code === 'conflict';
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
		/**
		 * Ask for a folder and open it as a homebase (reloads the window). Creating one, `layout` is how its Docket
		 * starts: 'legal' (the panels as they come) or 'generic' (Files and Folders, Homebase, Layout).
		 */
		chooseVault(create?: boolean, layout?: 'legal' | 'generic'): Promise<boolean>;
		openVault(path: string): Promise<boolean>;
		showItemInFolder(path: string): Promise<void>;
		/** A whole HTML page printed to PDF (pictures and fonts from quire:// only; no scripts run). */
		printToPdf?(html: string, options?: { landscape?: boolean; pageSize?: string }): Promise<ArrayBuffer>;
		/** Smoke-test mode: report results and exit. */
		smokeReport?(report: unknown): void;
		isSmoke: boolean;
		/** Screenshot mode (--shots), and a capture of the window in smoke modes. */
		isShots?: boolean;
		/** The system title bar is hidden: the window buttons are drawn over the top bar, which moves the window. */
		frameless?: boolean;
		/** Colour the window buttons drawn over the top bar (Windows and Linux). */
		setTitleBarColors?(color: string, symbol: string): Promise<void>;
		/** Restart Docketeer. */
		relaunch?(): Promise<void>;
		/** Benchmark mode (--bench): time the Docket on the open homebase and report. */
		isBench?: boolean;
		capture?(name: string): Promise<string | null>;
		/** A spelling dictionary shipped with the app (Hunspell .aff and .dic), or null. */
		dictionary(lang: string): Promise<{ aff: string; dic: string } | null>;
		/** A font or character map shipped for the PDF viewer, by name. */
		pdfAsset?(kind: 'standard_fonts' | 'cmaps', name: string): Promise<Uint8Array>;
		/** The font families installed on this computer, A–Z (`mono`: monospaced). */
		fonts?(): Promise<{ family: string; mono: boolean }[]>;
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
	if (!h) throw new Error('Docketeer host bridge is not available');
	return h;
}
