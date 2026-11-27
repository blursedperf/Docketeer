import { describe, expect, it, vi } from 'vitest';
import { isConflict } from '@quire/api';
import { createHost, fromBase64, hostError, NativeEvents, nativeFs, toBase64, type HostInfo } from '../web/host';
import { genericPanels, parsePanelsConfig } from '../../app/src/renderer/docket/panels-model';

const info: HostInfo = { platform: 'ios', appVersion: '0.20.0', formFactor: 'tablet', vault: { path: 'iCloud Drive/Law', name: 'Law' } };

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

describe('conflicts', () => {
	it('a write native refused as a conflict rejects with that code; other errors pass as they are', async () => {
		const fs = nativeFs(async (channel) => {
			if (channel === 'fs:write') throw new Error('conflict: Torts/Duty.md changed on disk');
			throw new Error('No homebase is open');
		});
		expect(fs.guardsConflicts).toBe(true);
		const e = await fs.write('Torts/Duty.md', 'x').catch((x: unknown) => x);
		expect(isConflict(e)).toBe(true);
		expect((e as Error).message).toBe('Torts/Duty.md changed on disk');
		const other = await fs.read('a.md').catch((x: unknown) => x);
		expect(isConflict(other)).toBe(false);
		expect((other as Error).message).toBe('No homebase is open');
		expect(hostError('conflict: x')).toMatchObject({ code: 'conflict', message: 'x' });
	});

	it('lists, reads and settles versions from other devices through native', async () => {
		const versions = [{ id: 'icloud:1:a.md', path: 'a.md', from: 'MacBook', mtime: 1 }];
		const { native, calls } = fakeNative({ 'fs:conflicts': versions, 'fs:readConflict': 'theirs', 'fs:resolveConflict': undefined });
		const fs = nativeFs(native);
		expect(await fs.conflicts!()).toEqual(versions);
		expect(await fs.readConflict!('icloud:1:a.md')).toBe('theirs');
		await fs.resolveConflict!('icloud:1:a.md', 'both', 'a (conflict).md');
		await fs.resolveConflict!('icloud:1:a.md', 'mine');
		expect(calls.slice(1)).toEqual([
			['fs:readConflict', ['icloud:1:a.md']],
			['fs:resolveConflict', ['icloud:1:a.md', 'both', 'a (conflict).md']],
			['fs:resolveConflict', ['icloud:1:a.md', 'mine', null]],
		]);
	});
});

describe('createHost', () => {
	it('answers from the host info, and asks native for settings, dictionaries, notices, plugins and the clipboard', async () => {
		const { native, calls } = fakeNative({
			'app:getConfig': { recent: [] }, 'app:setConfig': undefined, 'spell:dictionary': { aff: 'A', dic: 'D' },
			'app:notices': 'MIT', 'plugins:list': [], 'clipboard:readText': 'copied', 'clipboard:writeText': undefined, 'pdf:asset': 'AQI=',
		});
		const host = createHost(native, info, new NativeEvents());
		expect(host.platform).toBe('ios');
		expect(host.formFactor).toBe('tablet');
		expect(host.vault).toEqual(info.vault);
		expect(host.app.isSmoke).toBe(false);
		host.app.smokeSystemLock!();
		expect(calls.map((c) => c[0])).not.toContain('smoke:system-lock');
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

	it('asks native for recent homebases, and to open, forget and choose them', async () => {
		const recent = [{ path: 'iCloud Drive/Law', name: 'Law', time: 1, current: true }];
		const { native, calls } = fakeNative({
			'app:recent': recent, 'app:openVault': true, 'app:forgetVault': undefined, 'app:openExample': 'On My iPad/Docketeer/Docketeer example', 'app:chooseVault': true,
		});
		const host = createHost(native, info, new NativeEvents());
		expect(await host.app.recentVaults()).toEqual(recent);
		expect(await host.app.openVault('iCloud Drive/Law')).toBe(true);
		await host.app.forgetVault!('iCloud Drive/Old');
		expect(await host.app.openExample!()).toBe('On My iPad/Docketeer/Docketeer example');
		await host.app.chooseVault(false);
		await host.app.chooseVault(true, 'legal');
		await host.app.chooseVault(true, 'generic');
		const panels = { panels: [{ id: 'week', title: 'My week', elements: [{ type: 'files', folder: 'Torts' }] }], order: [], hidden: ['core:cite'], junk: 1 };
		await host.app.chooseVault(true, { panels: JSON.stringify(panels), folders: ['Torts', '../up', '.quire'] });
		expect(calls.slice(1)).toEqual([
			['app:openVault', ['iCloud Drive/Law']], ['app:forgetVault', ['iCloud Drive/Old']], ['app:openExample', []],
			['app:chooseVault', [false, 'legal', null]], ['app:chooseVault', [true, 'legal', null]],
			['app:chooseVault', [true, 'generic', JSON.stringify(genericPanels(), null, '\t')]],
			// A template: its panels read again (only what Docketeer understands), and only safe folders.
			['app:chooseVault', [true, 'template', JSON.stringify(parsePanelsConfig(JSON.stringify(panels)), null, '\t'), ['Torts']]],
		]);
		expect(await host.app.fonts!()).toEqual([]);
	});

	it('reads and writes the homebase through native', async () => {
		const { native, calls } = fakeNative({ 'fs:tree': [{ path: 'a.md', type: 'file', size: 1, mtime: 1, ctime: 1 }] });
		const host = createHost(native, info, new NativeEvents());
		expect(await host.fs.tree('')).toHaveLength(1);
		expect(calls).toEqual([['fs:tree', ['']]]);
	});

	it('passes native events to the renderer', () => {
		const events = new NativeEvents();
		const host = createHost(fakeNative().native, info, events);
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
		const host = createHost(native, info, events);
		// No handler yet: native is told at once.
		events.emit('app:before-quit', 't1');
		let saved = false;
		host.app.onBeforeQuit(async () => { await new Promise((r) => setTimeout(r, 5)); saved = true; });
		events.emit('app:before-quit', 't2');
		expect(calls).toEqual([['app:quit-ready', ['t1']]]);
		await vi.waitFor(() => expect(calls).toContainEqual(['app:quit-ready', ['t2']]));
		expect(saved).toBe(true);
	});

	it('leaving the screen saves without quitting; only a real quit runs the quit handler', async () => {
		const { native, calls } = fakeNative({ 'app:quit-ready': undefined });
		const events = new NativeEvents();
		const host = createHost(native, info, events);
		const ran: string[] = [];
		host.app.onBackground!(async () => { ran.push('save'); });
		host.app.onBeforeQuit(async () => { ran.push('quit'); });
		events.emit('app:background', 'b1');
		await vi.waitFor(() => expect(calls).toContainEqual(['app:quit-ready', ['b1']]));
		expect(ran).toEqual(['save']);
		events.emit('app:before-quit', 'q1');
		await vi.waitFor(() => expect(calls).toContainEqual(['app:quit-ready', ['q1']]));
		expect(ran).toEqual(['save', 'quit']);
	});
});
