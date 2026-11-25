/**
 * The app's own features, built on the same API plugins use: core commands, settings pages, the mode
 * badge and word count. Search, navigation and panels are the Docket's (./docket).
 */
import { EditorSelection } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { Vim } from '@replit/codemirror-vim';
import {
	type App, type AppConfig, type Command, type CommandContext, TAbstractFile, WorkspaceLeaf, FuzzySuggestModal, type FuzzyMatch, MarkdownView, Notice, type Palette, Setting, SettingTab,
	SuggestModal, TFile, TFolder, formatHotkey, fuzzyScore, getIconPacks, physicalKey, setIcon, type Hotkey, type Modifier, Platform, Modal, SPELL_LANGUAGES, type Menu, type TableOp, tableHere, tableOp,
} from '@quire/api';
import { registerDocket } from './docket';
import { registerTiling } from './tiling';
import { registerMedia } from './media';
import { registerPdf } from './pdf/view';
import { registerHomebases } from './homebases';
import { SlashSuggest } from './slash';
import { unitsStore } from './units-store';
import { registerLocking } from './locking';
import { NameModal, NewNoteModal, createNote, freePath, notePlaces, promptRename } from './dialogs';
import { LinkSuggest } from './link-suggest';

/** Pick a folder (for "Move file"). */
class FolderPicker extends FuzzySuggestModal<TFolder> {
	constructor(app: App, private onChoose: (f: TFolder) => void) {
		super(app);
		this.setPlaceholder('Move to folder…');
	}
	getItems(): TFolder[] { return this.app.vault.getAllFolders(true); }
	getItemText(f: TFolder): string { return f.isRoot() ? '/' : f.path; }
	onChooseItem(f: TFolder): void { this.onChoose(f); }
	override renderSuggestion(m: FuzzyMatch<TFolder>, el: HTMLElement): void { el.setText(this.getItemText(m.item)); }
}

// -------------------------------------------------------------------------------------------------
// Settings pages

class EditorTab extends SettingTab {
	override id = 'editor';
	override name = 'Editor';
	display(): void {
		const el = this.containerEl;
		const c = this.app.config;
		new Setting(el).setName('Editor').setHeading();
		new Setting(el).setName('Readable line length').setDesc('Limit the width of the text so lines are easy to read.')
			.addToggle((t) => t.setValue(c.readableLineLength).onChange((v) => { void this.app.setConfig('readableLineLength', v); }));
		new Setting(el).setName('Live preview').setDesc('Show Markdown formatted as you write: headings without #, bold without **, links as their text, bullets and task boxes. The lines you are editing show the Markdown as written. Off: the Markdown is always shown as written (source mode).')
			.addToggle((t) => t.setValue(c.livePreview).onChange((v) => { void this.app.setConfig('livePreview', v); }));
		new Setting(el).setName('Note name as title').setDesc('Show each note\'s name as a title above its text. Editing it (then Enter, or moving away) renames the note; links to it follow. It is not part of the note\'s text.')
			.addToggle((t) => t.setValue(c.inlineTitle !== false).onChange((v) => { void this.app.setConfig('inlineTitle', v); }));
		new Setting(el).setName('Vim key bindings').setDesc('Edit with Vim keys: normal, insert and visual modes, motions, operators, :w to save and :q to close the tab. The modeline shows the mode.')
			.addToggle((t) => t.setValue(c.vimMode).onChange((v) => { void this.app.setConfig('vimMode', v); }));
		new Setting(el).setName('Auto-pair brackets').setDesc('Type the closing bracket or quote with the opening one.')
			.addToggle((t) => t.setValue(c.autoPairBrackets).onChange((v) => { void this.app.setConfig('autoPairBrackets', v); }));
		new Setting(el).setName('Spelling').setHeading();
		new Setting(el).setName('Check spelling').setDesc('Mark misspelled words as you write; right-click one for suggestions, to add it to your dictionary, or to ignore it. The dictionaries ship with Quire and checking happens on this computer.')
			.addToggle((t) => t.setValue(c.spellcheck).onChange((v) => { void this.app.setConfig('spellcheck', v); }));
		new Setting(el).setName('Language')
			.addDropdown((d) => d.addOptions(SPELL_LANGUAGES).setValue(c.spellcheckLanguage).onChange((v) => { void this.app.setConfig('spellcheckLanguage', v); }));
		new Setting(el).setName('Legal terms').setDesc('Accept Latin legal terms (obiter, ratio decidendi, certiorari …), AGLC abbreviations (eg, ie, cf, ibid, sch, reg) and legal words general dictionaries lack (extinguishment, justiciable, estoppel …).')
			.addToggle((t) => t.setValue(c.spellcheckLegal).onChange((v) => { void this.app.setConfig('spellcheckLegal', v); }));
		new Setting(el).setName('Skip names').setDesc('Do not mark capitalised words in the middle of a sentence (parties, judges, places). Words that start a sentence are still checked, and names in your notes\' titles and in the authorities you cite are always accepted.')
			.addToggle((t) => t.setValue(c.spellcheckNames).onChange((v) => { void this.app.setConfig('spellcheckNames', v); }));
		new Setting(el).setName('Check footnotes').setDesc('Also check footnotes. Off by default: citations (case names, report series, abbreviations) would be marked throughout.')
			.addToggle((t) => t.setValue(c.spellcheckFootnotes).onChange((v) => { void this.app.setConfig('spellcheckFootnotes', v); }));
		const words = this.app.spellchecker.personalWords();
		new Setting(el).setName('Your dictionary').setDesc(`Words you added, one per line (${words.length}). Saved in this homebase (.quire/dictionary.txt).`)
			.addTextArea((t) => {
				t.setValue(words.join('\n'));
				t.inputEl.rows = 5;
				t.inputEl.addEventListener('change', () => { void this.app.spellchecker.setPersonalWords(t.getValue().split(/\r?\n/)); });
			});
	}
}

