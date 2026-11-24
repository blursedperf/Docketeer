import type { Extension } from '@codemirror/state';
import type { KeyBinding } from '@codemirror/view';
import { Events } from './events';
import type { EditorSuggest } from './editor-suggest';
import type { HostBridge, HostPluginInfo } from './host';
import { MarkdownView } from './markdown-view';
import { FileManager, MetadataCache } from './metadata';
import type { Command, Hotkey, Plugin, PluginManifest } from './plugin';
import { SettingsModal } from './settings-modal';
import { Notice, topModal } from './ui';
import { Platform } from './util';
import { Vault } from './vault';
import { Workspace } from './workspace';
import { CustomCss } from './themes/manager';
import { Spellchecker } from './spellcheck';

// -------------------------------------------------------------------------------------------------
// Commands and hotkeys

function hotkeyString(h: Hotkey): string {
	const mods = [...new Set(h.modifiers.map((m) => (m === 'Mod' ? (Platform.isMacOS ? 'Meta' : 'Ctrl') : m)))].sort();
	return [...mods, h.key.length === 1 ? h.key.toUpperCase() : h.key].join('+');
}

function eventString(e: KeyboardEvent): string {
	const mods: string[] = [];
	if (e.altKey) mods.push('Alt');
	if (e.ctrlKey) mods.push('Ctrl');
	if (e.metaKey) mods.push('Meta');
	if (e.shiftKey) mods.push('Shift');
	const key = e.key.length === 1 ? e.key.toUpperCase() : e.key;
	return [...mods.sort(), key].join('+');
}

export function formatHotkey(h: Hotkey): string {
	return hotkeyString(h).replace('Meta', Platform.isMacOS ? '⌘' : 'Meta');
}

export class Commands {
	commands: Record<string, Command> = {};
	/** User overrides: command id to hotkeys (empty array removes the default). */
	customKeys: Record<string, Hotkey[]> = {};

	constructor(private app: App) {
		window.addEventListener('keydown', (e) => this.onKeyDown(e), true);
	}

	addCommand(cmd: Command): void { this.commands[cmd.id] = cmd; }
	removeCommand(id: string): void { delete this.commands[id]; }
	findCommand(id: string): Command | undefined { return this.commands[id]; }
	listCommands(): Command[] { return Object.values(this.commands); }

	hotkeysFor(cmd: Command): Hotkey[] {
		return this.customKeys[cmd.id] ?? cmd.hotkeys ?? [];
	}

	/** Whether the user changed this command's hotkeys. */
	isCustomised(id: string): boolean {
		return id in this.customKeys;
	}

	private get hotkeysPath(): string { return `${this.app.vault.configDir}/hotkeys.json`; }

	async loadHotkeys(): Promise<void> {
		try {
			if (await this.app.vault.adapter.exists(this.hotkeysPath)) {
				const data = JSON.parse(await this.app.vault.adapter.read(this.hotkeysPath)) as Record<string, Hotkey[]>;
				this.customKeys = Object.fromEntries(Object.entries(data).filter(([, v]) => Array.isArray(v)));
			}
		} catch (e) {
			console.error('Could not read hotkeys.json', e);
		}
	}

	/** Set a command's hotkeys (an empty list removes them all); null goes back to the default. */
	async setHotkeys(id: string, keys: Hotkey[] | null): Promise<void> {
		if (keys === null) delete this.customKeys[id];
		else this.customKeys[id] = keys;
		await this.app.vault.adapter.write(this.hotkeysPath, JSON.stringify(this.customKeys, null, '\t'));
	}

	/** Commands (other than `except`) that a hotkey would also run. */
	conflicts(h: Hotkey, except?: string): Command[] {
		const key = hotkeyString(h);
		return this.listCommands().filter((c) => c.id !== except && this.hotkeysFor(c).some((k) => hotkeyString(k) === key));
	}

	/** Whether the command can run now (its check callback, or an editor being active). */
	isAvailable(cmd: Command): boolean {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		const editorOk = !!view && view.getMode() === 'source';
		try {
			if (cmd.editorCheckCallback) return editorOk && cmd.editorCheckCallback(true, view!.editor, view!) === true;
			if (cmd.editorCallback) return editorOk;
			if (cmd.checkCallback) return cmd.checkCallback(true) === true;
			return !!cmd.callback;
		} catch (e) {
			console.error(`Command ${cmd.id} check failed`, e);
			return false;
		}
	}

