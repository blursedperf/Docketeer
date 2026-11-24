/**
 * The app's own features, built on the same API plugins use: file explorer, command palette, quick
 * switcher, core commands, settings pages and the word count.
 */
import { EditorSelection } from '@codemirror/state';
import {
	type App, type AppConfig, type Command, FuzzySuggestModal, type FuzzyMatch, MarkdownView, Notice, type Palette, Setting, SettingTab,
	SuggestModal, TFile, TFolder, formatHotkey, fuzzyScore, getIconPacks, setIcon,
} from '@quire/api';
import { FILE_EXPLORER, FileExplorerView, NameModal, freePath } from './explorer';

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
		el.createDiv({ cls: 'suggestion-content', text: c.name });
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
		new Setting(el).setName('Auto-pair brackets').setDesc('Type the closing bracket or quote with the opening one. Applies to notes opened after the change.')
			.addToggle((t) => t.setValue(c.autoPairBrackets).onChange((v) => { void this.app.setConfig('autoPairBrackets', v); }));
		new Setting(el).setName('Spellcheck').setDesc('Not available yet: the spelling dictionaries Electron uses are downloaded from the web, so Quire leaves them off. Offline dictionaries are planned.')
			.setDisabled(true);
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
	}
}

// -------------------------------------------------------------------------------------------------
// Word count in the status bar

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
	for (const tab of [new EditorTab(app), new FilesTab(app), new AppearanceTab(app), new PluginsTab(app), new AboutTab(app)]) app.setting.addCoreTab(tab);
	wordCount(app);

	const recent: string[] = [];
	const add = (c: Command) => app.commands.addCommand(c);
	const activeMarkdown = () => workspace.getActiveViewOfType(MarkdownView);
	const explorer = () => workspace.getLeavesOfType(FILE_EXPLORER)[0]?.view as FileExplorerView | undefined;

	add({ id: 'app:command-palette', name: 'Command palette: Open', icon: 'terminal', hotkeys: [{ modifiers: ['Mod'], key: 'p' }], callback: () => new CommandPalette(app, recent).open() });
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
		reveal: () => { void workspace.ensureSideLeaf(FILE_EXPLORER, 'left'); },
	};
}