class FilesTab extends SettingTab {
	override id = 'files';
	override name = 'Files and links';
	display(): void {
		const el = this.containerEl;
		const c = this.app.config;
		new Setting(el).setName('Files and links').setHeading();
		new Setting(el).setName('Open notes from the Docket in a new tab').setDesc('A note chosen in the Docket opens in a new tab (or the tab already showing it), so the note you were in stays where it is. Off: it replaces the note in the tab in use. Back (Alt+←, ⌘[ on a Mac) returns to what a tab showed before either way.')
			.addToggle((t) => t.setValue(c.docketNewTab !== false).onChange((v) => { void this.app.setConfig('docketNewTab', v); }));
		new Setting(el).setName('Default location for new notes')
			.addDropdown((d) => d.addOptions({ root: 'Top of the homebase', current: 'Folder of the open note', folder: 'A folder I choose' })
				.setValue(c.newFileLocation).onChange((v) => { void this.app.setConfig('newFileLocation', v as typeof c.newFileLocation); this.display(); }));
		if (c.newFileLocation === 'folder') {
			new Setting(el).setName('Folder for new notes')
				.addText((t) => t.setPlaceholder('Notes').setValue(c.newFileFolderPath).onChange((v) => { void this.app.setConfig('newFileFolderPath', v.trim().replace(/^\/+|\/+$/g, '')); }));
		}
		new Setting(el).setName('Folder for attachments').setDesc('Where pasted and dropped files go. A folder from the homebase root (eg attachments), ./ for the same folder as the note, or ./name for a folder beside the note.')
			.addText((t) => t.setPlaceholder('attachments').setValue(c.attachmentFolder).onChange((v) => { void this.app.setConfig('attachmentFolder', v.trim() || 'attachments'); }));
		new Setting(el).setName('Update links when renaming').setDesc('When a note is renamed, change [[links]] to it in other notes.')
			.addToggle((t) => t.setValue(c.alwaysUpdateLinks).onChange((v) => { void this.app.setConfig('alwaysUpdateLinks', v); }));
	}
	override hide(): void { this.containerEl.empty(); }
}

/** A row of colour chips showing a palette. */
function swatch(parent: HTMLElement, palette: Palette | null) {
	const row = parent.createDiv({ cls: 'palette-swatch' });
	if (!palette) return;
	for (const k of ['doom-bg', 'doom-base2', 'doom-fg', 'doom-blue', 'doom-magenta', 'doom-violet', 'doom-orange', 'doom-green', 'doom-teal', 'doom-red', 'doom-yellow']) {
		const chip = row.createSpan({ cls: 'palette-chip', attr: { title: `--${k}` } });
		chip.setCssStyles({ background: palette.vars[k] ?? 'transparent' });
	}
}

const ICON_PREVIEW = ['file-text', 'folder-open', 'search', 'history', 'book-open', 'settings', 'square-pen', 'trash-2', 'terminal', 'zoom-in'];

