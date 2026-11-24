import { describe, expect, it, vi } from 'vitest';
vi.mock('../src/ui', async (orig) => ({ ...(await orig<object>()), Notice: class { constructor(public message: string) {} } }));

import { Commands } from '../src/app';
import { DocketRegistry } from '../src/docket-registry';
import { formatHotkey, hotkeyString, parseHotkey, reservedFor } from '../src/keymap';
import { Plugin } from '../src/plugin';

const linux = { isMacOS: false };
const mac = { isMacOS: true };

/** Just enough of App for the registry: an in-memory config folder and no workspace. */
function fakeApp() {
	const files = new Map<string, string>();
	const app: Record<string, unknown> = {
		vault: {
			configDir: '.quire',
			adapter: {
				exists: async (p: string) => files.has(p),
				read: async (p: string) => files.get(p)!,
				write: async (p: string, d: string) => { files.set(p, d); },
			},
		},
		workspace: null,
		docket: new DocketRegistry(),
		isLocked: () => false,
		trigger: vi.fn(),
	};
	app.commands = new Commands(app as never);
	return { app, cmds: app.commands as Commands, files };
}

describe('keymap', () => {
	it('resolves Mod per platform and sorts modifiers', () => {
		expect(hotkeyString({ modifiers: ['Shift', 'Mod'], key: 'p' }, linux)).toBe('Ctrl+Shift+P');
		expect(hotkeyString({ modifiers: ['Mod'], key: 'p' }, mac)).toBe('Meta+P');
		expect(formatHotkey({ modifiers: ['Mod', 'Shift'], key: 'p' }, mac)).toBe('⌘⇧P');
	});
	it('parses "Mod+Shift+P"', () => {
		expect(parseHotkey('Mod+Shift+P')).toEqual({ modifiers: ['Mod', 'Shift'], key: 'p' });
		expect(parseHotkey('F2')).toEqual({ modifiers: [], key: 'F2' });
	});
	it('knows system shortcuts on each platform', () => {
		expect(reservedFor(parseHotkey('Mod+C'), linux)).toBe('Copy');
		expect(reservedFor(parseHotkey('Mod+Q'), mac)).toBe('Quit');
		expect(reservedFor(parseHotkey('Mod+Q'), linux)).toBeNull();
		expect(reservedFor(parseHotkey('Alt+F4'), linux)).toBe('Close the window');
		expect(reservedFor(parseHotkey('Mod+P'), linux)).toBeNull();
	});
});

describe('command registry', () => {
	it('registers, marks the source and runs with arguments', () => {
		const { cmds } = fakeApp();
		const run = vi.fn();
		cmds.addCommand({ id: 'app:x', name: 'X', run });
		expect(cmds.findCommand('app:x')?.source).toBe('core');
		expect(cmds.executeCommandById('app:x', { file: 'f' })).toBe(true);
		expect(run).toHaveBeenCalledWith(expect.objectContaining({ args: { file: 'f' } }), { file: 'f' });
	});
	it('respects when()', () => {
		const { cmds } = fakeApp();
		const run = vi.fn();
		cmds.addCommand({ id: 'app:x', name: 'X', when: (ctx) => ctx.args.ok === true, run });
		expect(cmds.executeCommandById('app:x')).toBe(false);
		expect(cmds.executeCommandById('app:x', { ok: true })).toBe(true);
		expect(run).toHaveBeenCalledTimes(1);
	});
	it('keeps Obsidian-style callbacks working', () => {
		const { cmds } = fakeApp();
		const cb = vi.fn();
		let allowed = false;
		cmds.addCommand({ id: 'a:check', name: 'C', checkCallback: (checking) => { if (!allowed) return false; if (!checking) cb(); return true; } });
		expect(cmds.executeCommandById('a:check')).toBe(false);
		allowed = true;
		expect(cmds.executeCommandById('a:check')).toBe(true);
		expect(cb).toHaveBeenCalledTimes(1);
		// Editor commands need an editor; there is none here.
		cmds.addCommand({ id: 'a:ed', name: 'E', editorCallback: () => undefined });
		expect(cmds.isAvailable(cmds.findCommand('a:ed')!)).toBe(false);
	});
	it('refuses commands that need unlocking while locked', () => {
		const { app, cmds } = fakeApp();
		app.isLocked = () => true;
		const run = vi.fn();
		cmds.addCommand({ id: 'a:secret', name: 'S', requiresUnlocked: true, run });
		expect(cmds.executeCommandById('a:secret')).toBe(false);
		expect(run).not.toHaveBeenCalled();
	});
});

