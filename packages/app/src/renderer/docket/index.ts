/**
 * The Docket's commands, and building it. The Docket is the way into everything since the sidebars
 * went (Phase 6): Mod+P opens it; the old palette, switcher and sidebar commands open it where their
 * feature now lives. The `docket` setting exists only so tests can take it down and build it again.
 */
import type { App, Hotkey } from '@quire/api';
import { Docket } from './docket';
import { registerCorePanels } from './panels';
import { registerCoreProviders } from './providers';
import { registerNoteCommands, showLinksFrom, showLinksTo, showMentions } from './actions';

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
	 * The old palette, switcher and sidebar commands, kept by id (so remapped keys and plugins calling them
	 * still work) and now opening the Docket where each feature lives.
	 */
	const note = () => app.workspace.getActiveFile();
	const open = (o?: { query?: string; panel?: string }) => { if (docket) { if (o?.panel) docket.showPanel(o.panel); else docket.open(o); } };
	add({ id: 'app:command-palette', name: 'Commands', icon: 'terminal', section: 'Search', aliases: ['Command palette'], when: () => !!docket, run: () => open({ query: '>' }) });
	add({ id: 'app:quick-switcher', name: 'Find a note', icon: 'search', section: 'Search', aliases: ['Quick switcher', 'Open note', 'Go to file'], hotkeys: [{ modifiers: ['Mod'], key: 'o' }], when: () => !!docket, run: () => open() });
	add({ id: 'app:search', name: 'Search in all notes', icon: 'search', section: 'Search', aliases: ['Find in notes', 'Full-text search'], hotkeys: [{ modifiers: ['Mod', 'Shift'], key: 'f' }], when: () => !!docket, run: () => open() });
	add({ id: 'app:show-outline', name: 'Show outline', icon: 'list-tree', section: 'View', when: () => !!docket, run: () => open({ panel: 'core:outline' }) });
	add({ id: 'app:show-tags', name: 'Show tags', icon: 'tags', section: 'View', when: () => !!docket, run: () => open({ query: '#' }) });
	add({ id: 'app:reveal-file', name: 'Show this note in Units', icon: 'folders', section: 'Notes', aliases: ['Reveal current file in navigation'], when: () => !!docket && !!note(), run: () => open({ panel: 'core:units' }) });
	add({ id: 'app:show-backlinks', name: 'Show links to this note', icon: 'link', section: 'View', aliases: ['Backlinks'], when: () => !!docket && !!note(), run: () => { const f = note(); if (f && docket) { docket.open(); void showLinksTo(app, docket, f); } } });
	add({ id: 'app:show-outgoing-links', name: 'Show links from this note', icon: 'arrow-up-right', section: 'View', aliases: ['Outgoing links'], when: () => !!docket && !!note(), run: () => { const f = note(); if (f && docket) { docket.open(); showLinksFrom(app, docket, f); } } });
	add({ id: 'app:show-mentions', name: 'Show mentions of this note', icon: 'text-search', section: 'View', aliases: ['Unlinked mentions'], when: () => !!docket && !!note(), run: () => { const f = note(); if (f && docket) { docket.open(); void showMentions(app, docket, f); } } });

	const apply = () => {
		if (on() && !docket) {
			docket = new Docket(app);
			(app as unknown as { docketUI?: Docket }).docketUI = docket;
			cleanup = [registerCoreProviders(app, docket), registerCorePanels(app, docket)];
		} else if (!on() && docket) {
			docket.destroy();
			docket = null;
			delete (app as unknown as { docketUI?: Docket }).docketUI;
			for (const c of cleanup) c();
			cleanup = [];
		}
	};
	// Locking or unlocking changes what panels may show.
	app.on('lock-change', () => { if (docket?.isOpen) void docket.refreshPanel(); });
	app.on('config-changed', (key: string) => {
		if (key === 'docket') apply();
		if (key === 'docketMode') docket?.applyModeFromConfig();
	});
	// A layout preset that brings the Docket (Revision: pinned on Authorities).
	app.on('layout-preset', () => { if (docket && app.config.docketMode === 'pinned') docket.open({ panel: String(app.config.docketPanel) }); });
	return { start: apply, get: () => docket };
}