class AppearanceTab extends SettingTab {
	override id = 'appearance';
	override name = 'Appearance';
	/** Fonts being typed (Other…) rather than chosen from the list. */
	private typingFonts = new Set<string>();
	display(): void {
		const el = this.containerEl;
		el.empty();
		const app = this.app;
		const c = app.config;
		const css = app.customCss;
		const set = <K extends keyof AppConfig>(k: K, v: AppConfig[K], redraw = false) => { void app.setConfig(k, v).then(() => { if (redraw) this.display(); }); };

		new Setting(el).setName('Colours').setHeading();
		new Setting(el).setName('Mode').setDesc('Light or dark, or follow the system setting.')
			.addDropdown((d) => d.addOptions({ system: 'Follow the system', light: 'Light', dark: 'Dark' }).setValue(c.theme)
				.onChange((v) => set('theme', v as AppConfig['theme'])));
		for (const mode of ['dark', 'light'] as const) {
			const key = mode === 'dark' ? 'darkPalette' : 'lightPalette';
			const palettes = css.getPalettes(mode);
			const s = new Setting(el).setName(mode === 'dark' ? 'Dark palette' : 'Light palette')
				.setDesc(mode === 'dark' ? 'Colours in dark mode. From the DoomEsque theme (after Doom Emacs themes).' : 'Colours in light mode.')
				.addDropdown((d) => {
					for (const p of palettes) d.addOption(p.id, p.name);
					d.setValue(String(c[key])).onChange((v) => set(key, v, true));
				});
			swatch(s.descEl, css.getPalette(String(c[key])));
		}
		const accent = new Setting(el).setName('Accent colour')
			.setDesc(c.accentColor ? `Custom: ${c.accentColor}. Links, the active tab, selections and buttons use it.` : 'The palette\'s own (its blue). Pick a colour to use your own everywhere the accent shows.')
			.addColorPicker((p) => p.setValue(c.accentColor || (css.getPalette(String(css.isDark() ? c.darkPalette : c.lightPalette))?.vars['doom-blue'] ?? '#60a5fa'))
				.onChange((v) => set('accentColor', v)));
		if (c.accentColor) accent.addExtraButton((b) => b.setIcon('rotate-ccw').setTooltip('Use the palette\'s accent').onClick(() => set('accentColor', '', true)));

		new Setting(el).setName('Type and spacing').setHeading();
		/**
		 * A font: chosen from the fonts installed on this computer (monospaced ones first for the monospace font), or
		 * typed (Other…). A line of sample text shows it.
		 */
		const OTHER = '\u0000other';
		const font = (name: string, desc: string, key: 'interfaceFont' | 'textFont' | 'monospaceFont', empty: string, mono: boolean) => {
			const row = new Setting(el).setName(name).setDesc(desc).setClass('mod-font');
			const sample = row.descEl.createDiv({ cls: 'setting-font-sample', text: mono ? 'const ratio = 0.5; // [1932] AC 562' : 'Donoghue v Stevenson [1932] AC 562: the neighbour principle.' });
			const show = (v: string) => { sample.style.fontFamily = v ? `"${v.replace(/"/g, '')}", ${mono ? 'monospace' : 'sans-serif'}` : ''; };
			const typing = this.typingFonts.has(key);
			row.addDropdown((d) => {
				const sel = d.selectEl;
				const fill = (fonts: { family: string; mono: boolean }[]) => {
					const current = String(c[key] ?? '');
					sel.empty();
					sel.createEl('option', { value: '', text: empty });
					const group = (label: string, list: { family: string }[]) => {
						if (!list.length) return;
						const g = sel.createEl('optgroup', { attr: { label } });
						for (const f of list) g.createEl('option', { value: f.family, text: f.family });
					};
					if (mono) { group('Monospaced', fonts.filter((f) => f.mono)); group('Other fonts', fonts.filter((f) => !f.mono)); } else group('Installed fonts', fonts);
					if (current && !fonts.some((f) => f.family === current)) sel.createEl('option', { value: current, text: fonts.length ? `${current} (typed; not found)` : current });
					sel.createEl('option', { value: OTHER, text: 'Other… (type a name)' });
					sel.value = current;
					show(current);
				};
				fill([]);
				void this.app.host.app.fonts?.().then(fill).catch(() => undefined);
				d.onChange((v) => {
					if (v === OTHER) { this.typingFonts.add(key); this.display(); return; }
					show(v);
					void set(key, v);
				});
				if (typing) sel.hide();
			});
			if (typing) {
				row.addText((t) => {
					t.setPlaceholder('Font name, as installed').setValue(String(c[key] ?? '')).onChange((v) => { show(v.trim()); void set(key, v.trim()); });
					window.setTimeout(() => t.inputEl.focus(), 0);
				});
				row.addExtraButton((b) => b.setIcon('list').setTooltip('Choose from the installed fonts').onClick(() => { this.typingFonts.delete(key); this.display(); }));
			}
		};
		font('Interface font', 'Menus, tabs, settings.', 'interfaceFont', 'System default', false);
		font('Text font', 'The text of notes.', 'textFont', 'Same as the interface', false);
		font('Monospace font', 'Code, the file tree, tabs and the status bar.', 'monospaceFont', 'Default (a coding font installed here)', true);
		new Setting(el).setName('Text size').setDesc('Size of the text in notes, in pixels.')
			.addSlider((s) => s.setLimits(10, 30, 1).setValue(c.fontSize).onChange((v) => set('fontSize', v)));
		new Setting(el).setName('Density').setDesc('How much space the interface leaves around rows, tabs and controls.')
			.addDropdown((d) => d.addOptions({ compact: 'Compact', comfortable: 'Comfortable', spacious: 'Spacious' }).setValue(c.density)
				.onChange((v) => set('density', v as AppConfig['density'])));

		new Setting(el).setName('Docket').setHeading();
		new Setting(el).setName('Mode')
			.setDesc('Peek: over the note, closing when you are done. Pinned: docked above the note. Mod+Shift+P switches.')
			.addDropdown((d) => d.addOption('peek', 'Peek').addOption('pinned', 'Pinned').setValue(c.docketMode === 'pinned' ? 'pinned' : 'peek').onChange((v) => { void this.app.setConfig('docketMode', v as 'peek' | 'pinned'); }));
		new Setting(el).setName('Icons').setHeading();
		const packs = getIconPacks();
		const pack = packs.find((p) => p.id === c.iconSet) ?? packs[0]!;
		const iconRow = new Setting(el).setName('Icon set')
			.setDesc('Phosphor is the default. Plugins name icons the Lucide way; an icon the set does not have is drawn from Lucide.')
			.addDropdown((d) => {
				for (const p of packs) d.addOption(p.id, p.name);
				d.setValue(pack.id).onChange((v) => set('iconSet', v, true));
			});
		if (pack.weights.length > 1) {
			iconRow.addDropdown((d) => {
				for (const w of pack.weights) d.addOption(w, w[0]!.toUpperCase() + w.slice(1));
				d.setValue(pack.weights.includes(c.iconWeight) ? c.iconWeight : pack.weights[0]!).onChange((v) => set('iconWeight', v));
			});
		}
		const preview = iconRow.descEl.createDiv({ cls: 'icon-preview' });
		for (const n of ICON_PREVIEW) setIcon(preview.createSpan({ cls: 'icon-preview-item', attr: { title: n } }), n);

		new Setting(el).setName('Themes').setHeading();
		const themeRow = new Setting(el).setName('CSS theme')
			.setDesc(`A theme is a folder in ${css.themesFolder}/ with a theme.css, loaded over the palettes above. Themes cannot load anything from outside the app.`)
			.addDropdown((d) => {
				d.addOption('', css.themes.length ? 'None' : 'None installed');
				for (const t of css.themes) d.addOption(t, t);
				d.setValue(css.themes.includes(c.cssTheme) ? c.cssTheme : '').onChange((v) => { void css.setTheme(v).then(() => this.display()); });
			});
		const refusedTheme = c.cssTheme ? css.refusal('theme', c.cssTheme) : null;
		if (refusedTheme) themeRow.descEl.createDiv({ cls: 'mod-warning', text: `Not loaded: it uses ${refusedTheme.join(', ')}.` });
		new Setting(el).setName('Make your own theme').setDesc('Creates a starter theme.css, with the colour tokens explained, and selects it.')
			.addButton((b) => b.setButtonText('Create theme').onClick(async () => {
				const name = await css.createThemeTemplate();
				await css.setTheme(name);
				new Notice(`Created ${css.themesFolder}/${name}/theme.css. Edit it, then press Reload.`);
				this.display();
			}))
			.addButton((b) => b.setButtonText('Show folder').onClick(async () => {
				await app.vault.adapter.mkdir(css.themesFolder);
				await app.host.app.showItemInFolder(css.themesFolder);
			}));

		new Setting(el).setName('CSS snippets').setDesc(`Small stylesheets in ${css.snippetsFolder}/, each turned on or off here.`)
			.setHeading();
		if (css.snippets.length === 0) el.createDiv({ cls: 'setting-item-description setting-note', text: 'No snippets yet. Add a .css file to the folder, then press Reload.' });
		for (const name of css.snippets) {
			const row = new Setting(el).setName(name)
				.addToggle((t) => t.setValue(css.enabledSnippets().includes(name)).onChange((v) => { void css.setSnippetEnabled(name, v).then(() => this.display()); }));
			const refused = css.refusal('snippet', name);
			if (refused) row.setDesc(`Not loaded: it uses ${refused.join(', ')}.`).descEl.addClass('mod-warning');
		}
		new Setting(el).setName('Snippets folder').setDesc(css.snippetsFolder)
			.addButton((b) => b.setButtonText('Show folder').onClick(async () => {
				await app.vault.adapter.mkdir(css.snippetsFolder);
				await app.host.app.showItemInFolder(css.snippetsFolder);
			}))
			.addButton((b) => b.setButtonText('Reload').setTooltip('Read the themes and snippets again').onClick(async () => {
				await css.load();
				this.display();
				new Notice('Themes and snippets reloaded.');
			}));
	}
}

