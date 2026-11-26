/** Pieces the Docket panels share: keyboard-reachable rows, section titles, and the note being worked on. */
import { type App, MarkdownView, type OpenWhere, type TFile, setIcon } from '@quire/api';
import type { EditorView } from '@codemirror/view';
import type { ActionItem, Docket } from '../docket';

export type Where = OpenWhere | 'insert';

export interface RowOptions {
	detail?: string | null;
	icon?: string | null;
	/** Shown after the title: "unconfirmed", "3×". */
	badge?: string;
	italic?: boolean;
	/** Indent, in levels. */
	level?: number;
	/** Actions for → or Mod+. */
	actions?: () => ActionItem[];
	cls?: string;
	/** The row's full name for screen readers and its tooltip, when the title leans on its indent ("New note in Torts"). */
	label?: string;
}

/** A row: arrows move between rows, Enter (and Mod/Alt/Shift+Enter) or a click runs it, → its actions. */
export function row(parent: HTMLElement, docket: Docket, title: string, run: (where: Where) => unknown, o: RowOptions = {}): HTMLElement {
	const el = parent.createEl('button', { cls: `docket-item${o.cls ? ` ${o.cls}` : ''}`, attr: { type: 'button', 'data-docket-item': '' } });
	if (o.level) el.style.setProperty('--outline-level', String(o.level));
	// A fuller name for screen readers and the tooltip, when the shown one leans on the row's place (its indent).
	if (o.label) { el.setAttribute('aria-label', o.label); el.title = o.label; }
	if (o.icon) setIcon(el.createSpan({ cls: 'docket-option-icon' }), o.icon);
	const text = el.createSpan({ cls: 'docket-option-text' });
	const t = text.createSpan({ cls: 'docket-option-title', text: title });
	if (o.italic) t.addClass('is-italic');
	if (o.detail) text.createSpan({ cls: 'docket-option-detail', text: o.detail });
	if (o.badge) el.createSpan({ cls: 'docket-badge', text: o.badge });
	el.addEventListener('click', () => run('current'));
	el.addEventListener('docket-choose', (e) => run((e as CustomEvent<Where>).detail));
	// Right-click: the row's actions as a menu; a file's row (data-path) offers opening it first.
	el.addEventListener('contextmenu', (e) => {
		const items: ActionItem[] = [];
		const file = el.dataset.path ? docket.app.vault.getFileByPath(el.dataset.path) : null;
		if (file) {
			items.push({ title: 'Open', icon: 'arrow-right', run: () => run('current') });
			items.push({ title: 'Open to the right', icon: 'separator-vertical', run: () => run('right') });
			items.push({ title: 'Open below', icon: 'separator-horizontal', run: () => run('below') });
		}
		const more = o.actions?.() ?? [];
		items.push(...more.filter((a) => !(file && /^Open( to the right| below)?$/.test(a.title))));
		el.focus();
		docket.showMenu(e, items);
	});
	if (o.actions) {
		el.dataset.docketActions = '';
		el.setAttribute('aria-description', 'More actions: right arrow');
		el.addEventListener('docket-actions', () => docket.showActionList(title, o.actions!()));
	}
	return el;
}

/** A titled section of a panel: the title and its rows share a box, so the title stays in view while its rows scroll. */
export function section(parent: HTMLElement, title: string, count?: number): HTMLElement {
	const wrap = parent.createDiv({ cls: 'docket-section-wrap' });
	const head = wrap.createDiv({ cls: 'docket-section-title' });
	head.createSpan({ text: title });
	if (count !== undefined) head.createSpan({ cls: 'docket-group-more', text: String(count) });
	return wrap.createDiv({ cls: 'docket-section', attr: { role: 'group', 'aria-label': title } });
}

export function empty(parent: HTMLElement, text: string): void {
	parent.createDiv({ cls: 'docket-empty', text });
}

/** The note the Docket was opened over: its file, its editor (in editing view) and its current text. */
export async function currentNote(app: App, docket: Docket): Promise<{ file: TFile; text: string; cm: EditorView | null } | null> {
	const file = app.workspace.getActiveFile();
	if (!file || file.extension !== 'md') return null;
	const view = app.workspace.getActiveViewOfType(MarkdownView);
	const cm = view?.file === file && view.getMode() === 'source' ? docket.targetEditor ?? view.editor.cm : null;
	const text = cm ? cm.state.doc.toString() : await app.vault.cachedRead(file);
	return { file, text, cm };
}

/** Put the cursor on a range in the editor and give it the keyboard. */
export function jumpTo(cm: EditorView, from: number, to = from): void {
	cm.dispatch({ selection: { anchor: from, head: to }, scrollIntoView: true });
	cm.focus();
}
