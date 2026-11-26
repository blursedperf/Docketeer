import { describe, expect, it } from 'vitest';
import type { HostBridge } from '@quire/api';
import { toBase64 } from '../web/host';
import { RENDERER, start } from '../web/start';

describe('start', () => {
	it('installs window.quire with the example homebase before it loads the renderer', async () => {
		const scope: Record<string, unknown> = {};
		const order: string[] = [];
		const native = async (channel: string) => {
			order.push(channel);
			if (channel === 'host:info') return { platform: 'ios', appVersion: '0.20.0', formFactor: 'phone', vault: { path: 'example', name: 'Docketeer example' } };
			if (channel === 'example:files') return [{ path: 'Start here.md', base64: toBase64(new TextEncoder().encode('# Start')) }];
			throw new Error(`Unknown channel: ${channel}`);
		};
		let quireWhenLoaded: HostBridge | undefined;
		await start(native, async (url) => {
			order.push(url);
			quireWhenLoaded = scope.quire as HostBridge;
		}, scope);
		expect(order).toEqual(['host:info', 'example:files', RENDERER]);
		expect(quireWhenLoaded?.platform).toBe('ios');
		expect(await quireWhenLoaded!.fs.read('Start here.md')).toBe('# Start');
		expect(typeof (scope.__quireNative as { emit: unknown }).emit).toBe('function');
	});

	it('does not load the renderer when native cannot answer', async () => {
		let loaded = false;
		await expect(start(async () => { throw new Error('no native'); }, async () => { loaded = true; }, {})).rejects.toThrow('no native');
		expect(loaded).toBe(false);
	});
});