/** A hotkey from a key press: Mod is Ctrl (Cmd on macOS). */
function hotkeyFromEvent(e: KeyboardEvent): Hotkey | null {
	if (['Control', 'Shift', 'Alt', 'Meta', 'AltGraph', 'CapsLock'].includes(e.key)) return null;
	const modifiers: Modifier[] = [];
	if (Platform.isMacOS ? e.metaKey : e.ctrlKey) modifiers.push('Mod');
	if (Platform.isMacOS ? e.ctrlKey : e.metaKey) modifiers.push(Platform.isMacOS ? 'Ctrl' : 'Meta');
	if (e.altKey) modifiers.push('Alt');
	if (e.shiftKey) modifiers.push('Shift');
	const pressed = physicalKey(e);
	const key = pressed.length === 1 ? pressed.toLowerCase() : pressed;
	// Plain typing keys need a modifier; function keys and the like may stand alone.
	if (modifiers.length === 0 && !/^F\d{1,2}$|^(Insert|Delete|Home|End|PageUp|PageDown)$/.test(key)) return null;
	return { modifiers, key };
}

/** Turn `btn` into "Press keys…" until a hotkey is pressed (`done` gets it) or Esc or a click away cancels. */
function recordHotkey(btn: HTMLElement, done: (h: Hotkey) => unknown, cancelled: () => void): void {
	btn.addClass('is-recording-hotkey');
	btn.empty();
	btn.setText('Press keys…');
	btn.setAttr('tabindex', '0');
	btn.focus();
	const stop = () => { btn.removeEventListener('keydown', onKey, true); btn.removeEventListener('blur', cancel); };
	const cancel = () => { stop(); cancelled(); };
	const onKey = (e: KeyboardEvent) => {
		e.preventDefault();
		e.stopPropagation();
		if (e.key === 'Escape') { cancel(); return; }
		const h = hotkeyFromEvent(e);
		if (!h) return;
		stop();
		void done(h);
	};
	btn.addEventListener('keydown', onKey, true);
	btn.addEventListener('blur', cancel);
}

/**
 * Why `h` cannot be the Docket key, or null. It is the way into everything, so it must not type text
 * (it needs Ctrl, ⌘ or Alt, or a function key) and must not be one the system keeps for itself.
 */
export function docketKeyProblem(app: App, h: Hotkey): string | null {
	const typing = !h.modifiers.some((m) => m === 'Mod' || m === 'Ctrl' || m === 'Meta' || m === 'Alt') && !/^F\d{1,2}$/.test(h.key);
	if (typing) return `${formatHotkey(h)} types text: hold ${Platform.isMacOS ? '⌘, ⌃ or ⌥' : 'Ctrl or Alt'} with it, or use a function key.`;
	const sys = app.commands.reservedFor(h);
	if (sys) return `${formatHotkey(h)} is the system's "${sys}".`;
	return null;
}

/** Change the Docket key for every homebase. A homebase's own choice for it (in the list below) is dropped. */
export async function setDocketKey(app: App, h: Hotkey | null): Promise<void> {
	if (app.commands.isCustomised('app:docket')) await app.commands.setHotkeys('app:docket', null);
	await app.commands.setAppHotkeys('app:docket', h ? [h] : null);
}

class HotkeysTab extends SettingTab {
	override id = 'hotkeys';
	override name = 'Hotkeys';
	private filter = '';

	display(): void {
		const el = this.containerEl;
		el.empty();
		new Setting(el).setName('Hotkeys').setHeading();
		this.renderDocketKey(el.createDiv());
		new Setting(el).setName('Find a command').setDesc('Click + and press the keys to add a hotkey; × removes one; the arrow goes back to the default. Saved in this homebase (.quire/hotkeys.json).')
			.addSearch((s) => {
				s.setPlaceholder('Filter commands…').setValue(this.filter).onChange((v) => { this.filter = v; this.renderList(list); });
				window.setTimeout(() => s.inputEl.focus(), 0);
			});
		const list = el.createDiv({ cls: 'hotkey-list' });
		this.renderList(list);
	}

