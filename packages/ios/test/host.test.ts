import { describe, expect, it, vi } from 'vitest';
import { createHost, fromBase64, NativeEvents, nativeFs, toBase64, type HostInfo } from '../web/host';
import { MemoryFs } from '../web/memory-fs';

const info: HostInfo = { platform: 'ios', appVersion: '0.20.0', formFactor: 'tablet', vault: { path: 'example', name: 'Docketeer example' } };

/** A fake native side: records each call and answers from `answers`. */
function fakeNative(answers: Record<string, unknown> = {}) {
	const calls: [string, unknown[]][] = [];
	const native = vi.fn(async (channel: string, ...args: unknown[]) => {
		calls.push([channel, args]);
		if (!(channel in answers)) throw new Error(`Unknown channel: ${channel}`);
		const a = answers[channel];
		return typeof a === 'function' ? (a as (...x: unknown[]) => unknown)(...args) : a;
	});
	return { native, calls };
}

describe('base64', () => {
	it('round-trips bytes, including large ones', () => {
		const big = new Uint8Array(200_000).map((_, i) => i % 256);
		expect(fromBase64(toBase64(big))).toEqual(big);
		expect(toBase64(new Uint8Array([104, 105]).buffer)).toBe('aGk=');
	});
});

describe('NativeEvents', () => {
	it('calls only registered handlers, and one failing handler does not stop the others', () => {
		const ev = new NativeEvents();
		const seen: unknown[] = [];
		const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		ev.on('fs:events', () => { throw new Error('boom'); });
		ev.on('fs:events', (p) => seen.push(p));
		ev.emit('fs:events', [1]);
		ev.emit('nobody:listens', 2);
		expect(seen).toEqual([[1]]);
		expect(err).toHaveBeenCalledOnce();
		err.mockRestore();
	});
});

describe('nativeFs', () => {
	it('uses the desktop channel names, and sends bytes as base64 both ways', async () => {
		const { native, calls } = fakeNative({
			'fs:read': 'text', 'fs:write': { type: 'file', size: 4, mtime: 1, ctime: 1 },
			'fs:readBinary': 'AQID', 'fs:writeBinary': { type: 'file', size: 2, mtime: 1, ctime: 1 }, 'fs:rmdir': undefined,
		});
		const fs = nativeFs(native);
		expect(await fs.read('a.md')).toBe('text');
		await fs.write('a.md', 'text');
		expect([...new Uint8Array(await fs.readBinary('a.bin'))]).toEqual([1, 2, 3]);
		await fs.writeBinary('b.bin', new Uint8Array([104, 105]).buffer);
		await fs.rmdir('f', true);
		expect(calls).toEqual([['fs:read', ['a.md']], ['fs:write', ['a.md', 'text']], ['fs:readBinary', ['a.bin']], ['fs:writeBinary', ['b.bin', 'aGk=']], ['fs:rmdir', ['f', true]]]);
	});
});

describe('createHost', () => {
	it('answers from the host info, and asks native for settings, dictionaries, notices, plugins and the clipboard', async () => {
		const { native, calls } = fakeNative({
			'app:getConfig': { recent: [] }, 'app:setConfig': undefined, 'spell:dictionary': { aff: 'A', dic: 'D' },
			'app:notices': 'MIT', 'plugins:list': [], 'clipboard:readText': 'copied', 'clipboard:writeText': undefined, 'pdf:asset': 'AQI=',
		});
		const host = createHost(native, info, new NativeEvents(), new MemoryFs());
		expect(host.platform).toBe('ios');
		expect(host.vault).toEqual(info.vault);
		expect(host.app.isSmoke).toBe(false);
		expect(await host.app.getConfig()).toEqual({ recent: [] });
		await host.app.setConfig({ last: 'x' });
		expect(await host.app.dictionary('en-AU')).toEqual({ aff: 'A', dic: 'D' });
		expect(await host.app.notices()).toBe('MIT');
		expect(await host.plugins.list()).toEqual([]);
		expect(await host.clipboard.readText()).toBe('copied');
		host.clipboard.writeText('hi');
		expect([...(await host.app.pdfAsset!('cmaps', 'x'))]).toEqual([1, 2]);
		expect(calls.map((c) => c[0])).toContain('clipboard:writeText');
		expect(calls).toContainEqual(['app:setConfig', [{ last: 'x' }]]);
	});

	it('lists the open homebase as the only recent one, and does not open others yet', async () => {
		const host = createHost(fakeNative().native, info, new NativeEvents(), new MemoryFs());
		expect(await host.app.recentVaults()).toEqual([{ path: 'example', name: 'Docketeer example', time: 0, current: true }]);
		expect(await host.app.openVault('/elsewhere')).toBe(false);
		expect(await host.app.chooseVault(true, 'generic')).toBe(false);
		expect(await host.app.fonts!()).toEqual([]);
	});

	it('passes native events to the renderer', () => {
		const events = new NativeEvents();
		const host = createHost(fakeNative().native, info, events, new MemoryFs());
		const fsSeen: unknown[] = [];
		let locked = 0;
		host.onFsEvents((e) => fsSeen.push(e));
		host.app.onSystemLock!(() => locked++);
		events.emit('fs:events', [{ path: 'a.md', stat: null }]);
		events.emit('app:system-lock');
		expect(fsSeen).toEqual([[{ path: 'a.md', stat: null }]]);
		expect(locked).toBe(1);
	});

	it('before the app goes to the background, waits for the renderer to save, then tells native', async () => {
		const { native, calls } = fakeNative({ 'app:quit-ready': undefined });
		const events = new NativeEvents();
		const host = createHost(native, info, events, new MemoryFs());
		// No handler yet: native is told at once.
		events.emit('app:before-quit', 't1');
		let saved = false;
		host.app.onBeforeQuit(async () => { await new Promise((r) => setTimeout(r, 5)); saved = true; });
		events.emit('app:before-quit', 't2');
		expect(calls).toEqual([['app:quit-ready', ['t1']]]);
		await vi.waitFor(() => expect(calls).toContainEqual(['app:quit-ready', ['t2']]));
		expect(saved).toBe(true);
	});
});
