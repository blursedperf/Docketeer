/**
 * Layout (Mod+6): the panes and tabs open now; Enter moves to one, → closes or splits it. Saved layouts
 * and presets (Brief + Source, Revision, Exam) come with tiling in Phase 5.
 */
import type { App, DocketPanel, WorkspaceLeaf } from '@quire/api';
import type { Docket } from '../docket';
import { row, section } from './common';

export function layoutPanel(app: App, docket: Docket): DocketPanel {
	return {
		id: 'core:layout', title: 'Layout', icon: 'layout-panel-left', order: 6, source: 'core',
		render: (el) => {
			const leaves: WorkspaceLeaf[] = [];
			app.workspace.iterateRootLeaves((l) => { leaves.push(l); });
			const panes = new Map<unknown, WorkspaceLeaf[]>();
			for (const l of leaves) { const list = panes.get(l.parent) ?? []; list.push(l); panes.set(l.parent, list); }
			let n = 0;
			for (const tabs of panes.values()) {
				const sec = section(el, `Pane ${++n}`, tabs.length);
				for (const l of tabs) {
					const cmd = (id: string, title: string) => ({ title, icon: app.commands.findCommand(id)?.icon, run: () => app.commands.executeCommandById(id, { leaf: l }) });
					const r = row(sec, docket, l.getDisplayText() || 'New tab', () => { docket.close(); app.workspace.setActiveLeaf(l, { focus: true }); }, {
						icon: l.view.getIcon?.() ?? 'file', badge: l === app.workspace.activeLeaf ? 'current' : undefined,
						actions: () => [cmd('app:split-right', 'Split right'), cmd('app:split-down', 'Split down'), cmd('app:close-tab', 'Close')],
					});
					if (l === app.workspace.activeLeaf) r.addClass('is-focus');
				}
			}
			const more = section(el, 'Arrange');
			for (const [id, label] of [['app:split-right', 'Split right'], ['app:split-down', 'Split down'], ['app:new-tab', 'New tab']] as const) {
				const c = app.commands.findCommand(id);
				if (c && app.commands.isAvailable(c)) row(more, docket, label, () => { docket.close(); app.commands.executeCommand(c); }, { icon: c.icon ?? 'terminal', detail: app.commands.hotkeysFor(c).length ? undefined : 'Shortcuts for moving between panes come with tiling (Phase 5)' });
			}
		},
	};
}