	/** The Docket key, first: it is the way into everything, and it is the same in every homebase. */
	private renderDocketKey(box: HTMLElement): void {
		box.empty();
		const cmds = this.app.commands;
		const cmd = cmds.findCommand('app:docket');
		if (!cmd) return;
		const keys = cmds.hotkeysFor(cmd);
		const row = new Setting(box).setName('Docket key').setClass('mod-hotkeys').setClass('mod-docket-key');
		const clashes = keys.flatMap((k) => cmds.conflicts(k, cmd.id).map((c) => `${formatHotkey(k)} also runs "${c.name}"`));
		row.setDesc(clashes.length ? clashes.join('; ') : 'Opens and closes the Docket, in every homebase.');
		if (clashes.length) row.descEl.addClass('mod-warning');
		for (const k of keys) row.controlEl.createSpan({ cls: 'hotkey-pill', text: formatHotkey(k) });
		if (keys.length === 0) row.controlEl.createSpan({ cls: 'hotkey-none', text: 'Blank' });
		if (cmds.isAppCustomised(cmd.id) || cmds.isCustomised(cmd.id)) {
			row.addExtraButton((b) => b.setIcon('rotate-ccw').setTooltip(`Back to ${formatHotkey({ modifiers: ['Mod'], key: 'p' })}`).onClick(async () => {
				await setDocketKey(this.app, null);
				this.display();
			}));
		}
		row.addButton((b) => {
			b.setButtonText('Change…');
			b.onClick(() => recordHotkey(b.buttonEl, async (h) => {
				const problem = docketKeyProblem(this.app, h);
				if (problem) new Notice(problem);
				else await setDocketKey(this.app, h);
				this.display();
			}, () => this.display()));
		});
	}

	private renderList(list: HTMLElement): void {
		list.empty();
		const cmds = this.app.commands;
		const words = this.filter.toLowerCase().split(/\s+/).filter(Boolean);
		const all = cmds.listCommands().filter((c) => { const hay = [c.name, c.section ?? '', ...(c.aliases ?? []), ...(c.keywords ?? [])].join(' ').toLowerCase(); return words.every((w) => hay.includes(w)); }).sort((a, b) => a.name.localeCompare(b.name));
		if (all.length === 0) list.createDiv({ cls: 'setting-note', text: 'No commands match.' });
		for (const cmd of all) {
			const row = new Setting(list).setName(cmd.name).setClass('mod-hotkeys');
			const keys = cmds.hotkeysFor(cmd);
			const clashes = keys.flatMap((k) => {
				const sys = cmds.reservedFor(k);
				return [...cmds.conflicts(k, cmd.id).map((c) => `${formatHotkey(k)} also runs "${c.name}"`), ...(sys ? [`${formatHotkey(k)} is the system's "${sys}"`] : [])];
			});
			if (clashes.length) row.setDesc(clashes.join('; ')).descEl.addClass('mod-warning');
			for (const [i, k] of keys.entries()) {
				const pill = row.controlEl.createSpan({ cls: 'hotkey-pill', text: formatHotkey(k) });
				const x = pill.createSpan({ cls: 'hotkey-pill-remove', attr: { 'aria-label': 'Remove', role: 'button', tabindex: '0' } });
				setIcon(x, 'x');
				x.addEventListener('click', async () => { await cmds.setHotkeys(cmd.id, keys.filter((_, j) => j !== i)); this.renderList(list); });
			}
			if (keys.length === 0) row.controlEl.createSpan({ cls: 'hotkey-none', text: 'Blank' });
			if (cmds.isCustomised(cmd.id)) {
				row.addExtraButton((b) => b.setIcon('rotate-ccw').setTooltip('Back to the default').onClick(async () => { await cmds.setHotkeys(cmd.id, null); this.renderList(list); }));
			}
			row.addExtraButton((b) => {
				b.setIcon('plus').setTooltip('Add a hotkey');
				const btn = b.extraSettingsEl;
				btn.setAttr('tabindex', '0');
				b.onClick(() => recordHotkey(btn, async (h) => {
					await cmds.setHotkeys(cmd.id, [...keys, h]);
					this.renderList(list);
				}, () => this.renderList(list)));
			});
		}
	}
}

class PluginsTab extends SettingTab {
	override id = 'plugins';
	override name = 'Plugins';
	display(): void {
		const el = this.containerEl;
		el.empty();
		new Setting(el).setName('Plugins').setHeading();
		el.createEl('p', {
			cls: 'setting-item-description',
			text: `Plugins run inside Quire with the same offline protections as the app: they cannot reach the network. To add a plugin, put its folder (manifest.json, main.js, styles.css) in ${this.app.vault.configDir}/plugins/ in this homebase, then reopen this page.`,
		});
		const pm = this.app.plugins;
		const ids = Object.keys(pm.manifests).sort((a, b) => pm.manifests[a]!.name.localeCompare(pm.manifests[b]!.name));
		if (ids.length === 0) el.createEl('p', { text: 'No plugins found.' });
		for (const id of ids) {
			const m = pm.manifests[id]!;
			const s = new Setting(el).setName(`${m.name}`)
				.setDesc(`${m.version}${m.author ? ` · by ${m.author}` : ''} · ${pm.source(id) === 'builtin' ? 'built in' : 'in this homebase'}${m.description ? `\n${m.description}` : ''}`);
			s.descEl.addClass('mod-pre-wrap');
			const err = pm.loadError(id);
			if (err) s.descEl.createDiv({ cls: 'mod-warning', text: `Failed to load: ${err}` });
			if (pm.enabledPlugins.has(id) && this.app.setting.pluginTabs.some((t) => t.id === id)) {
				s.addExtraButton((b) => b.setIcon('settings').setTooltip('Options').onClick(() => this.app.setting.openTabById(id)));
			}
			s.addToggle((t) => t.setValue(pm.enabledPlugins.has(id)).onChange(async (on) => {
				if (on) await pm.enablePluginAndSave(id);
				else await pm.disablePluginAndSave(id);
				this.display();
			}));
		}
		new Setting(el).setName('Plugins folder').setDesc(`${this.app.vault.configDir}/plugins`)
			.addButton((b) => b.setButtonText('Reload list').onClick(async () => { await pm.loadManifests(); this.display(); }));
	}
}