	executeCommand(cmd: Command): boolean {
		if (!this.isAvailable(cmd)) return false;
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		try {
			if (cmd.editorCheckCallback) cmd.editorCheckCallback(false, view!.editor, view!);
			else if (cmd.editorCallback) cmd.editorCallback(view!.editor, view!);
			else if (cmd.checkCallback) cmd.checkCallback(false);
			else cmd.callback?.();
		} catch (e) {
			console.error(`Command ${cmd.id} failed`, e);
			new Notice(`Command failed: ${e instanceof Error ? e.message : String(e)}`);
		}
		this.app.lastCommand = cmd.id;
		return true;
	}

	executeCommandById(id: string): boolean {
		const cmd = this.commands[id];
		return cmd ? this.executeCommand(cmd) : false;
	}

	private onKeyDown(e: KeyboardEvent) {
		if (e.isComposing || topModal()) return;
		if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;
		const pressed = eventString(e);
		for (const cmd of Object.values(this.commands)) {
			if (!this.hotkeysFor(cmd).some((h) => hotkeyString(h) === pressed)) continue;
			if (this.executeCommand(cmd)) {
				e.preventDefault();
				e.stopPropagation();
				return;
			}
		}
	}
}

// -------------------------------------------------------------------------------------------------
// Plugins

export class PluginManager {
	manifests: Record<string, PluginManifest> = {};
	plugins: Record<string, Plugin> = {};
	enabledPlugins = new Set<string>();
	private info: Record<string, HostPluginInfo> = {};
	private styleEls = new Map<string, HTMLLinkElement>();
	private errors: Record<string, string> = {};

	constructor(private app: App) {}

	private configPath(): string { return `${this.app.vault.configDir}/plugins.json`; }

	async loadManifests(): Promise<void> {
		this.manifests = {};
		this.info = {};
		for (const p of await this.app.host.plugins.list()) {
			this.manifests[p.manifest.id] = p.manifest;
			this.info[p.manifest.id] = p;
		}
	}

	source(id: string): 'builtin' | 'vault' | null { return this.info[id]?.source ?? null; }
	loadError(id: string): string | null { return this.errors[id] ?? null; }

	/** Load the plugins enabled in this vault. New vaults start with the built-in plugins on. */
	async initialize(): Promise<void> {
		await this.loadManifests();
		const { adapter } = this.app.vault;
		let enabled: string[];
		if (await adapter.exists(this.configPath())) {
			try {
				enabled = JSON.parse(await adapter.read(this.configPath())) as string[];
			} catch {
				enabled = [];
			}
		} else {
			enabled = Object.values(this.info).filter((p) => p.source === 'builtin').map((p) => p.manifest.id);
			await adapter.write(this.configPath(), JSON.stringify(enabled, null, '\t'));
		}
		for (const id of enabled) {
			if (this.manifests[id]) await this.enablePlugin(id);
		}
	}

	getPlugin(id: string): Plugin | null { return this.plugins[id] ?? null; }

	async enablePlugin(id: string): Promise<boolean> {
		const manifest = this.manifests[id];
		if (!manifest || this.plugins[id]) return !!this.plugins[id];
		delete this.errors[id];
		try {
			const url = `quire://app/plugins/${encodeURIComponent(id)}/main.js`;
			const mod = (await import(/* webpackIgnore: true */ url)) as { default?: new (app: App, m: PluginManifest) => Plugin };
			if (typeof mod.default !== 'function') throw new Error('main.js has no default export');
			if (this.info[id]?.hasStyles) {
				const link = document.head.createEl('link', { attr: { rel: 'stylesheet', href: `quire://app/plugins/${encodeURIComponent(id)}/styles.css` } });
				this.styleEls.set(id, link);
			}
			const plugin = new mod.default(this.app, manifest);
			this.plugins[id] = plugin;
			this.enabledPlugins.add(id);
			plugin.load();
			// onload may be async; wait for it so its settings are in place before the layout opens.
			await plugin._onloadPromise;
			return true;
		} catch (e) {
			console.error(`Plugin ${id} failed to load`, e);
			this.errors[id] = e instanceof Error ? e.message : String(e);
			new Notice(`Plugin "${manifest.name}" failed to load: ${this.errors[id]}`);
			await this.disablePlugin(id);
			return false;
		}
	}

	async disablePlugin(id: string): Promise<void> {
		const plugin = this.plugins[id];
		delete this.plugins[id];
		this.enabledPlugins.delete(id);
		if (plugin) {
			try { plugin.unload(); } catch (e) { console.error(`Plugin ${id} failed to unload`, e); }
		}
		this.styleEls.get(id)?.detach();
		this.styleEls.delete(id);
		this.app.workspace.updateOptions();
	}

	private async save(): Promise<void> {
		await this.app.vault.adapter.write(this.configPath(), JSON.stringify([...this.enabledPlugins], null, '\t'));
	}

