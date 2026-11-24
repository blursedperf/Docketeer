/**
 * Docket commands and the feature flag. The commands always exist (so they can be found and remapped);
 * the tray is built only while Settings → Appearance → Docket is on. With it on, Mod+P opens the Docket
 * and the command palette gives up Mod+P (its commands are the Docket's ">" prefix).
 */
import type { App, Hotkey } from '@quire/api';
import { Docket } from './docket';
import { registerCorePanels } from './panels';
import { registerCoreProviders } from './providers';
import { registerNoteCommands } from './actions';

const MOD_P: Hotkey = { modifiers: ['Mod'], key: 'p' };

export function registerDocket(app: App): { start(): void; get(): Docket | null } {
	let docket: Docket | null = null;
	let cleanup: (() => void)[] = [];
	const on = () => app.config.docket === true;
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

	const apply = () => {
		const palette = app.commands.findCommand('app:command-palette');
		if (on() && !docket) {
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
