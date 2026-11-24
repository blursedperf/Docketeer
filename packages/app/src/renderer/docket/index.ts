/**
 * Docket commands and the feature flag. The commands always exist (so they can be found and remapped);
 * the tray is built only while Settings → Appearance → Docket is on. With it on, Mod+P opens the Docket
 * and the command palette gives up Mod+P (its commands are the Docket's ">" prefix).
 */
import type { App, Hotkey } from '@quire/api';
import { Docket } from './docket';
import { registerCorePanels } from './panels';
import { registerCoreProviders } from './providers';
import { registerNoteCommands, showLinksFrom, showLinksTo } from './actions';

const MOD_P: Hotkey = { modifiers: ['Mod'], key: 'p' };

export function registerDocket(app: App): { start(): void; get(): Docket | null } {
	let docket: Docket | null = null;
	let cleanup: (() => void)[] = [];
	// Always on since Phase 6 (the sidebars are gone); the flag stays for the tests that build and remove it.
	const on = () => app.config.docket !== false;
	const add = (c: Parameters<App['commands']['addCommand']>[0]) => app.commands.addCommand({ section: 'Docket', ...c });

	add({
		id: 'app:docket', name: 'Open or close the Docket', icon: 'panel-top', aliases: ['Docket', 'Everything'],
		hotkeys: [MOD_P], when: on, run: () => docket?.toggle(),
	});
	add({
		id: 'app:docket-toggle-mode', name: 'Docket: switch between peek and pinned', icon: 'pin',
		hotkeys: [{ modifiers: ['Mod', 'Shift'], key: 'p' }], when: on, run: () => { docket?.toggleMode(); if (!docket?.isOpen) docket?.open(); },
	});
	add({ id: 'app:docket-taller', name: 'Docket: make taller', context: 'docket', hotkeys: [{ modifiers: ['Mod', 'Alt'], key: 'ArrowDown' }], when: () => !!docket?.isOpen, run: () => docket?.resize(0.05) });
	add({ id: 'app:docket-shorter', name: 'Docket: make shorter', context: 'docket', hotkeys: [{ modifiers: ['Mod', 'Alt'], key: 'ArrowUp' }], when: () => !!docket?.isOpen, run: () => docket?.resize(-0.05) });
	for (let n = 1; n <= 9; n++) {
		add({
			id: `app:docket-panel-${n}`, name: `Docket: show panel ${n}`, context: 'docket', hotkeys: [{ modifiers: ['Mod'], key: String(n) }],
			when: () => !!docket?.isOpen && app.docket.orderedPanels().length >= n,
			run: () => docket?.showPanelNumber(n),
		});
	}

	registerNoteCommands(app);

	/**
	 * The old sidebar commands, and the palette and switcher, now open the Docket where their feature lives
	 * (decision: map old shortcuts to new commands where sensible). Same ids, so remapped keys keep working.
	 */
	const retarget = (id: string, run: () => unknown, when: () => boolean = () => !!docket) => {
		const c = app.commands.findCommand(id);
		if (!c) return;
		delete c.callback; delete c.checkCallback; delete c.editorCallback; delete c.editorCheckCallback;
		c.run = run;
		c.when = when;
	};
	const note = () => app.workspace.getActiveFile();
	const retargetAll = () => {
		retarget('app:command-palette', () => docket?.open({ query: '>' }));
		retarget('app:quick-switcher', () => docket?.open());
		retarget('app:search', () => docket?.open());
		retarget('app:show-outline', () => docket?.showPanel('core:outline'));
		retarget('app:show-tags', () => docket?.open({ query: '#' }));
		retarget('app:reveal-file', () => docket?.showPanel('core:units'), () => !!docket && !!note());
		retarget('app:show-backlinks', () => { const f = note(); if (f && docket) { docket.open(); void showLinksTo(app, docket, f); } }, () => !!docket && !!note());
		retarget('app:show-outgoing-links', () => { const f = note(); if (f && docket) { docket.open(); showLinksFrom(app, docket, f); } }, () => !!docket && !!note());
		for (const id of ['app:toggle-left-sidebar', 'app:toggle-right-sidebar', 'app:collapse-folders']) retarget(id, () => undefined, () => app.workspace.sidebars);
		// Mod+O and Mod+Shift+F keep working: they open the Docket too.
	};

	const apply = () => {
		const palette = app.commands.findCommand('app:command-palette');
		if (on() && !docket) {
			retargetAll();
			docket = new Docket(app);
			(app as unknown as { docketUI?: Docket }).docketUI = docket;
			cleanup = [registerCoreProviders(app), registerCorePanels(app, docket)];
			if (palette) palette.hotkeys = [];
		} else if (!on() && docket) {
			docket.destroy();
			docket = null;
			delete (app as unknown as { docketUI?: Docket }).docketUI;
			for (const c of cleanup) c();
			cleanup = [];
			if (palette) palette.hotkeys = [MOD_P];
		}
	};
	app.on('config-changed', (key: string) => {
		if (key === 'docket') apply();
		if (key === 'docketMode') docket?.applyModeFromConfig();
	});
	// A layout preset that brings the Docket (Revision: pinned on Authorities).
	app.on('layout-preset', () => { if (docket && app.config.docketMode === 'pinned') docket.open({ panel: String(app.config.docketPanel) }); });
	return { start: apply, get: () => docket };
}
