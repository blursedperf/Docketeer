import { describe, expect, it, vi } from 'vitest';
vi.mock('../src/ui', async (orig) => ({ ...(await orig<object>()), Notice: class { constructor(public message: string) {} } }));

import { Commands } from '../src/app';
import { DocketRegistry } from '../src/docket-registry';
import { defaultDocketKey, defaultDocketModeKey, eventString, formatHotkey, hotkeyString, parseHotkey, reservedFor } from '../src/keymap';
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
		// A command for one place wins over a global one there: not a clash.
		expect(cmds.conflicts(k, 'a:editor')).toEqual([]);
		cmds.addCommand({ id: 'a:global2', name: 'G2', hotkeys: [k], callback: () => 0 });
		expect(cmds.conflicts(k, 'a:global').map((c) => c.id)).toEqual(['a:global2']);
		cmds.addCommand({ id: 'a:docket2', name: 'D2', hotkeys: [k], context: 'docket', callback: () => 0 });
		expect(cmds.conflicts(k, 'a:docket').map((c) => c.id)).toEqual(['a:docket2']);
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

import { caseNameAt, clampHeight, contextPanel, groupResults, inFootnote, parsePrefix } from '../src/docket-logic';

describe('docket logic', () => {
	it('reads prefixes', () => {
		expect(parsePrefix('> new note')).toEqual({ prefix: '>', text: 'new note' });
		// A plugin's own prefix counts only when a provider answers it; letters, digits and the Docket's own are not plugins'.
		expect(parsePrefix('~duty breach', ['~'])).toEqual({ prefix: '~', text: 'duty breach' });
		expect(parsePrefix('~duty', [])).toEqual({ prefix: '', text: '~duty' });
		expect(parsePrefix('xduty', ['x'])).toEqual({ prefix: '', text: 'xduty' });
		expect(parsePrefix('mabo')).toEqual({ prefix: '', text: 'mabo' });
		expect(parsePrefix('?')).toEqual({ prefix: '?', text: '' });
	});
	it('finds the case name under the cursor', () => {
		const line = 'In *Mabo v Queensland [No 2]* the High Court held';
		expect(caseNameAt(line, line.indexOf('Queensland'))).toBe('Mabo v Queensland [No 2]');
		expect(caseNameAt(line, line.indexOf('held'))).toBeNull();
		expect(caseNameAt('See Cooper v Stuart (1889) 14 App Cas 286.', 6)).toBe('Cooper v Stuart');
		expect(caseNameAt('R v Tang is about slavery', 1)).toBe('R v Tang');
	});
	it('knows when the cursor is in a footnote', () => {
		expect(inFootnote('[^3]: Ibid 12.', 8)).toBe(true);
		expect(inFootnote('Text^[Ibid 4.] more', 8)).toBe(true);
		expect(inFootnote('Text^[Ibid 4.] more', 17)).toBe(false);
	});
	it('chooses the panel from the context', () => {
		expect(contextPanel('[^1]: Mabo v Queensland [No 2] (1992) 175 CLR 1.', 10)).toEqual({ panel: 'cite' });
		expect(contextPanel('Mabo v Queensland [No 2] decided', 3)).toEqual({ panel: 'authorities', focus: 'Mabo v Queensland [No 2]' });
		expect(contextPanel('Nothing here', 3)).toBeNull();
	});
	it('groups and limits results', () => {
		const g = groupResults([
			{ id: 'c1', type: 'Commands', title: 'a', score: 1 },
			{ id: 'n1', type: 'Notes', title: 'b', score: 1 },
			{ id: 'n2', type: 'Notes', title: 'c', score: 5 },
			{ id: 'n3', type: 'Notes', title: 'd', score: 3 },
		], 2);
		expect(g.map((x) => x.type)).toEqual(['Notes', 'Commands']);
		expect(g[0]!.items.map((x) => x.id)).toEqual(['n2', 'n3']);
		expect(g[0]!.total).toBe(3);
	});
	it('clamps the height', () => {
		expect(clampHeight(0.9)).toBe(0.6);
		expect(clampHeight(0.1)).toBe(0.2);
		expect(clampHeight(0.351)).toBe(0.35);
	});
});

describe('shifted keys', () => {
	it('match by the physical key when Shift changes the character', () => {
		const ev = (key: string, code: string) => ({ altKey: false, ctrlKey: true, metaKey: false, shiftKey: true, key, code });
		expect(eventString(ev('|', 'Backslash'))).toBe(hotkeyString({ modifiers: ['Mod', 'Shift'], key: '\\' }, linux));
		expect(eventString(ev('+', 'Equal'))).toBe(hotkeyString({ modifiers: ['Mod', 'Shift'], key: '=' }, linux));
		expect(eventString(ev('T', 'KeyT'))).toBe('Ctrl+Shift+T');
	});
	it('runs the Docket-only command before a global one on the same keys', () => {
		const { app, cmds } = fakeApp();
		app.docketOpen = true;
		const order: string[] = [];
		const k = { modifiers: ['Mod' as const, 'Alt' as const], key: 'ArrowUp' };
		cmds.addCommand({ id: 'a:global', name: 'G', hotkeys: [k], run: () => order.push('global') });
		cmds.addCommand({ id: 'a:docket', name: 'D', hotkeys: [k], context: 'docket', run: () => order.push('docket') });
		(cmds as unknown as { onKeyDown(e: KeyboardEvent): void }).onKeyDown({ key: 'ArrowUp', code: 'ArrowUp', ctrlKey: true, altKey: true, shiftKey: false, metaKey: false, isComposing: false, preventDefault() {}, stopPropagation() {} } as unknown as KeyboardEvent);
		expect(order).toEqual(['docket']);
	});
});

