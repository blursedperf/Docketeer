/**
 * The app's own features, built on the same API plugins use: file explorer, command palette, quick
 * switcher, core commands, settings pages and the word count.
 */
import { EditorSelection } from '@codemirror/state';
import { Vim } from '@replit/codemirror-vim';
import {
	type App, type AppConfig, type Command, FuzzySuggestModal, type FuzzyMatch, MarkdownView, Notice, type Palette, Setting, SettingTab,
	SuggestModal, TFile, TFolder, formatHotkey, fuzzyScore, getIconPacks, setIcon, type Hotkey, type Modifier, Platform, Modal, SPELL_LANGUAGES,
} from '@quire/api';
import { FILE_EXPLORER, FileExplorerView, NameModal, freePath } from './explorer';
import { BACKLINK_VIEW, BacklinksView } from './panes/backlinks';
import { LinkSuggest } from './panes/link-suggest';
import { OUTGOING_VIEW, OutgoingLinksView } from './panes/outgoing';
import { OUTLINE_VIEW, OutlineView } from './panes/outline';
import { SEARCH_VIEW, SearchView } from './panes/search';
import { TAG_VIEW, TagsView } from './panes/tags';

/** The panes Quire puts in the sidebars, in order. Each is added once per homebase; closing one is remembered. */
const SIDEBAR_PANES: [type: string, side: 'left' | 'right'][] = [
	[FILE_EXPLORER, 'left'], [SEARCH_VIEW, 'left'], [TAG_VIEW, 'left'],
	[BACKLINK_VIEW, 'right'], [OUTGOING_VIEW, 'right'], [OUTLINE_VIEW, 'right'],
];

// -------------------------------------------------------------------------------------------------
// Command palette

class CommandPalette extends SuggestModal<Command> {
	private recent: string[];
	constructor(app: App, recent: string[]) {
		super(app);
		this.recent = recent;
		this.setPlaceholder('Type a command…');
		this.setInstructions([{ command: '↑↓', purpose: 'to navigate' }, { command: '↵', purpose: 'to use' }, { command: 'esc', purpose: 'to dismiss' }]);
	}
	getSuggestions(query: string): Command[] {
		const cmds = this.app.commands.listCommands().filter((c) => this.app.commands.isAvailable(c));
		if (!query.trim()) {
			const rank = (c: Command) => { const i = this.recent.indexOf(c.id); return i === -1 ? 999 : i; };
			return cmds.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
		}
		return cmds.map((c) => ({ c, s: fuzzyScore(query, c.name) })).filter((x) => x.s !== null).sort((a, b) => b.s! - a.s!).map((x) => x.c);
	}
	renderSuggestion(c: Command, el: HTMLElement): void {
		el.addClass('mod-complex');
		const content = el.createDiv({ cls: 'suggestion-content' });
		// A plugin's commands: its name as a muted prefix, the command itself in normal weight.
		const plugin = this.app.plugins.manifests[c.id.slice(0, c.id.indexOf(':'))];
		const prefix = plugin && c.name.startsWith(`${plugin.name}: `) ? `${plugin.name}: ` : '';
		if (prefix) content.createSpan({ cls: 'suggestion-prefix', text: prefix });
		content.createSpan({ text: c.name.slice(prefix.length) });
		const keys = this.app.commands.hotkeysFor(c);
		if (keys.length) {
			const aux = el.createDiv({ cls: 'suggestion-aux' });
			for (const k of keys) aux.createSpan({ cls: 'suggestion-hotkey', text: formatHotkey(k) });
		}
	}
	onChooseSuggestion(c: Command): void {
		this.recent.splice(0, this.recent.length, c.id, ...this.recent.filter((x) => x !== c.id).slice(0, 19));
		// Let the palette close (and focus return to the editor) before running.
		window.setTimeout(() => this.app.commands.executeCommand(c), 0);
	}
}

// -------------------------------------------------------------------------------------------------
// Quick switcher

type SwitchItem = TFile | { create: string };