class AboutTab extends SettingTab {
	override id = 'about';
	override name = 'About';
	display(): void {
		const el = this.containerEl;
		new Setting(el).setName('Quire').setHeading();
		new Setting(el).setName('Version').setDesc(this.app.host.appVersion);
		new Setting(el).setName('Homebase').setDesc(this.app.host.vault?.path ?? '');
		new Setting(el).setName('Offline').setDesc('Quire makes no network requests. Every request from the app or a plugin is blocked by the app itself, and there are no updates, accounts, telemetry or crash reports.');
		new Setting(el).setName('Developer tools').setDesc('F12 or Ctrl+Shift+I opens the developer tools, for plugin authors.');
		new Setting(el).setName('Licences').setDesc('Quire is MIT-licensed. It includes libraries, icons and spelling dictionaries under their own licences.')
			.addButton((b) => b.setButtonText('Show licences').onClick(() => { void showNotices(this.app); }));
	}
}

/** The third-party licence notices shipped with the app. */
async function showNotices(app: App): Promise<void> {
	const text = await app.host.app.notices();
	const modal = new Modal(app);
	modal.setTitle('Licences');
	modal.modalEl.addClass('mod-notices');
	modal.contentEl.createEl('pre', { cls: 'notices-text', text: text || 'The licence notices were not found in this build.' });
	modal.open();
}

// -------------------------------------------------------------------------------------------------
// Word count in the status bar

/** The modeline badge: the active pane's mode, as Doom's modeline shows the major mode. */
function modeBadge(app: App) {
	const el = createDiv({ cls: 'status-bar-badge' });
	app.statusBarEl.prepend(el);
	const update = () => {
		const view = app.workspace.activeLeaf?.view;
		let mode = 'quire';
		if (view instanceof MarkdownView) mode = view.getMode() === 'preview' ? 'read' : view.vimMode ?? 'edit';
		else if (view && view.getViewType() !== 'empty') mode = view.getViewType().split('-').pop() ?? 'quire';
		el.setText(mode);
		el.setAttribute('aria-label', `Mode: ${mode}`);
	};
	app.workspace.on('active-leaf-change', update);
	app.workspace.on('layout-change', update);
	app.workspace.on('vim-mode-change', update);
	update();
}

function wordCount(app: App) {
	const el = app.statusBarEl.createDiv({ cls: 'status-bar-item mod-word-count' });
	const update = () => {
		const view = app.workspace.getActiveViewOfType(MarkdownView);
		if (!view) { el.setText(''); return; }
		const sel = view.editor.getSelection();
		const text = sel || view.editor.getValue().replace(/^---\n[\s\S]*?\n---\n/, '');
		const words = (text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? []).length;
		el.setText(`${sel ? 'Selected: ' : ''}${words.toLocaleString()} ${words === 1 ? 'word' : 'words'} · ${text.length.toLocaleString()} characters`);
	};
	let timer = 0;
	const soon = () => { window.clearTimeout(timer); timer = window.setTimeout(update, 200); };
	app.workspace.on('active-leaf-change', soon);
	app.workspace.on('editor-change', soon);
	document.addEventListener('selectionchange', soon);
}

// -------------------------------------------------------------------------------------------------

function wrapSelection(app: App, before: string, after = before) {
	const view = app.workspace.getActiveViewOfType(MarkdownView);
	if (!view) return;
	const cm = view.editor.cm;
	cm.dispatch(cm.state.changeByRange((range) => {
		const text = cm.state.sliceDoc(range.from, range.to);
		const wrapped = text.startsWith(before) && text.endsWith(after) && text.length >= before.length + after.length;
		if (wrapped) {
			const inner = text.slice(before.length, text.length - after.length);
			return { changes: { from: range.from, to: range.to, insert: inner }, range: EditorSelection.range(range.from, range.from + inner.length) };
		}
		return {
			changes: [{ from: range.from, insert: before }, { from: range.to, insert: after }],
			range: EditorSelection.range(range.from + before.length, range.to + before.length),
		};
	}));
	cm.focus();
}

