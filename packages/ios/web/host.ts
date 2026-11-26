/**
 * The iOS host bridge: window.quire over the native shell's message handler. Channel names are the desktop's IPC
 * channels (packages/app/src/main/preload.ts is the reference for each call). JavaScript asks native with
 * `webkit.messageHandlers.quire.postMessage({ channel, args })`, which answers with a promise; native tells
 * JavaScript of events by calling `window.__quireNative.emit(name, payload)`.
 *
 * Bytes cross the bridge as base64. Large media never does: the page loads it from quire://app/vault/.
 */
import type { HostBridge, HostFs, HostFsEvent, HostPluginInfo, HostStat } from '@quire/api';
import { genericPanels } from '../../app/src/renderer/docket/panels-model';

/** Ask the native shell: resolves with its answer, rejects with its error. */
export type Native = (channel: string, ...args: unknown[]) => Promise<unknown>;

/** What native answers to host:info, before the renderer loads. */
export interface HostInfo {
	platform: string;
	appVersion: string;
	formFactor: 'phone' | 'tablet';
	vault: { path: string; name: string } | null;
}

interface WebkitHandler { postMessage(message: unknown): Promise<unknown> }

/** The native side, through WKScriptMessageHandlerWithReply. */
export function webkitNative(): Native {
	const handler = (globalThis as { webkit?: { messageHandlers?: { quire?: WebkitHandler } } }).webkit?.messageHandlers?.quire;
	if (!handler) throw new Error('The native bridge is not available');
	return (channel, ...args) => handler.postMessage({ channel, args });
}

/** Events from native. Only handlers that were registered are called; an unknown name is ignored. */
export class NativeEvents {
	private handlers = new Map<string, ((payload: unknown) => void)[]>();

	on(name: string, cb: (payload: unknown) => void): void {
		const list = this.handlers.get(name) ?? [];
		list.push(cb);
		this.handlers.set(name, list);
	}

	emit(name: string, payload?: unknown): void {
		for (const cb of this.handlers.get(name) ?? []) {
			try { cb(payload); } catch (e) { console.error(`Error in a handler for ${name}`, e); }
		}
	}
}

export function toBase64(data: ArrayBuffer | Uint8Array): string {
	const u8 = data instanceof Uint8Array ? data : new Uint8Array(data);
	let s = '';
	for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
	return btoa(s);
}

export function fromBase64(b64: string): Uint8Array {
	const s = atob(b64);
	const u8 = new Uint8Array(s.length);
	for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i);
	return u8;
}

const toBuffer = (u8: Uint8Array): ArrayBuffer => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;

/** HostFs answered by native (Phase 1's HomebaseFS). */
export function nativeFs(native: Native): HostFs {
	const call = <T>(channel: string, ...args: unknown[]) => native(channel, ...args) as Promise<T>;
	return {
		tree: (p) => call('fs:tree', p),
		stat: (p) => call('fs:stat', p),
		exists: (p) => call('fs:exists', p),
		read: (p) => call('fs:read', p),
		readBinary: async (p) => toBuffer(fromBase64(await call<string>('fs:readBinary', p))),
		write: (p, data) => call('fs:write', p, data),
		writeBinary: (p, data) => call<HostStat>('fs:writeBinary', p, toBase64(data)),
		append: (p, data) => call('fs:append', p, data),
		mkdir: (p) => call('fs:mkdir', p),
		list: (p) => call('fs:list', p),
		remove: (p) => call('fs:remove', p),
		rmdir: (p, recursive) => call('fs:rmdir', p, recursive),
		rename: (a, b) => call('fs:rename', a, b),
		copy: (a, b) => call('fs:copy', a, b),
		trash: (p) => call('fs:trash', p),
	};
}

/**
 * window.quire for iOS. The homebase is a folder native opened (from the folder picker, the recent list or the
 * example), and every fs call goes to native, which checks the path. `vault.path` is where the folder is, in
 * words ("iCloud Drive/Law"): native keeps the folder's bookmark under it.
 */
export function createHost(native: Native, info: HostInfo, events: NativeEvents): HostBridge {
	const call = <T>(channel: string, ...args: unknown[]) => native(channel, ...args) as Promise<T>;

	let quitHandler: (() => Promise<void>) | null = null;
	// Native asks before the app goes to the background, and waits (in a background task) for the answer.
	events.on('app:before-quit', (token) => {
		const done = () => { void native('app:quit-ready', token).catch(() => undefined); };
		if (!quitHandler) { done(); return; }
		quitHandler().then(done, (e: unknown) => { console.error(e); done(); });
	});

	return {
		platform: info.platform,
		appVersion: info.appVersion,
		vault: info.vault,
		fs: nativeFs(native),
		onFsEvents: (cb) => events.on('fs:events', (payload) => cb(payload as HostFsEvent[])),
		plugins: { list: () => call<HostPluginInfo[]>('plugins:list') },
		app: {
			isSmoke: false,
			isShots: false,
			isBench: false,
			frameless: false,
			getConfig: () => call('app:getConfig'),
			setConfig: (patch) => call('app:setConfig', patch),
			recentVaults: () => call('app:recent'),
			forgetVault: (path) => call('app:forgetVault', path),
			openExample: () => call('app:openExample'),
			// Native shows the folder picker; a new Generic homebase gets its panels, written by native as on desktop.
			chooseVault: (create, layout) => call('app:chooseVault', !!create, layout ?? 'legal', create && layout === 'generic' ? JSON.stringify(genericPanels(), null, '\t') : null),
			openVault: (path) => call('app:openVault', path),
			showItemInFolder: async () => undefined,
			onBeforeQuit: (cb) => { quitHandler = cb; },
			dictionary: (lang) => call('spell:dictionary', lang),
			notices: () => call('app:notices'),
			pdfAsset: async (kind, name) => fromBase64(await call<string>('pdf:asset', kind, name)),
			// Only the fonts the app ships (listed by the renderer on its own); iOS has no installed fonts to offer.
			fonts: async () => [],
			onSystemLock: (cb) => events.on('app:system-lock', () => cb()),
		},
		clipboard: {
			writeText: (text) => { void call('clipboard:writeText', text).catch((e: unknown) => console.error(e)); },
			readText: () => call('clipboard:readText'),
		},
	};
}
