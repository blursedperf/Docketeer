/**
 * A row of buttons above the on-screen keyboard while a note is being edited (docs/mobile/PLAN.md, Phase 2): a link,
 * bold, a task, a heading, a footnote and an AGLC4 citation (when AGLC4 is on), the slash menu, undo, and a
 * button that puts the keyboard away. Each runs a command. The buttons never take the keyboard from the note.
 * Shown only while an on-screen keyboard is up (body.has-keyboard, layout-mode.ts): never on desktop.
 */
import { type App, setIcon } from '@quire/api';

interface ToolbarButton {
	/** For screen readers and the tooltip. */
	label: string;
	icon?: string;
	/** Shown instead of an icon. */
	text?: string;
	/** The command it runs (shown only when the command exists). */
	command?: string;
	run?: () => void;
}

export const TOOLBAR: ToolbarButton[] = [
	{ label: 'Link to a note', icon: 'link', command: 'editor:insert-wikilink' },
	{ label: 'Bold', icon: 'bold', command: 'editor:toggle-bold' },
	{ label: 'Make a task, or tick it off', icon: 'check-square', command: 'editor:toggle-task' },
	{ label: 'Heading level', icon: 'heading', command: 'editor:cycle-heading' },
	{ label: 'Footnote', icon: 'superscript', command: 'aglc-citations:insert-footnote' },
	{ label: 'Cite a kind of source (AGLC4)', icon: 'quote', command: 'aglc-citations:cite-kind-of-source' },
	{ label: 'Slash menu: insert anything', text: '/', command: 'editor:slash-menu' },
	{ label: 'Undo', icon: 'undo-2', command: 'editor:undo' },
	{ label: 'Put the keyboard away', icon: 'chevron-down', run: () => { (document.activeElement as HTMLElement | null)?.blur(); } },
];

/** True while the keyboard is in a note's text. */
function editingNote(): boolean {
	return !!document.activeElement?.closest('.cm-editor .cm-content');
}

export function registerKeyboardToolbar(app: App): HTMLElement | null {
	const container = document.querySelector<HTMLElement>('.app-container');
	if (!container) return null;
	const bar = createDiv({ cls: 'keyboard-toolbar', attr: { role: 'toolbar', 'aria-label': 'Formatting' } });
	container.insertBefore(bar, container.querySelector('.status-bar'));
	const buttons: [HTMLElement, ToolbarButton][] = [];
	for (const b of TOOLBAR) {
		const el = bar.createEl('button', { cls: 'keyboard-toolbar-button', attr: { type: 'button', 'aria-label': b.label, title: b.label } });
		if (b.icon) setIcon(el, b.icon);
		else el.setText(b.text ?? '');
		// Pressing a button must not take focus from the note, or the keyboard would go.
		for (const ev of ['pointerdown', 'mousedown'] as const) el.addEventListener(ev, (e) => e.preventDefault());
		el.addEventListener('click', () => {
			if (b.run) b.run();
			else if (b.command) app.commands.executeCommandById(b.command);
			// Not every blur sends focusout (a window without the system's focus): look again now.
			follow();
		});
		buttons.push([el, b]);
	}
	function follow() {
		const on = editingNote();
		document.body.classList.toggle('is-editing', on);
		if (on) fit();
	}
	// Buttons for commands that are not there (AGLC4 turned off) are left out.
	const fit = () => { for (const [el, b] of buttons) el.toggle(!b.command || !!app.commands.findCommand(b.command)); };
	document.addEventListener('focusin', follow);
	document.addEventListener('focusout', () => window.setTimeout(follow, 0));
	follow();
	return bar;
}