export function registerCore(app: App): { reveal(): void } {
	const { workspace, vault } = app;
	app.editorSuggests.push(new LinkSuggest(app), new SlashSuggest(app));
	for (const tab of [new EditorTab(app), new FilesTab(app), new AppearanceTab(app), new HotkeysTab(app), new PluginsTab(app), new AboutTab(app)]) app.setting.addCoreTab(tab);
	// Vim's ex commands act on the app: save, close the tab.
	const vimView = () => workspace.getActiveViewOfType(MarkdownView);
	Vim.defineEx('write', 'w', () => { void vimView()?.save(); });
	Vim.defineEx('quit', 'q', () => { workspace.activeLeaf?.detach(); });
	Vim.defineEx('wq', 'wq', () => { const v = vimView(); void v?.save().then(() => v.leaf.detach()); });
	Vim.defineEx('xit', 'x', () => { const v = vimView(); void v?.save().then(() => v.leaf.detach()); });
	modeBadge(app);
	wordCount(app);

	const add = (c: Command) => app.commands.addCommand(c);
	const activeMarkdown = () => workspace.getActiveViewOfType(MarkdownView);

	add({ id: 'app:open-settings', name: 'Open settings', icon: 'settings', section: 'App', aliases: ['Preferences', 'Options'], hotkeys: [{ modifiers: ['Mod'], key: ',' }], callback: () => app.setting.open() });
	add({ id: 'app:open-homebase', name: 'Open a folder as a homebase…', icon: 'folder-open', section: 'Homebase', aliases: ['Open another homebase', 'Open vault'], callback: () => { void app.host.app.chooseVault(false); } });
	add({ id: 'app:change-docket-key', name: 'Change the Docket key', icon: 'keyboard', section: 'Docket', aliases: ['Docket hotkey', 'Docket shortcut'], callback: () => app.setting.openTabById('hotkeys') });
	/** Every note in a folder and the folders inside it. */
	const notesIn = (folder: TFolder): TFile[] => {
		const out: TFile[] = [];
		const visit = (x: TFolder) => { for (const c of x.children) { if (c instanceof TFolder) visit(c); else if (c instanceof TFile && c.extension === 'md') out.push(c); } };
		visit(folder);
		return out;
	};
	/** The file a command acts on: the one a menu passed, or the open note. */
	const fileArg = (ctx: CommandContext): TAbstractFile | null => (ctx.args.file instanceof TAbstractFile ? ctx.args.file : ctx.file);
	const leafArg = (ctx: CommandContext): WorkspaceLeaf | null => (ctx.args.leaf instanceof WorkspaceLeaf ? ctx.args.leaf : workspace.activeLeaf);
	const report = (e: unknown) => new Notice(e instanceof Error ? e.message : String(e));
	add({
		id: 'app:new-note', name: 'Create new note', icon: 'square-pen', section: 'Notes', aliases: ['New note', 'New file'],
		hotkeys: [{ modifiers: ['Mod'], key: 'n' }],
		// The name first, and where (the open note's folder unless a folder was given): no "Untitled" to rename.
		run: (ctx) => {
			const folder = ctx.args.folder instanceof TFolder ? ctx.args.folder : app.fileManager.getNewFileParent(workspace.getActiveFile()?.path ?? '');
			if (typeof ctx.args.name === 'string') return createNote(app, folder, ctx.args.name);
			new NewNoteModal(app, folder, notePlaces(app, String(app.config.archiveFolder || 'Archive'))).open();
			return undefined;
		},
	});
	add({
		id: 'app:new-folder', name: 'Create new folder', icon: 'folder-plus', section: 'Notes', aliases: ['New folder', 'New subject', 'New topic'],
		run: (ctx) => {
			const parent = ctx.args.folder instanceof TFolder ? ctx.args.folder : vault.getRoot();
			new NameModal(app, 'New folder', 'New folder', 'Create', (name) => {
				if (!name) return;
				const path = parent.isRoot() ? name : `${parent.path}/${name}`;
				vault.createFolder(path).catch(report);
			}).open();
		},
	});
	add({
		id: 'app:new-tab', name: 'New tab', section: 'Layout', hotkeys: [{ modifiers: ['Mod'], key: 't' }],
		callback: () => { const leaf = workspace.getLeaf('tab'); workspace.setActiveLeaf(leaf, { focus: true }); },
	});
	add({
		id: 'app:close-tab', name: 'Close current tab', section: 'Layout', aliases: ['Close pane'], hotkeys: [{ modifiers: ['Mod'], key: 'w' }],
		when: (ctx) => !!leafArg(ctx),
		run: (ctx) => leafArg(ctx)?.detach(),
	});
	const cycleTab = (step: number) => (checking: boolean) => {
		const tabs = workspace.activeLeaf?.parent;
		if (!tabs || tabs.children.length < 2) return false;
		if (!checking) {
			const next = tabs.children[(tabs.currentTab + step + tabs.children.length) % tabs.children.length]!;
			workspace.setActiveLeaf(next, { focus: true });
		}
		return true;
	};
	add({ id: 'app:next-tab', name: 'Go to next tab', section: 'Layout', hotkeys: [{ modifiers: ['Ctrl'], key: 'Tab' }], checkCallback: cycleTab(1) });
	add({ id: 'app:previous-tab', name: 'Go to previous tab', section: 'Layout', hotkeys: [{ modifiers: ['Ctrl', 'Shift'], key: 'Tab' }], checkCallback: cycleTab(-1) });
	const split = (direction: 'vertical' | 'horizontal') => ({
		when: (ctx: CommandContext) => !!leafArg(ctx),
		run: (ctx: CommandContext) => { void workspace.duplicateLeaf(leafArg(ctx)!, direction); },
	});
	add({ id: 'app:split-right', name: 'Split right', icon: 'separator-vertical', section: 'Layout', ...split('vertical') });
	add({ id: 'app:split-down', name: 'Split down', icon: 'separator-horizontal', section: 'Layout', ...split('horizontal') });
	add({
		id: 'app:toggle-reading', name: 'Toggle reading view', icon: 'book-open', section: 'View', hotkeys: [{ modifiers: ['Mod'], key: 'e' }],
		checkCallback: (checking) => { const v = activeMarkdown(); if (!v) return false; if (!checking) void v.toggleMode(); return true; },
	});
	add({
		id: 'app:toggle-live-preview', name: 'Toggle live preview / source mode', icon: 'eye', section: 'View',
		callback: () => {
			const on = !app.config.livePreview;
			void app.setConfig('livePreview', on);
			new Notice(on ? 'Live preview: Markdown is shown formatted.' : 'Source mode: Markdown is shown as written.');
		},
	});
	add({
		id: 'app:save', name: 'Save current file', section: 'Notes', hotkeys: [{ modifiers: ['Mod'], key: 's' }],
		checkCallback: (checking) => { const v = activeMarkdown(); if (!v) return false; if (!checking) void v.save(); return true; },
	});
	add({
		id: 'app:rename-file', name: 'Rename file', icon: 'pencil', section: 'Notes', hotkeys: [{ modifiers: [], key: 'F2' }],
		when: (ctx) => { const f = fileArg(ctx); return !!f && !(f instanceof TFolder && f.isRoot()); },
		run: (ctx) => promptRename(app, fileArg(ctx)!),
	});
	add({
		id: 'app:delete-file', name: 'Delete file', icon: 'trash-2', section: 'Notes', aliases: ['Remove', 'Trash'], confirmAction: 'Move to trash', danger: true,
		when: (ctx) => { const f = fileArg(ctx); return !!f && !(f instanceof TFolder && f.isRoot()); },
		confirm: (ctx) => {
			const f = fileArg(ctx);
			if (f instanceof TFolder) {
				const n = notesIn(f).length;
				return `Move the folder “${f.name}”${n ? ` and the ${n} note${n === 1 ? '' : 's'} in it` : ''} to the system trash?`;
			}
			return `Move “${f instanceof TFile && f.extension === 'md' ? f.basename : f?.name}” to the system trash?`;
		},
		run: async (ctx) => {
			const f = fileArg(ctx)!;
			// Locked notes are only deleted with the homebase unlocked.
			if ((f instanceof TFile ? [f] : f instanceof TFolder ? notesIn(f) : []).some((x) => app.isLocked(x)) && !(await app.lock.requestUnlock())) return;
			await vault.trash(f, true).catch(report);
		},
	});
	add({
		id: 'app:move-file', name: 'Move file to another folder', icon: 'folder-input', section: 'Notes',
		when: (ctx) => { const f = fileArg(ctx); return !!f && !(f instanceof TFolder && f.isRoot()); },
		run: (ctx) => {
			const f = fileArg(ctx)!;
			new FolderPicker(app, (folder) => {
				const to = folder.isRoot() ? f.name : `${folder.path}/${f.name}`;
				app.fileManager.renameFile(f, to).catch(report);
			}).open();
		},
	});
	add({
		id: 'app:copy-file', name: 'Make a copy', icon: 'copy', section: 'Notes', aliases: ['Duplicate'],
		when: (ctx) => fileArg(ctx) instanceof TFile,
		run: (ctx) => {
			const f = fileArg(ctx) as TFile;
			void vault.copy(f, freePath(app, f.parent ?? vault.getRoot(), f.basename, f.extension ? `.${f.extension}` : '')).catch(report);
		},
	});
	add({
		id: 'app:open-in-new-tab', name: 'Open in new tab', icon: 'file-plus', section: 'Layout',
		when: (ctx) => ctx.args.file instanceof TFile,
		run: (ctx) => workspace.getLeaf('tab').openFile(ctx.args.file as TFile),
	});
	add({
		id: 'app:open-to-right', name: 'Open to the right', icon: 'separator-vertical', section: 'Layout',
		when: (ctx) => ctx.args.file instanceof TFile,
		run: (ctx) => workspace.getLeaf('split').openFile(ctx.args.file as TFile),
	});
	add({
		id: 'app:show-in-folder', name: 'Show in system file manager', icon: 'folder-open', section: 'Notes',
		when: (ctx) => !!fileArg(ctx),
		run: (ctx) => { const f = fileArg(ctx)!; void app.host.app.showItemInFolder(f instanceof TFolder && f.isRoot() ? '' : f.path); },
	});
	const editorCmd = (id: string, name: string, key: string, before: string, after = before) => add({
		id, name, section: 'Edit', hotkeys: [{ modifiers: ['Mod'], key }], editorCallback: () => wrapSelection(app, before, after),
	});
	editorCmd('editor:toggle-bold', 'Toggle bold', 'b', '**');
	editorCmd('editor:toggle-italics', 'Toggle italics', 'i', '*');
	editorCmd('editor:insert-wikilink', 'Insert internal link', 'k', '[[', ']]');
	// Tables: rows and columns from the keyboard, in a table being edited (Tab and Shift+Tab move between cells).
	const tableCmd = (id: string, name: string, op: TableOp, hotkeys?: Hotkey[]) => add({
		id, name, section: 'Tables', icon: 'table', hotkeys,
		when: () => { const v = activeMarkdown(); return !!v && v.getMode() === 'source' && !!tableHere(v.editor.cm.state); },
		run: () => { const v = activeMarkdown(); if (v) tableOp(v.editor.cm, op); },
	});
	tableCmd('editor:table-row-below', 'Table: add a row below', 'row-below', [{ modifiers: ['Alt'], key: 'Enter' }]);
	tableCmd('editor:table-row-above', 'Table: add a row above', 'row-above');
	tableCmd('editor:table-column-right', 'Table: add a column to the right', 'column-right', [{ modifiers: ['Alt', 'Shift'], key: 'Enter' }]);
	tableCmd('editor:table-column-left', 'Table: add a column to the left', 'column-left');
	tableCmd('editor:table-delete-row', 'Table: delete this row', 'delete-row');
	tableCmd('editor:table-delete-column', 'Table: delete this column', 'delete-column');
	tableCmd('editor:table-format', 'Table: line up the columns', 'format');
	// …and from the right-click menu, in a table.
	workspace.on('editor-menu', (menu: Menu, editor: { cm: EditorView }) => {
		if (!tableHere(editor.cm.state)) return;
		menu.addSeparator();
		for (const [title, op, icon] of [
			['Add a row below', 'row-below', 'arrow-down'], ['Add a row above', 'row-above', 'arrow-up'],
			['Add a column to the right', 'column-right', 'arrow-right'], ['Add a column to the left', 'column-left', 'arrow-left'],
			['Delete this row', 'delete-row', 'trash-2'], ['Delete this column', 'delete-column', 'trash-2'],
		] as const) menu.addItem((i) => i.setTitle(title).setIcon(icon).onClick(() => { tableOp(editor.cm, op); }));
	});
	add({ id: 'editor:toggle-highlight', name: 'Toggle highlight', section: 'Edit', editorCallback: () => wrapSelection(app, '==') });
	add({ id: 'editor:toggle-code', name: 'Toggle inline code', section: 'Edit', editorCallback: () => wrapSelection(app, '`') });
	add({ id: 'editor:toggle-strikethrough', name: 'Toggle strikethrough', section: 'Edit', editorCallback: () => wrapSelection(app, '~~') });

	// The status bar's Docket button (where the sidebar toggle was).
	const docketBtn = app.statusBarEl.createDiv({ cls: 'status-bar-item mod-clickable', attr: { 'aria-label': 'Open the Docket' } });
	setIcon(docketBtn, 'panel-top');
	docketBtn.addEventListener('click', () => app.commands.executeCommandById('app:docket'));

	registerLocking(app);
	const tiling = registerTiling(app);
	registerMedia(app);
	registerPdf(app);
	registerHomebases(app);
	unitsStore(app);
	(app as unknown as { tiling: typeof tiling }).tiling = tiling;
	const docket = registerDocket(app);
	return {
		reveal: () => { docket.start(); },
	};
}
