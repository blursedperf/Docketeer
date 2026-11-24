/**
 * Layout (Mod+6): presets and saved layouts (Enter applies), the panes and tabs open now (Enter moves to
 * one; → splits, closes or moves it), and the tiling commands with their shortcuts.
 */
import { type App, type DocketPanel, PRESETS, type Preset, type WorkspaceLeaf, formatHotkey } from '@quire/api';
import type { Docket } from '../docket';
import { row, section } from './common';

interface Tiling { applyPreset(p: Preset): Promise<void>; saveLayout(): void; applySaved(name: string): Promise<void> }

export function layoutPanel(app: App, docket: Docket): DocketPanel {
	const tiling = () => (app as unknown as { tiling: Tiling }).tiling;
	const keyOf = (id: string) => { const c = app.commands.findCommand(id); const k = c ? app.commands.hotkeysFor(c)[0] : undefined; return k ? formatHotkey(k) : undefined; };
	return {
		id: 'core:layout', title: 'Layout', icon: 'layout-panel-left', order: 6, source: 'core',
		render: (el) => {
			const pre = section(el, 'Presets');
			for (const p of PRESETS) row(pre, docket, p.name, () => { docket.close(); void tiling().applyPreset(p); }, { icon: 'layout-template', detail: p.description });

			const saved = Object.keys(app.config.savedLayouts ?? {});
			const sv = section(el, 'Saved layouts', saved.length);
			for (const name of saved) {
				row(sv, docket, name, () => { docket.close(); void tiling().applySaved(name); }, {
					icon: 'layout-dashboard',
					actions: () => [{ title: 'Delete', icon: 'trash-2', run: async () => { const next = { ...app.config.savedLayouts }; delete next[name]; await app.setConfig('savedLayouts', next); await docket.refreshPanel(); } }],
				});
			}
			row(sv, docket, 'Save this layout…', () => { docket.close(); tiling().saveLayout(); }, { icon: 'save', cls: 'is-command' });

			const leaves: WorkspaceLeaf[] = [];
			app.workspace.iterateRootLeaves((l) => { leaves.push(l); });
			const panes = new Map<unknown, WorkspaceLeaf[]>();
			for (const l of leaves) { const list = panes.get(l.parent) ?? []; list.push(l); panes.set(l.parent, list); }
			let n = 0;
			for (const tabs of panes.values()) {
				const sec = section(el, `Pane ${++n}`, tabs.length);
				for (const l of tabs) {
					const cmd = (id: string, title: string) => ({ title, icon: app.commands.findCommand(id)?.icon, run: () => app.commands.executeCommandById(id, { leaf: l }) });
					const move = (dir: string, title: string) => ({ title, icon: 'move', run: () => { app.workspace.setActiveLeaf(l, { focus: false }); app.commands.executeCommandById(`app:move-tab-${dir}`); } });
					const r = row(sec, docket, l.getDisplayText() || 'New tab', () => { docket.close(); app.workspace.setActiveLeaf(l, { focus: true }); }, {
						icon: l.view.getIcon?.() ?? 'file', badge: l === app.workspace.activeLeaf ? 'current' : undefined,
						actions: () => [cmd('app:split-right', 'Split right'), cmd('app:split-down', 'Split down'), move('left', 'Move to the pane on the left'), move('right', 'Move to the pane on the right'), move('up', 'Move to the pane above'), move('down', 'Move to the pane below'), cmd('app:close-tab', 'Close')],
					});
					if (l === app.workspace.activeLeaf) r.addClass('is-focus');
				}
			}

			const arrange = section(el, 'Arrange');
			for (const id of ['app:split-right', 'app:split-down', 'app:focus-pane-right', 'app:move-tab-right', 'app:pane-wider', 'app:equalise-panes', 'app:zoom-pane', 'app:reopen-closed-tab', 'app:new-tab']) {
				const c = app.commands.findCommand(id);
				if (!c) continue;
				const available = app.commands.isAvailable(c);
				const r = row(arrange, docket, c.name, () => { if (!available) return; docket.close(); app.commands.executeCommand(c); }, { icon: c.icon ?? 'terminal', badge: keyOf(id) });
				if (!available) r.addClass('is-missing');
			}
		},
	};
}