describe('conflicts and remapping', () => {
	it('finds clashes, taking contexts into account', () => {
		const { cmds } = fakeApp();
		const k = { modifiers: ['Mod' as const], key: 'k' };
		cmds.addCommand({ id: 'a:global', name: 'G', hotkeys: [k], callback: () => 0 });
		cmds.addCommand({ id: 'a:editor', name: 'E', hotkeys: [k], context: 'editor', callback: () => 0 });
		cmds.addCommand({ id: 'a:docket', name: 'D', hotkeys: [k], context: 'docket', callback: () => 0 });
		expect(cmds.conflicts(k, 'a:editor').map((c) => c.id)).toEqual(['a:global']);
		expect(cmds.conflicts(k, 'a:global').map((c) => c.id).sort()).toEqual(['a:docket', 'a:editor']);
	});
	it('stores remapped keys and goes back to the default', async () => {
		const { cmds, files } = fakeApp();
		const def = { modifiers: ['Mod' as const], key: 'n' };
		cmds.addCommand({ id: 'a:new', name: 'N', hotkeys: [def], callback: () => 0 });
		await cmds.setHotkeys('a:new', [{ modifiers: ['Mod', 'Alt'], key: 'n' }]);
		expect(cmds.hotkeysFor(cmds.findCommand('a:new')!)).toEqual([{ modifiers: ['Mod', 'Alt'], key: 'n' }]);
		expect(JSON.parse(files.get('.quire/hotkeys.json')!)).toHaveProperty('a:new');
		const fresh = fakeApp();
		fresh.files.set('.quire/hotkeys.json', files.get('.quire/hotkeys.json')!);
		await fresh.cmds.loadHotkeys();
		expect(fresh.cmds.isCustomised('a:new')).toBe(true);
		await cmds.setHotkeys('a:new', null);
		expect(cmds.hotkeysFor(cmds.findCommand('a:new')!)).toEqual([def]);
	});
});

describe('plugins', () => {
	class TestPlugin extends Plugin {
		override onload(): void {
			this.registerCommand({ id: 'go', name: 'Go', callback: () => 0 });
			this.registerDocketPanel({ id: 'panel', title: 'Panel', render: () => undefined });
			this.registerSearchProvider({ id: 'prov', title: 'Prov', prefixes: [''], search: () => [] });
			this.registerResultAction({ id: 'act', title: 'Act', appliesTo: () => true, run: () => undefined });
		}
	}
	it('namespaces what it registers and removes it all on unload', () => {
		const { app, cmds } = fakeApp();
		const docket = app.docket as DocketRegistry;
		const p = new TestPlugin(app as never, { id: 'demo', name: 'Demo', version: '1', minAppVersion: '0' } as never);
		p.load();
		expect(cmds.findCommand('demo:go')?.source).toBe('plugin:demo');
		expect(cmds.findCommand('demo:go')?.section).toBe('Demo');
		expect([...docket.panels.keys()]).toEqual(['demo:panel']);
		expect([...docket.providers.keys()]).toEqual(['demo:prov']);
		expect(docket.actionsFor({ id: 'r', type: 'Notes', title: 't' }).map((a) => a.id)).toEqual(['demo:act']);
		p.unload();
		expect(cmds.findCommand('demo:go')).toBeUndefined();
		expect(docket.panels.size + docket.providers.size + docket.actions.size).toBe(0);
	});
	it('orders panels: numbered first, then the rest as added', () => {
		const r = new DocketRegistry();
		r.addPanel({ id: 'late', title: 'L', render: () => undefined });
		r.addPanel({ id: 'two', title: '2', order: 2, render: () => undefined });
		r.addPanel({ id: 'one', title: '1', order: 1, render: () => undefined });
		expect(r.orderedPanels().map((p) => p.id)).toEqual(['one', 'two', 'late']);
		expect(() => r.addPanel({ id: 'one', title: 'again', render: () => undefined })).toThrow();
	});
});