	async enablePluginAndSave(id: string): Promise<boolean> {
		const ok = await this.enablePlugin(id);
		await this.save();
		this.app.workspace.updateOptions();
		return ok;
	}

	async disablePluginAndSave(id: string): Promise<void> {
		await this.disablePlugin(id);
		await this.save();
	}
}

// -------------------------------------------------------------------------------------------------
// App

export interface AppConfig {
	theme: 'system' | 'light' | 'dark';
	fontSize: number;
	readableLineLength: boolean;
	spellcheck: boolean;
	/** Dictionary: en-AU, en-GB or en-US. */
	spellcheckLanguage: string;
	/** Also check footnotes (off: citations would be flagged throughout). */
	spellcheckFootnotes: boolean;
	/** Accept legal terms: Latin, AGLC abbreviations, legal vocabulary. */
	spellcheckLegal: boolean;
	autoPairBrackets: boolean;
	newFileLocation: 'root' | 'current' | 'folder';
	newFileFolderPath: string;
	/** Where pasted and dropped files go: a folder from the root, "./" (the note's folder) or "./name". */
	attachmentFolder: string;
	alwaysUpdateLinks: boolean;
	vimMode: boolean;
	/** Show Markdown formatted while writing (raw on the lines being edited). */
	livePreview: boolean;
	textFont: string;
	interfaceFont: string;
	monospaceFont: string;
	/** Palette ids for dark and light mode. */
	darkPalette: string;
	lightPalette: string;
	/** Accent colour (#rrggbb), or empty for the palette's own. */
	accentColor: string;
	iconSet: string;
	iconWeight: string;
	density: 'compact' | 'comfortable' | 'spacious';
	/** Installed CSS theme (folder name in .quire/themes), or empty. */
	cssTheme: string;
	enabledSnippets: string[];
	[key: string]: unknown;
}

export const DEFAULT_CONFIG: AppConfig = {
	theme: 'system',
	fontSize: 16,
	readableLineLength: true,
	spellcheck: true,
	spellcheckLanguage: 'en-AU',
	spellcheckFootnotes: false,
	spellcheckLegal: true,
	autoPairBrackets: false,
	newFileLocation: 'current',
	newFileFolderPath: '',
	attachmentFolder: 'attachments',
	alwaysUpdateLinks: true,
	vimMode: false,
	livePreview: true,
	textFont: '',
	interfaceFont: '',
	monospaceFont: '',
	darkPalette: 'crisp-dark',
	lightPalette: 'crisp-light',
	accentColor: '',
	iconSet: 'phosphor',
	iconWeight: 'regular',
	density: 'comfortable',
	cssTheme: '',
	enabledSnippets: [],
};

/** The running app: everything a plugin reaches through `this.app`. */
export class App extends Events {
	host: HostBridge;
	vault: Vault;
	metadataCache: MetadataCache;
	fileManager: FileManager;
	workspace: Workspace;
	commands: Commands;
	plugins: PluginManager;
	setting: SettingsModal;
	/** Appearance: palettes, accent, fonts, icons, CSS themes and snippets. */
	customCss: CustomCss;
	/** Offline spellcheck (dictionaries ship with the app). */
	spellchecker: Spellchecker;
	statusBarEl: HTMLElement;
	config: AppConfig = { ...DEFAULT_CONFIG };
	editorSuggests: EditorSuggest<any>[] = [];
	lastCommand: string | null = null;
	private editorExtensions: Extension[] = [];
	private activeSuggest: EditorSuggest<any> | null = null;

	constructor(host: HostBridge, containerEl: HTMLElement) {
		super();
		this.host = host;
		this.vault = new Vault(host);
		this.metadataCache = new MetadataCache(this);
		this.fileManager = new FileManager(this);
		const main = containerEl.createDiv({ cls: 'app-container' });
		this.workspace = new Workspace(this, main.createDiv());
		this.statusBarEl = main.createDiv({ cls: 'status-bar' });
		this.commands = new Commands(this);
		this.plugins = new PluginManager(this);
		this.setting = new SettingsModal(this);
		this.customCss = new CustomCss(this);
		this.spellchecker = new Spellchecker(this);
	}

	/** The homebase: the folder of notes Quire has open. (The API calls it `vault`, as plugins expect.) */
	get homebase(): Vault { return this.vault; }

	// ---------------------------------------------------------------------------------------------
	// Config

	async loadConfig(): Promise<void> {
		const path = `${this.vault.configDir}/app.json`;
		try {
			if (await this.vault.adapter.exists(path)) this.config = { ...DEFAULT_CONFIG, ...(JSON.parse(await this.vault.adapter.read(path)) as Partial<AppConfig>) };
		} catch (e) {
			console.error('Could not read app settings', e);
		}
		this.vault.setConfigValues(this.config);
		this.applyConfig();
	}

