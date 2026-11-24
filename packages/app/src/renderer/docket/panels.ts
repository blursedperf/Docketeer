/**
 * The core Docket panels, Mod+1 to Mod+6. Phase 2 gives the shell its panels; Outline already works,
 * the others say what they will hold (Phase 4) and offer what exists today, so nothing is a dead end.
 */
import { type App, type OpenWhere, MarkdownView, setIcon } from '@quire/api';
import type { Docket } from './docket';
import { openFileIn, plainHeading } from './providers';

/** A keyboard-reachable row: arrows move between them, Enter (and variants) or a click runs `run`. */
function item(parent: HTMLElement, title: string, detail: string | null, icon: string | null, run: (where: OpenWhere | 'insert') => unknown): HTMLElement {
	const el = parent.createEl('button', { cls: 'docket-item', attr: { type: 'button', 'data-docket-item': '' } });
	if (icon) setIcon(el.createSpan({ cls: 'docket-option-icon' }), icon);
	const text = el.createSpan({ cls: 'docket-option-text' });
	text.createSpan({ cls: 'docket-option-title', text: title });
	if (detail) text.createSpan({ cls: 'docket-option-detail', text: detail });
	el.addEventListener('click', () => run('current'));
	el.addEventListener('docket-choose', (e) => run((e as CustomEvent<OpenWhere | 'insert'>).detail));
	return el;
}

function coming(el: HTMLElement, what: string, today: [string, string][], app: App, docket: Docket): void {
	el.createEl('p', { cls: 'docket-note', text: what });
	if (!today.length) return;
	el.createDiv({ cls: 'docket-section-title', text: 'For now' });
	for (const [id, label] of today) {
		const cmd = app.commands.findCommand(id);
		if (!cmd || !app.commands.isAvailable(cmd)) continue;
		item(el, label, cmd.name, cmd.icon ?? 'terminal', () => { docket.close(); app.commands.executeCommand(cmd); });
	}
}

export function registerCorePanels(app: App, docket: Docket): () => void {
	const add = app.docket.addPanel.bind(app.docket);
	const removers = [
		add({
			id: 'core:authorities', title: 'Authorities', icon: 'scale', order: 1, source: 'core',
			render: (el, { focus }) => {
				if (focus) {
					const sel = el.createDiv({ cls: 'docket-selected' });
					sel.createSpan({ cls: 'docket-section-title', text: 'Under the cursor' });
					sel.createSpan({ cls: 'docket-selected-name', text: focus });
				}
				coming(el, 'Cases, legislation and secondary sources cited in this note, with every note that cites them.', [['app:show-backlinks', 'Notes linking here']], app, docket);
			},
		}),
		add({
			id: 'core:outline', title: 'Outline', icon: 'list-tree', order: 2, source: 'core',
			render: (el) => {
				const file = app.workspace.getActiveFile();
				const headings = file && !app.isLocked(file) ? app.metadataCache.getFileCache(file)?.headings ?? [] : [];
				if (!file) { el.createDiv({ cls: 'docket-empty', text: 'Open a note to see its outline.' }); return; }
				if (!headings.length) { el.createDiv({ cls: 'docket-empty', text: 'This note has no headings.' }); return; }
				const list = el.createDiv({ cls: 'docket-outline', attr: { role: 'list', 'aria-label': `Outline of ${file.basename}` } });
				for (const h of headings) {
					const row = item(list, plainHeading(h.heading), null, null, (where) => {
						if (where === 'insert') return;
						docket.close();
						const view = app.workspace.getActiveViewOfType(MarkdownView);
						if (where === 'current' && view?.file === file && view.getMode() === 'source') {
							const line = h.position.start.line;
							view.editor.setCursor({ line, ch: 0 });
							view.editor.scrollIntoView({ from: { line, ch: 0 }, to: { line, ch: 0 } }, true);
							view.editor.focus();
						} else void openFileIn(app, file, where, `#${h.heading}`);
					});
					row.setAttribute('role', 'listitem');
					row.style.setProperty('--outline-level', String(h.level - 1));
					row.addClass('docket-outline-item');
				}
			},
		}),
		add({
			id: 'core:units', title: 'Units', icon: 'folders', order: 3, source: 'core',
			render: (el) => coming(el, 'Subjects (top folders), their topics (folders inside) and notes, with recent and pinned notes.', [
				['app:quick-switcher', 'Find a note'], ['app:new-note', 'New note'], ['app:new-folder', 'New folder'], ['app:reveal-file', 'Show this note in Files'],
			], app, docket),
		}),
		add({
			id: 'core:cite', title: 'Cite', icon: 'quote', order: 4, source: 'core',
			render: (el) => coming(el, 'Build AGLC citations and footnotes; Ibid and (n X) are handled for you.', [
				['aglc-citations:insert-footnote', 'Insert a footnote'], ['aglc-citations:cite-kind-of-source', 'Cite a kind of source'],
				['aglc-citations:show-issues', 'List citation problems'], ['aglc-citations:insert-bibliography', 'Insert a bibliography'],
			], app, docket),
		}),
		add({
			id: 'core:homebase', title: 'Homebase', icon: 'house', order: 5, source: 'core',
			render: (el) => {
				el.createDiv({ cls: 'docket-selected' }).createSpan({ cls: 'docket-selected-name', text: app.vault.getName() });
				coming(el, 'Lock status and locking come with the locking phase. Export with confirmation and redaction.', [
					['app:open-homebase', 'Open another homebase'], ['app:open-settings', 'Settings'],
				], app, docket);
			},
		}),
		add({
			id: 'core:layout', title: 'Layout', icon: 'layout-panel-left', order: 6, source: 'core',
			render: (el) => coming(el, 'Layout presets (Brief + Source, Revision, Exam) and moving between panes.', [
				['app:split-right', 'Split right'], ['app:split-down', 'Split down'], ['app:new-tab', 'New tab'], ['app:close-tab', 'Close tab'],
			], app, docket),
		}),
	];
	return () => { for (const r of removers) r(); };
}
