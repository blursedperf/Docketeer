/**
 * The Docket's commands, and building it. The Docket is the way into everything since the sidebars
 * went (Phase 6): its key (Super+D, ⌘D on macOS, Ctrl+P on Windows) opens it; the old palette, switcher and sidebar commands open it where their
 * feature now lives. The `docket` setting exists only so tests can take it down and build it again.
 */
import { type App, Platform, defaultDocketKey, defaultDocketModeKey } from '@quire/api';
import { Docket } from './docket';
import { registerCorePanels } from './panels';
import { registerCoreProviders } from './providers';
import { registerNoteCommands, showLinksFrom, showLinksTo, showMentions } from './actions';
import { revealInUnits } from './panels/units';
import { registerCustomPanels } from './custom-panels';


export function registerDocket(app: App): { start(): void; get(): Docket | null } {
	let docket: Docket | null = null;
	let cleanup: (() => void)[] = [];
	// Always on since Phase 6 (the sidebars are gone); the flag stays for the tests that build and remove it.
	const on = () => app.config.docket !== false;
	const add = (c: Parameters<App['commands']['addCommand']>[0]) => app.commands.addCommand({ section: 'Docket', ...c });

	add({
		id: 'app:docket', name: 'Open or close the Docket', icon: 'panel-top', aliases: ['Docket', 'Everything'],
		hotkeys: [defaultDocketKey(Platform)], when: on, run: () => docket?.toggle(),
	});
	add({
		id: 'app:docket-toggle-mode', name: 'Docket: switch between peek and pinned', icon: 'pin',
		hotkeys: [defaultDocketModeKey(Platform)], when: on, run: () => { docket?.toggleMode(); if (!docket?.isOpen) docket?.open(); },
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

	/** The note or folder of the focused Docket row, if any (rows in Subjects and other panels set data-path). */
	const rowTarget = () => {
		const el = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>('.docket-panel [data-path]');
		const path = el?.dataset.path;
		return path ? app.vault.getAbstractFileByPath(path) : null;
	};
	add({
		id: 'app:docket-delete-row', name: 'Docket: delete the selected note or folder', icon: 'trash-2', context: 'docket',
		hotkeys: [{ modifiers: [], key: 'Delete' }, { modifiers: ['Mod'], key: 'Backspace' }],
		when: () => !!rowTarget(), run: () => { app.commands.executeCommandById('app:delete-file', { file: rowTarget() }); },
	});
	add({
		id: 'app:docket-rename-row', name: 'Docket: rename the selected note or folder', icon: 'pencil', context: 'docket',
		hotkeys: [{ modifiers: [], key: 'F2' }],
		when: () => !!rowTarget(), run: () => { app.commands.executeCommandById('app:rename-file', { file: rowTarget() }); },
	});

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
	add({ id: 'app:reveal-file', name: 'Show this note in Subjects', icon: 'folders', section: 'Notes', aliases: ['Reveal current file in navigation', 'Show in Units'], when: () => !!docket && !!note(), run: () => open({ panel: 'core:units' }) });
	add({ id: 'app:show-backlinks', name: 'Show links to this note', icon: 'link', section: 'View', aliases: ['Backlinks'], when: () => !!docket && !!note(), run: () => { const f = note(); if (f && docket) { docket.open(); void showLinksTo(app, docket, f); } } });
	add({ id: 'app:show-outgoing-links', name: 'Show links from this note', icon: 'arrow-up-right', section: 'View', aliases: ['Outgoing links'], when: () => !!docket && !!note(), run: () => { const f = note(); if (f && docket) { docket.open(); showLinksFrom(app, docket, f); } } });
	add({ id: 'app:show-mentions', name: 'Show mentions of this note', icon: 'text-search', section: 'View', aliases: ['Unlinked mentions'], when: () => !!docket && !!note(), run: () => { const f = note(); if (f && docket) { docket.open(); void showMentions(app, docket, f); } } });

	const apply = () => {
		if (on() && !docket) {
			docket = new Docket(app);
			(app as unknown as { docketUI?: Docket }).docketUI = docket;
			cleanup = [registerCoreProviders(app, docket), registerCorePanels(app, docket), registerCustomPanels(app, docket)];
		} else if (!on() && docket) {
			docket.destroy();
			docket = null;
			delete (app as unknown as { docketUI?: Docket }).docketUI;
			for (const c of cleanup) c();
			cleanup = [];
		}
	};
	// A plugin asking to show its panel.
	app.docket.on('show-panel', (id: string) => { if (!docket) return; docket.showPanel(id); });
	app.docket.on('search', (text: string) => { docket?.open({ query: text }); });
	app.docket.on('refresh-panel', (id: string) => { if (docket?.isOpen && docket.shownPanelId === id) void docket.refreshPanel(); });
	// Unit tags changed (a folder marked or unmarked): what the Docket shows follows.
	app.workspace.on('units-changed', () => { if (docket?.isOpen) void docket.refreshPanel(); });
	// A subject or topic clicked in a note's header band: show it in Subjects.
	app.workspace.on('reveal-folder', (path: string) => {
		if (!docket) return;
		revealInUnits(path);
		docket.showPanel('core:units');
	});
	// Notes and folders made, renamed, moved or deleted: what the Docket shows follows (once things settle).
	let pending = 0;
	const follow = () => { if (!docket?.isOpen) return; window.clearTimeout(pending); pending = window.setTimeout(() => { void docket?.refresh(); }, 120); };
	for (const ev of ['create', 'delete', 'rename'] as const) app.vault.on(ev, follow);
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