	async setConfig<K extends keyof AppConfig>(key: K, value: AppConfig[K]): Promise<void> {
		this.config[key] = value;
		this.vault.setConfigValues(this.config);
		this.applyConfig();
		if (key === 'vimMode' || key === 'autoPairBrackets' || key === 'livePreview' || key === 'spellcheck') this.workspace.updateOptions();
		if ((key === 'spellcheck' || key === 'spellcheckLanguage') && this.config.spellcheck) void this.spellchecker.load(this.config.spellcheckLanguage).catch((e: unknown) => console.error(e));
		if (key === 'spellcheckFootnotes') this.spellchecker.refreshEditors();
		if (key === 'spellcheckLegal' && this.config.spellcheck) void this.spellchecker.load(this.config.spellcheckLanguage, true).catch((e: unknown) => console.error(e));
		await this.vault.adapter.write(`${this.vault.configDir}/app.json`, JSON.stringify(this.config, null, '\t'));
	}

	applyConfig(): void {
		this.customCss.apply();
	}

	isDarkMode(): boolean { return document.body.hasClass('theme-dark'); }

	// ---------------------------------------------------------------------------------------------
	// Editor extensions and suggestions

	getEditorExtensions(): Extension[] { return [...this.editorExtensions]; }

	addEditorExtension(ext: Extension): void {
		this.editorExtensions.push(ext);
		this.workspace.updateOptions();
	}

	removeEditorExtension(ext: Extension): void {
		this.editorExtensions = this.editorExtensions.filter((e) => e !== ext);
		this.workspace.updateOptions();
	}

	setActiveSuggest(s: EditorSuggest<any> | null): void {
		if (s && this.activeSuggest && this.activeSuggest !== s) this.activeSuggest.close();
		this.activeSuggest = s;
	}

	/** Keys for an open suggestion popup, at the highest precedence in every editor. */
	suggestKeymap(): KeyBinding[] {
		const key = (k: string): KeyBinding => ({
			key: k,
			run: () => {
				const s = this.activeSuggest;
				if (!s?.isOpen) return false;
				return s.handleKey(k, new KeyboardEvent('keydown', { key: k }));
			},
		});
		return ['ArrowDown', 'ArrowUp', 'Enter', 'Escape'].map(key);
	}

	/** After each edit or cursor move: open, update or close suggestion popups. */
	onEditorUpdate(view: MarkdownView, typed: boolean): void {
		const editor = view.editor;
		this.workspace.trigger('editor-cursor', editor, view);
		const cursor = editor.getCursor();
		const open = this.activeSuggest;
		if (open) {
			const info = this.safeTrigger(open, view);
			if (!info) { open.close(); return; }
			void open.update({ ...info, editor, file: view.file });
			return;
		}
		if (!typed) return;
		for (const s of this.editorSuggests) {
			const info = this.safeTrigger(s, view);
			if (info) {
				void s.update({ ...info, editor, file: view.file });
				return;
			}
		}
		void cursor;
	}

	private safeTrigger(s: EditorSuggest<any>, view: MarkdownView) {
		try {
			return s.onTrigger(view.editor.getCursor(), view.editor, view.file);
		} catch (e) {
			console.error('Editor suggestion failed', e);
			return null;
		}
	}

	// ---------------------------------------------------------------------------------------------
	// Start-up

	/** Load the vault, index it, load plugins, then restore the layout. */
	async start(): Promise<void> {
		await this.loadConfig();
		await this.commands.loadHotkeys();
		window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => this.applyConfig());
		await this.vault.load();
		await this.customCss.load();
		await this.metadataCache.indexAll();
		await this.plugins.initialize();
		let layout: unknown = null;
		try {
			const path = `${this.vault.configDir}/workspace.json`;
			if (await this.vault.adapter.exists(path)) layout = JSON.parse(await this.vault.adapter.read(path));
		} catch (e) {
			console.error('Could not read the saved layout', e);
		}
		await this.workspace.loadLayout(layout);
		this.workspace.setLayoutReady();
		// The dictionary loads in the background; editors are marked when it is ready.
		if (this.config.spellcheck) void this.spellchecker.load(this.config.spellcheckLanguage).catch((e: unknown) => console.error('Spellcheck', e));
		this.host.app.onBeforeQuit(async () => {
			this.workspace.trigger('quit');
			await this.workspace.saveAll();
			for (const p of Object.values(this.plugins.plugins)) { try { p.unload(); } catch { /* closing */ } }
			await this.workspace.saveAll();
		});
	}
}
