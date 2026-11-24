/**
 * Tiling from the keyboard: split, move between panes, move tabs between panes, resize, equalise, zoom,
 * reopen a closed tab; layout presets and saved layouts. All are commands, so they are in the Docket.
 */
import { type App, type Direction, type Hotkey, Notice, PRESETS, Platform, type Preset, TFile } from '@quire/api';
import { NameModal } from './dialogs';

const ARROW: Record<Direction, string> = { left: 'ArrowLeft', right: 'ArrowRight', up: 'ArrowUp', down: 'ArrowDown' };
const NAME: Record<Direction, string> = { left: 'left', right: 'right', up: 'above', down: 'below' };

/**
 * Resizing: Mod+Ctrl+arrows on macOS, as planned. Elsewhere Mod+Ctrl is just Ctrl, and Ctrl+arrows move
 * by word in the editor, so Mod+Alt with [ ] (narrower, wider) and - = (shorter, taller) instead.
 */
function resizeKeys(which: 'wider' | 'narrower' | 'taller' | 'shorter'): Hotkey[] {
	if (Platform.isMacOS) return [{ modifiers: ['Mod', 'Ctrl'], key: { wider: 'ArrowRight', narrower: 'ArrowLeft', taller: 'ArrowDown', shorter: 'ArrowUp' }[which] }];
	return [{ modifiers: ['Mod', 'Alt'], key: { wider: ']', narrower: '[', taller: '=', shorter: '-' }[which] }];
}

export function registerTiling(app: App): { applyPreset(p: Preset): Promise<void>; saveLayout(): void; applySaved(name: string): Promise<void> } {
	const { workspace } = app;
	const add = (c: Parameters<App['commands']['addCommand']>[0]) => app.commands.addCommand({ section: 'Layout', ...c });
	const hasPanes = () => workspace.rootTabs().length > 1;

	for (const dir of ['left', 'right', 'up', 'down'] as Direction[]) {
		add({ id: `app:focus-pane-${dir}`, name: `Go to the pane ${NAME[dir]}`, icon: `arrow-${dir}`, hotkeys: [{ modifiers: ['Mod', 'Alt'], key: ARROW[dir] }], when: hasPanes, run: () => { workspace.focusPane(dir); } });
		add({
			id: `app:move-tab-${dir}`, name: `Move tab to the pane ${NAME[dir]}`, icon: 'move', hotkeys: [{ modifiers: ['Mod', 'Alt', 'Shift'], key: ARROW[dir] }],
			when: () => !!workspace.activeLeaf && !workspace.activeLeaf.isSidebar(),
			run: () => { if (!workspace.moveLeafToPane(workspace.activeLeaf!, dir)) new Notice('Nothing to move: this is the only tab, and there is no pane that way.'); },
		});
	}
	const resize = (id: string, name: string, which: 'wider' | 'narrower' | 'taller' | 'shorter', axis: 'width' | 'height', amount: number) =>
		add({ id, name, icon: 'move-horizontal', hotkeys: resizeKeys(which), when: hasPanes, run: () => { workspace.resizeActivePane(axis, amount); } });
	resize('app:pane-wider', 'Make the pane wider', 'wider', 'width', 0.05);
	resize('app:pane-narrower', 'Make the pane narrower', 'narrower', 'width', -0.05);
	resize('app:pane-taller', 'Make the pane taller', 'taller', 'height', 0.05);
	resize('app:pane-shorter', 'Make the pane shorter', 'shorter', 'height', -0.05);
	add({ id: 'app:equalise-panes', name: 'Make all panes the same size', icon: 'columns-3', aliases: ['Equalize panes'], hotkeys: [{ modifiers: ['Mod', 'Shift'], key: '=' }], when: hasPanes, run: () => workspace.equalisePanes() });
	add({ id: 'app:zoom-pane', name: 'Zoom the pane (and back)', icon: 'maximize-2', aliases: ['Maximise pane', 'Full screen pane'], hotkeys: [{ modifiers: ['Mod', 'Shift'], key: 'Enter' }], when: () => hasPanes() || workspace.zoomed, run: () => { workspace.toggleZoom(); } });
	add({ id: 'app:reopen-closed-tab', name: 'Reopen closed tab', icon: 'rotate-ccw', hotkeys: [{ modifiers: ['Mod', 'Shift'], key: 't' }], when: () => workspace.closedTabs.length > 0, run: () => workspace.reopenClosed() });
	// Split right and down get their planned shortcuts (the commands exist already).
	const split = (id: string, keys: Hotkey[]) => { const c = app.commands.findCommand(id); if (c) c.hotkeys = keys; };
	split('app:split-right', [{ modifiers: ['Mod'], key: '\\' }]);
	split('app:split-down', [{ modifiers: ['Mod', 'Shift'], key: '\\' }]);
	// Zooming out again whenever the layout changes underneath.
	workspace.on('layout-change', () => { if (workspace.zoomed && workspace.rootTabs().length < 2) workspace.toggleZoom(); });

	/** The most recently used note other than `not`, for "previous" columns. */
	const previous = (not: TFile | null): TFile | null => {
		for (const p of app.search.usage.recent('note', 20)) {
			const f = app.vault.getFileByPath(p);
			if (f && f !== not && !app.isLocked(f)) return f;
		}
		return null;
	};

	const applyPreset = async (p: Preset) => {
		const current = workspace.getActiveFile();
		workspace.mergeAllPanes();
		let leaf = workspace.activeLeaf && !workspace.activeLeaf.isSidebar() ? workspace.activeLeaf : workspace.rootTabs()[0]?.activeLeaf ?? null;
		if (!leaf) return;
		const first = leaf;
		for (const col of p.columns.slice(1)) {
			leaf = workspace.createLeafBySplit(leaf, 'vertical');
			const file = col.show === 'previous' ? previous(current) : null;
			if (file) await leaf.openFile(file);
		}
		const split = first.parent?.parent;
		if (split && p.columns.length > 1) { split.children.forEach((c, i) => { c.weight = p.columns[i]?.weight ?? 1; }); split.render(); }
		workspace.setActiveLeaf(first, { focus: true });
		workspace.onResized();
		if (p.docket) {
			await app.setConfig('docketMode', p.docket.mode);
			await app.setConfig('docketPanel', p.docket.panel);
		}
		app.trigger('layout-preset', p.id);
		new Notice(`Layout: ${p.name}.`);
	};
	for (const p of PRESETS) add({ id: `app:layout-${p.id}`, name: `Layout: ${p.name}`, icon: 'layout-panel-left', keywords: [p.description], run: () => applyPreset(p) });

	const saveLayout = () => new NameModal(app, 'Save layout', '', 'Save', (name) => {
		const n = name.trim();
		if (!n) return;
		void app.setConfig('savedLayouts', { ...(app.config.savedLayouts ?? {}), [n]: workspace.getMainLayout() }).then(() => new Notice(`Saved layout “${n}”.`));
	}).open();
	add({ id: 'app:save-layout', name: 'Save this layout…', icon: 'save', run: saveLayout });
	const applySaved = async (name: string) => {
		const data = app.config.savedLayouts?.[name];
		if (data) await workspace.setMainLayout(data);
	};
	return { applyPreset, saveLayout, applySaved };
}
