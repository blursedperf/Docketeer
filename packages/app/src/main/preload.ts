/**
 * The only bridge between the page and the system: homebase file access (paths are checked in the main
 * process), plugin discovery and a few app actions. No Node APIs reach the page.
 */
import { contextBridge, ipcRenderer } from 'electron';

const info = ipcRenderer.sendSync('host:info') as { platform: string; appVersion: string; vault: { path: string; name: string } | null; isSmoke: boolean; isShots: boolean; isBench: boolean };

const call = <T>(channel: string, ...args: unknown[]): Promise<T> => ipcRenderer.invoke(channel, ...args) as Promise<T>;

function toArrayBuffer(u8: Uint8Array): ArrayBuffer {
	return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
}

let quitHandler: (() => Promise<void>) | null = null;
ipcRenderer.on('app:before-quit', (_e, token: string) => {
	const done = () => ipcRenderer.send('app:quit-ready', token);
	if (!quitHandler) { done(); return; }
	quitHandler().then(done, (e: unknown) => { console.error(e); done(); });
});

contextBridge.exposeInMainWorld('quire', {
	platform: info.platform,
	appVersion: info.appVersion,
	vault: info.vault,
	fs: {
		tree: (p: string) => call('fs:tree', p),
		stat: (p: string) => call('fs:stat', p),
		exists: (p: string) => call('fs:exists', p),
		read: (p: string) => call('fs:read', p),
		readBinary: async (p: string) => toArrayBuffer(await call<Uint8Array>('fs:readBinary', p)),
		write: (p: string, data: string) => call('fs:write', p, data),
		writeBinary: (p: string, data: ArrayBuffer) => call('fs:writeBinary', p, new Uint8Array(data)),
		append: (p: string, data: string) => call('fs:append', p, data),
		mkdir: (p: string) => call('fs:mkdir', p),
		list: (p: string) => call('fs:list', p),
		remove: (p: string) => call('fs:remove', p),
		rmdir: (p: string, recursive: boolean) => call('fs:rmdir', p, recursive),
		rename: (a: string, b: string) => call('fs:rename', a, b),
		copy: (a: string, b: string) => call('fs:copy', a, b),
		trash: (p: string) => call('fs:trash', p),
	},
	onFsEvents: (cb: (events: unknown[]) => void) => {
		ipcRenderer.on('fs:events', (_e, events: unknown[]) => cb(events));
	},
	plugins: {
		list: () => call('plugins:list'),
	},
	app: {
		isSmoke: info.isSmoke,
		isShots: info.isShots,
		isBench: info.isBench,
		capture: (name: string) => call<string | null>('smoke:capture', name),
		getConfig: () => call('app:getConfig'),
		setConfig: (patch: Record<string, unknown>) => call('app:setConfig', patch),
		recentVaults: () => call('app:recent'),
		chooseVault: (create?: boolean, layout?: 'legal' | 'generic') => call('app:chooseVault', !!create, layout ?? 'legal'),
		openVault: (p: string) => call('app:openVault', p),
		forgetVault: (p: string) => call('app:forgetVault', p),
		openExample: () => call<string>('app:openExample'),
		showItemInFolder: (p: string) => call('app:showItemInFolder', p),
		onBeforeQuit: (cb: () => Promise<void>) => { quitHandler = cb; },
		smokeReport: (report: unknown) => ipcRenderer.send('smoke:report', report),
		dictionary: (lang: string) => call('spell:dictionary', lang),
		notices: () => call('app:notices'),
		pdfAsset: (kind: 'standard_fonts' | 'cmaps', name: string) => call<Uint8Array>('pdf:asset', kind, name),
		onSystemLock: (cb: () => void) => { ipcRenderer.on('app:system-lock', () => cb()); },
		smokeSystemLock: () => { if (info.isSmoke) ipcRenderer.send('smoke:system-lock'); },
	},
	clipboard: {
		writeText: (text: string) => { void call('clipboard:writeText', text); },
		readText: () => call('clipboard:readText'),
	},
});