describe('"New note" goes last', () => {
	it('is never the first, selected result when something matches', () => {
		const g = groupResults([
			{ id: 'create:x', type: 'New note', title: 'Create note' },
			{ id: 'h', type: 'Headings', title: 'H' },
			{ id: 'p', type: 'Plugin things', title: 'P' },
		]);
		expect(g.map((x) => x.type)).toEqual(['Headings', 'Plugin things', 'New note']);
	});
});

describe('app-wide hotkeys (the Docket key)', () => {
	it('sit between the default and a homebase\'s own, and are saved in the app\'s settings', async () => {
		const { app, cmds } = fakeApp();
		const config: Record<string, unknown> = { hotkeys: { 'a:x': [{ modifiers: ['Mod'], key: 'k' }], 'a:bad': 'nonsense' } };
		app.host = { app: { getConfig: async () => config, setConfig: async (p: Record<string, unknown>) => { Object.assign(config, p); } } };
		cmds.addCommand({ id: 'a:x', name: 'X', hotkeys: [{ modifiers: ['Mod'], key: 'p' }] });
		const x = cmds.findCommand('a:x')!;
		await cmds.loadHotkeys();
		expect(cmds.hotkeysFor(x)).toEqual([{ modifiers: ['Mod'], key: 'k' }]);
		expect(cmds.isAppCustomised('a:x')).toBe(true);
		expect(cmds.isAppCustomised('a:bad')).toBe(false);
		await cmds.setHotkeys('a:x', [{ modifiers: ['Alt'], key: 'j' }]);
		expect(cmds.hotkeysFor(x)).toEqual([{ modifiers: ['Alt'], key: 'j' }]);
		await cmds.setHotkeys('a:x', null);
		expect(cmds.hotkeysFor(x)).toEqual([{ modifiers: ['Mod'], key: 'k' }]);
		await cmds.setAppHotkeys('a:x', [{ modifiers: ['Mod', 'Shift'], key: 'k' }]);
		expect(config.hotkeys).toEqual({ 'a:x': [{ modifiers: ['Mod', 'Shift'], key: 'k' }] });
		await cmds.setAppHotkeys('a:x', null);
		expect(cmds.hotkeysFor(x)).toEqual([{ modifiers: ['Mod'], key: 'p' }]);
		expect(config.hotkeys).toEqual({});
		expect(app.trigger).toHaveBeenCalledWith('hotkeys-changed', 'a:x');
	});
});

describe('panel arrangement', () => {
	const panel = (id: string, order?: number) => ({ id, title: id, order, render: () => undefined });
	it('orders the chosen panels first, hides the hidden ones, and keeps the rest in their default order', () => {
		const r = new DocketRegistry();
		for (const p of [panel('a', 1), panel('b', 2), panel('c', 3), panel('plugin')]) r.addPanel(p);
		expect(r.orderedPanels().map((p) => p.id)).toEqual(['a', 'b', 'c', 'plugin']);
		r.setArrangement({ order: ['c', 'missing', 'a'], hidden: ['b'] });
		expect(r.allPanels().map((p) => p.id)).toEqual(['c', 'a', 'b', 'plugin']);
		expect(r.orderedPanels().map((p) => p.id)).toEqual(['c', 'a', 'plugin']);
		expect(r.panels.has('b')).toBe(true);
	});
});

describe('the Docket key and the Super key', () => {
	const linux = { isMacOS: false, isLinux: true };
	const mac = { isMacOS: true };
	const win = { isMacOS: false, isWin: true };
	it('is Super+D (⌘D on macOS), and Ctrl+P on Windows, where Win+D shows the desktop', () => {
		expect(formatHotkey(defaultDocketKey(linux), linux)).toBe('Super+D');
		expect(formatHotkey(defaultDocketKey(mac), mac)).toBe('⌘D');
		expect(formatHotkey(defaultDocketKey(win), win)).toBe('Ctrl+P');
		expect(formatHotkey(defaultDocketModeKey(linux), linux)).toBe('Super+Shift+D');
		expect(formatHotkey(defaultDocketModeKey(win), win)).toBe('Ctrl+Shift+P');
	});
	it('calls the Meta key Super on Linux and Win on Windows', () => {
		const footnote = { modifiers: ['Meta' as const, 'Alt' as const], key: 'f' };
		expect(formatHotkey(footnote, linux)).toBe('Super+Alt+F');
		expect(formatHotkey(footnote, win)).toBe('Win+Alt+F');
		expect(formatHotkey(footnote, mac)).toBe('⌥⌘F');
		expect(formatHotkey({ modifiers: ['Mod', 'Shift', 'Alt'], key: 'k' }, linux)).toBe('Ctrl+Alt+Shift+K');
	});
	it('keeps Win+D for the system on Windows only', () => {
		expect(reservedFor({ modifiers: ['Meta'], key: 'd' }, win)).toBe('Show the desktop');
		expect(reservedFor({ modifiers: ['Meta'], key: 'd' }, linux)).toBeNull();
		expect(reservedFor({ modifiers: ['Meta'], key: 'd' }, mac)).toBeNull();
	});
});
