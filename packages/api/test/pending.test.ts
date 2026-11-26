import { describe, expect, it } from 'vitest';
import type { HostBridge, HostEntry, HostFsEvent } from '../src/host';
import { Vault } from '../src/vault';
import type { TAbstractFile } from '../src/files';

/** A homebase on a host that has a note not downloaded yet (iCloud). */
function vaultWith(entries: HostEntry[]) {
	let send: (events: HostFsEvent[]) => void = () => undefined;
	const host = {
		vault: { path: 'iCloud Drive/Law', name: 'Law' },
		fs: { tree: async () => entries },
		onFsEvents: (cb: (events: HostFsEvent[]) => void) => { send = cb; },
	} as unknown as HostBridge;
	const vault = new Vault(host);
	return { vault, send: (events: HostFsEvent[]) => send(events) };
}

describe('notes not downloaded yet', () => {
	it('are known by name, and count as changed when they arrive, even with the same time', async () => {
		const stat = { type: 'file' as const, size: 0, mtime: 100, ctime: 100 };
		const { vault, send } = vaultWith([{ path: 'Torts.md', ...stat, pending: true }, { path: 'Here.md', ...stat }]);
		await vault.load();
		const torts = vault.getFileByPath('Torts.md')!;
		expect(torts.pending).toBe(true);
		expect(vault.getFileByPath('Here.md')!.pending).toBeUndefined();
		const modified: TAbstractFile[] = [];
		vault.on('modify', (f) => { modified.push(f); });

		send([{ path: 'Torts.md', stat: { ...stat, pending: true } }]);
		await new Promise((r) => setTimeout(r, 0));
		expect(modified).toEqual([]);

		send([{ path: 'Torts.md', stat: { ...stat, size: 12 } }]);
		await new Promise((r) => setTimeout(r, 0));
		expect(modified).toEqual([torts]);
		expect(torts.pending).toBeUndefined();
		expect(torts.stat.size).toBe(12);

		// An ordinary echo with the same time is still ignored.
		send([{ path: 'Here.md', stat }]);
		await new Promise((r) => setTimeout(r, 0));
		expect(modified).toEqual([torts]);
	});
});