class QuickSwitcher extends SuggestModal<SwitchItem> {
	constructor(app: App) {
		super(app);
		this.setPlaceholder('Find or create a note…');
		this.setInstructions([{ command: '↵', purpose: 'to open' }, { command: 'ctrl ↵', purpose: 'to open in new tab' }, { command: 'shift ↵', purpose: 'to create' }]);
		this.inputEl.addEventListener('keydown', (e) => {
			if (e.key === 'Enter' && e.shiftKey && this.inputEl.value.trim()) {
				e.preventDefault();
				e.stopPropagation();
				this.close();
				void this.create(this.inputEl.value.trim(), false);
			}
		});
	}
	getSuggestions(query: string): SwitchItem[] {
		const files = this.app.vault.getFiles();
		const recent = (f: TFile) => f.stat.mtime;
		if (!query.trim()) return files.filter((f) => f.extension === 'md').sort((a, b) => recent(b) - recent(a));
		const out = files.map((f) => ({ f, s: fuzzyScore(query, f.extension === 'md' ? f.path.replace(/\.md$/, '') : f.path) }))
			.filter((x) => x.s !== null).sort((a, b) => b.s! - a.s!).map((x) => x.f as SwitchItem);
		if (!files.some((f) => f.basename.toLowerCase() === query.trim().toLowerCase())) out.push({ create: query.trim() });
		return out;
	}
	renderSuggestion(item: SwitchItem, el: HTMLElement): void {
		el.addClass('mod-complex');
		if (!(item instanceof TFile)) {
			el.createDiv({ cls: 'suggestion-content', text: `Create "${item.create}"` });
			el.createDiv({ cls: 'suggestion-note', text: 'New note' });
			return;
		}
		el.createDiv({ cls: 'suggestion-content', text: item.extension === 'md' ? item.basename : item.name });
		if (item.parent && !item.parent.isRoot()) el.createDiv({ cls: 'suggestion-note', text: item.parent.path });
	}
	onChooseSuggestion(item: SwitchItem, evt: MouseEvent | KeyboardEvent): void {
		const newTab = evt.ctrlKey || evt.metaKey;
		if (item instanceof TFile) void this.app.workspace.getLeaf(newTab ? 'tab' : false).openFile(item);
		else void this.create(item.create, newTab);
	}
	private async create(name: string, newTab: boolean) {
		const parent = this.app.fileManager.getNewFileParent(this.app.workspace.getActiveFile()?.path ?? '');
		const rel = name.endsWith('.md') ? name : `${name}.md`;
		const path = rel.includes('/') || parent.isRoot() ? rel : `${parent.path}/${rel}`;
		const existing = this.app.vault.getFileByPath(path);
		const file = existing ?? await this.app.vault.create(path, '');
		await this.app.workspace.getLeaf(newTab ? 'tab' : false).openFile(file);
	}
}

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
		new Setting(el).setName('Vim key bindings').setDesc('Edit with Vim keys: normal, insert and visual modes, motions, operators, :w to save and :q to close the tab. The modeline shows the mode.')
			.addToggle((t) => t.setValue(c.vimMode).onChange((v) => { void this.app.setConfig('vimMode', v); }));
		new Setting(el).setName('Auto-pair brackets').setDesc('Type the closing bracket or quote with the opening one.')
			.addToggle((t) => t.setValue(c.autoPairBrackets).onChange((v) => { void this.app.setConfig('autoPairBrackets', v); }));
		new Setting(el).setName('Spelling').setHeading();
		new Setting(el).setName('Check spelling').setDesc('Mark misspelled words as you write; right-click one for suggestions, to add it to your dictionary, or to ignore it. The dictionaries ship with Quire and checking happens on this computer.')
			.addToggle((t) => t.setValue(c.spellcheck).onChange((v) => { void this.app.setConfig('spellcheck', v); }));
		new Setting(el).setName('Language')
			.addDropdown((d) => d.addOptions(SPELL_LANGUAGES).setValue(c.spellcheckLanguage).onChange((v) => { void this.app.setConfig('spellcheckLanguage', v); }));
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
		new Setting(el).setName('Default location for new notes')
			.addDropdown((d) => d.addOptions({ root: 'Homebase folder', current: 'Same folder as current file', folder: 'In the folder below' })
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
		const font = (name: string, desc: string, key: 'interfaceFont' | 'textFont' | 'monospaceFont', placeholder: string) =>
			new Setting(el).setName(name).setDesc(desc)
				.addText((t) => t.setPlaceholder(placeholder).setValue(String(c[key] ?? '')).onChange((v) => set(key, v.trim())));
		font('Interface font', 'Menus, tabs, settings. A font installed on this computer; empty for the default.', 'interfaceFont', 'System default');
		font('Text font', 'The text of notes.', 'textFont', 'Same as interface');
		font('Monospace font', 'Code, the file tree, tabs and the status bar.', 'monospaceFont', 'JetBrains Mono, Iosevka …');
		new Setting(el).setName('Text size').setDesc('Size of the text in notes, in pixels.')
			.addSlider((s) => s.setLimits(10, 30, 1).setValue(c.fontSize).onChange((v) => set('fontSize', v)));
		new Setting(el).setName('Density').setDesc('How much space the interface leaves around rows, tabs and controls.')
			.addDropdown((d) => d.addOptions({ compact: 'Compact', comfortable: 'Comfortable', spacious: 'Spacious' }).setValue(c.density)
				.onChange((v) => set('density', v as AppConfig['density'])));

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
		new Setting(el)
			.addButton((b) => b.setButtonText('Show snippets folder').onClick(async () => {
				await app.vault.adapter.mkdir(css.snippetsFolder);
				await app.host.app.showItemInFolder(css.snippetsFolder);
			}))
			.addButton((b) => b.setButtonText('Reload themes and snippets').setCta().onClick(async () => {
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
	const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
	// Plain typing keys need a modifier; function keys and the like may stand alone.
	if (modifiers.length === 0 && !/^F\d{1,2}$|^(Insert|Delete|Home|End|PageUp|PageDown)$/.test(key)) return null;
	return { modifiers, key };
}

class HotkeysTab extends SettingTab {
	override id = 'hotkeys';
	override name = 'Hotkeys';
	private filter = '';

	display(): void {
		const el = this.containerEl;
		el.empty();
		new Setting(el).setName('Hotkeys').setHeading();
		new Setting(el).setName('Find a command').setDesc('Click + and press the keys to add a hotkey; × removes one; the arrow goes back to the default. Saved in this homebase (.quire/hotkeys.json).')
			.addSearch((s) => {
				s.setPlaceholder('Filter commands…').setValue(this.filter).onChange((v) => { this.filter = v; this.renderList(list); });
				window.setTimeout(() => s.inputEl.focus(), 0);
			});
		const list = el.createDiv({ cls: 'hotkey-list' });
		this.renderList(list);
	}

	private renderList(list: HTMLElement): void {
		list.empty();
		const cmds = this.app.commands;
		const words = this.filter.toLowerCase().split(/\s+/).filter(Boolean);
		const all = cmds.listCommands().filter((c) => words.every((w) => c.name.toLowerCase().includes(w))).sort((a, b) => a.name.localeCompare(b.name));
		if (all.length === 0) list.createDiv({ cls: 'setting-note', text: 'No commands match.' });
		for (const cmd of all) {
			const row = new Setting(list).setName(cmd.name).setClass('mod-hotkeys');
			const keys = cmds.hotkeysFor(cmd);
			const clashes = keys.flatMap((k) => cmds.conflicts(k, cmd.id).map((c) => `${formatHotkey(k)} also runs "${c.name}"`));
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
				b.onClick(() => {
					btn.addClass('is-recording-hotkey');
					btn.empty();
					btn.setText('Press keys…');
					btn.focus();
					const done = () => { btn.removeEventListener('keydown', onKey, true); btn.removeEventListener('blur', cancel); };
					const cancel = () => { done(); this.renderList(list); };
					const onKey = async (e: KeyboardEvent) => {
						e.preventDefault();
						e.stopPropagation();
						if (e.key === 'Escape') { cancel(); return; }
						const h = hotkeyFromEvent(e);
						if (!h) return;
						done();
						await cmds.setHotkeys(cmd.id, [...keys, h]);
						this.renderList(list);
					};
					btn.addEventListener('keydown', onKey, true);
					btn.addEventListener('blur', cancel);
				});
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
	workspace.registerViewType(FILE_EXPLORER, (leaf) => new FileExplorerView(leaf));
	const openSearch = async (query?: string) => {
		const leaf = await workspace.ensureSideLeaf(SEARCH_VIEW, 'left', { reveal: true });
		const view = leaf.view as SearchView;
		if (query !== undefined) view.setQuery(query);
		view.focus();
	};
	workspace.registerViewType(SEARCH_VIEW, (leaf) => new SearchView(leaf));
	workspace.registerViewType(BACKLINK_VIEW, (leaf) => new BacklinksView(leaf));
	workspace.registerViewType(OUTGOING_VIEW, (leaf) => new OutgoingLinksView(leaf));
	workspace.registerViewType(TAG_VIEW, (leaf) => new TagsView(leaf, (tag) => { void openSearch(`tag:${tag}`); }));
	workspace.registerViewType(OUTLINE_VIEW, (leaf) => new OutlineView(leaf));
	app.editorSuggests.push(new LinkSuggest(app));
	for (const tab of [new EditorTab(app), new FilesTab(app), new AppearanceTab(app), new HotkeysTab(app), new PluginsTab(app), new AboutTab(app)]) app.setting.addCoreTab(tab);
	// Vim's ex commands act on the app: save, close the tab.
	const vimView = () => workspace.getActiveViewOfType(MarkdownView);
	Vim.defineEx('write', 'w', () => { void vimView()?.save(); });
	Vim.defineEx('quit', 'q', () => { workspace.activeLeaf?.detach(); });
	Vim.defineEx('wq', 'wq', () => { const v = vimView(); void v?.save().then(() => v.leaf.detach()); });
	Vim.defineEx('xit', 'x', () => { const v = vimView(); void v?.save().then(() => v.leaf.detach()); });
	modeBadge(app);
	wordCount(app);

	const recent: string[] = [];
	const add = (c: Command) => app.commands.addCommand(c);
	const activeMarkdown = () => workspace.getActiveViewOfType(MarkdownView);
	const explorer = () => workspace.getLeavesOfType(FILE_EXPLORER)[0]?.view as FileExplorerView | undefined;

	add({ id: 'app:command-palette', name: 'Command palette: Open', icon: 'terminal', hotkeys: [{ modifiers: ['Mod'], key: 'p' }], callback: () => new CommandPalette(app, recent).open() });
	add({
		id: 'app:search', name: 'Search: Search in all notes', icon: 'search', hotkeys: [{ modifiers: ['Mod', 'Shift'], key: 'f' }],
		callback: () => {
			const sel = activeMarkdown()?.editor.getSelection();
			void openSearch(sel && !sel.includes('\n') ? sel : undefined);
		},
	});
	const showPane = (id: string, name: string, icon: string, type: string, side: 'left' | 'right') =>
		add({ id, name, icon, callback: () => { void workspace.ensureSideLeaf(type, side, { reveal: true }); } });
	showPane('app:show-backlinks', 'Show backlinks', 'link', BACKLINK_VIEW, 'right');
	showPane('app:show-outgoing-links', 'Show outgoing links', 'arrow-up-right', OUTGOING_VIEW, 'right');
	showPane('app:show-outline', 'Show outline', 'list-tree', OUTLINE_VIEW, 'right');
	showPane('app:show-tags', 'Show tags', 'tags', TAG_VIEW, 'left');
	add({ id: 'app:quick-switcher', name: 'Quick switcher: Open', icon: 'search', hotkeys: [{ modifiers: ['Mod'], key: 'o' }], callback: () => new QuickSwitcher(app).open() });
	add({ id: 'app:open-settings', name: 'Open settings', icon: 'settings', hotkeys: [{ modifiers: ['Mod'], key: ',' }], callback: () => app.setting.open() });
	add({ id: 'app:open-homebase', name: 'Open another homebase', icon: 'folder-open', callback: () => { void app.host.app.chooseVault(false); } });
	add({
		id: 'app:new-note', name: 'Create new note', icon: 'square-pen', hotkeys: [{ modifiers: ['Mod'], key: 'n' }],
		callback: async () => {
			const folder = app.fileManager.getNewFileParent(workspace.getActiveFile()?.path ?? '');
			const file = await vault.create(freePath(app, folder, 'Untitled', '.md'), '');
			await workspace.getLeaf(false).openFile(file);
			explorer()?.promptRename(file);
		},
	});
	add({
		id: 'app:new-tab', name: 'New tab', hotkeys: [{ modifiers: ['Mod'], key: 't' }],
		callback: () => { const leaf = workspace.getLeaf('tab'); workspace.setActiveLeaf(leaf, { focus: true }); },
	});
	add({
		id: 'app:close-tab', name: 'Close current tab', hotkeys: [{ modifiers: ['Mod'], key: 'w' }],
		checkCallback: (checking) => {
			const leaf = workspace.activeLeaf;
			if (!leaf) return false;
			if (!checking) leaf.detach();
			return true;
		},
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
	add({ id: 'app:next-tab', name: 'Go to next tab', hotkeys: [{ modifiers: ['Ctrl'], key: 'Tab' }], checkCallback: cycleTab(1) });
	add({ id: 'app:previous-tab', name: 'Go to previous tab', hotkeys: [{ modifiers: ['Ctrl', 'Shift'], key: 'Tab' }], checkCallback: cycleTab(-1) });
	add({
		id: 'app:split-right', name: 'Split right', icon: 'separator-vertical',
		checkCallback: (checking) => { const l = workspace.activeLeaf; if (!l || l.isSidebar()) return false; if (!checking) void workspace.duplicateLeaf(l, 'vertical'); return true; },
	});
	add({
		id: 'app:split-down', name: 'Split down', icon: 'separator-horizontal',
		checkCallback: (checking) => { const l = workspace.activeLeaf; if (!l || l.isSidebar()) return false; if (!checking) void workspace.duplicateLeaf(l, 'horizontal'); return true; },
	});
	add({ id: 'app:toggle-left-sidebar', name: 'Toggle left sidebar', icon: 'panel-left', callback: () => workspace.leftSplit.toggle() });
	add({ id: 'app:toggle-right-sidebar', name: 'Toggle right sidebar', icon: 'panel-right', callback: () => workspace.rightSplit.toggle() });
	add({
		id: 'app:toggle-reading', name: 'Toggle reading view', icon: 'book-open', hotkeys: [{ modifiers: ['Mod'], key: 'e' }],
		checkCallback: (checking) => { const v = activeMarkdown(); if (!v) return false; if (!checking) void v.toggleMode(); return true; },
	});
	add({
		id: 'app:toggle-live-preview', name: 'Toggle live preview / source mode', icon: 'eye',
		callback: () => {
			const on = !app.config.livePreview;
			void app.setConfig('livePreview', on);
			new Notice(on ? 'Live preview: Markdown is shown formatted.' : 'Source mode: Markdown is shown as written.');
		},
	});
	add({
		id: 'app:save', name: 'Save current file', hotkeys: [{ modifiers: ['Mod'], key: 's' }],
		checkCallback: (checking) => { const v = activeMarkdown(); if (!v) return false; if (!checking) void v.save(); return true; },
	});
	add({
		id: 'app:rename-file', name: 'Rename file', hotkeys: [{ modifiers: [], key: 'F2' }],
		checkCallback: (checking) => { const f = workspace.getActiveFile(); if (!f) return false; if (!checking) explorer()?.promptRename(f); return true; },
	});
	add({
		id: 'app:delete-file', name: 'Delete current file',
		checkCallback: (checking) => { const f = workspace.getActiveFile(); if (!f) return false; if (!checking) explorer()?.confirmDelete(f); return true; },
	});
	add({
		id: 'app:move-file', name: 'Move current file to another folder',
		checkCallback: (checking) => {
			const f = workspace.getActiveFile();
			if (!f) return false;
			if (!checking) new FolderPicker(app, (folder) => {
				const to = folder.isRoot() ? f.name : `${folder.path}/${f.name}`;
				app.fileManager.renameFile(f, to).catch((e: unknown) => new Notice(e instanceof Error ? e.message : String(e)));
			}).open();
			return true;
		},
	});
	add({
		id: 'app:reveal-file', name: 'Reveal current file in navigation',
		checkCallback: (checking) => {
			const f = workspace.getActiveFile();
			if (!f) return false;
			if (!checking) void workspace.ensureSideLeaf(FILE_EXPLORER, 'left', { reveal: true }).then((leaf) => (leaf.view as FileExplorerView).reveal(f));
			return true;
		},
	});
	add({
		id: 'app:show-in-folder', name: 'Show current file in system file manager',
		checkCallback: (checking) => { const f = workspace.getActiveFile(); if (!f) return false; if (!checking) void app.host.app.showItemInFolder(f.path); return true; },
	});
	add({
		id: 'app:new-folder', name: 'Create new folder',
		callback: () => new NameModal(app, 'New folder', 'New folder', 'Create', (name) => {
			if (name) vault.createFolder(name).catch((e: unknown) => new Notice(e instanceof Error ? e.message : String(e)));
		}).open(),
	});
	const editorCmd = (id: string, name: string, key: string, before: string, after = before) => add({
		id, name, hotkeys: [{ modifiers: ['Mod'], key }], editorCallback: () => wrapSelection(app, before, after),
	});
	editorCmd('editor:toggle-bold', 'Toggle bold', 'b', '**');
	editorCmd('editor:toggle-italics', 'Toggle italics', 'i', '*');
	editorCmd('editor:insert-wikilink', 'Insert internal link', 'k', '[[', ']]');
	add({ id: 'editor:toggle-highlight', name: 'Toggle highlight', editorCallback: () => wrapSelection(app, '==') });
	add({ id: 'editor:toggle-code', name: 'Toggle inline code', editorCallback: () => wrapSelection(app, '`') });
	add({ id: 'editor:toggle-strikethrough', name: 'Toggle strikethrough', editorCallback: () => wrapSelection(app, '~~') });

	// Ribbon
	workspace.leftRibbon.addRibbonItemButton('app:quick-switcher', 'search', 'Open quick switcher', () => app.commands.executeCommandById('app:quick-switcher'));
	workspace.leftRibbon.addRibbonItemButton('app:command-palette', 'terminal', 'Open command palette', () => app.commands.executeCommandById('app:command-palette'));
	workspace.leftRibbon.addRibbonItemButton('app:new-note', 'square-pen', 'Create new note', () => app.commands.executeCommandById('app:new-note'));
	const toggleLeft = app.statusBarEl.createDiv({ cls: 'status-bar-item mod-clickable', attr: { 'aria-label': 'Toggle sidebars' } });
	setIcon(toggleLeft, 'panel-left');
	toggleLeft.addEventListener('click', () => workspace.leftSplit.toggle());

	return {
		reveal: () => { void seedSidebars(app); },
	};
}

/**
 * Add the sidebar panes a homebase has not had yet (new homebases, and panes added in a later version),
 * keeping whichever tab was showing. A pane the user closes stays closed: each is added only once.
 */
async function seedSidebars(app: App): Promise<void> {
	const { workspace } = app;
	const seeded = new Set(Array.isArray(app.config.seededPanes) ? (app.config.seededPanes as string[]) : []);
	const before = { left: workspace.leftSplit.tabs.activeLeaf, right: workspace.rightSplit.tabs.activeLeaf };
	let added = false;
	for (const [type, side] of SIDEBAR_PANES) {
		if (seeded.has(type) && type !== FILE_EXPLORER) continue;
		if (workspace.getLeavesOfType(type).length === 0) {
			await workspace.ensureSideLeaf(type, side);
			added = true;
		}
		seeded.add(type);
	}
	if (added) {
		for (const side of ['left', 'right'] as const) {
			const tabs = side === 'left' ? workspace.leftSplit.tabs : workspace.rightSplit.tabs;
			const keep = before[side] ?? tabs.children[0];
			if (keep) tabs.selectTab(keep);
		}
	}
	if (seeded.size !== (Array.isArray(app.config.seededPanes) ? (app.config.seededPanes as string[]).length : 0)) {
		await app.setConfig('seededPanes', [...seeded]);
	}
}
