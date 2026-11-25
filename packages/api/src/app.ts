import type { Extension } from '@codemirror/state';
import type { KeyBinding } from '@codemirror/view';
import { Events } from './events';
import type { EditorSuggest } from './editor-suggest';
import type { HostBridge, HostPluginInfo } from './host';
import { MarkdownView } from './markdown-view';
import { FileManager, MetadataCache } from './metadata';
import type { Command, CommandContext, Hotkey, Plugin, PluginManifest } from './plugin';
import { type KeyContext, eventString, formatHotkey as formatHotkeyFor, hotkeyString, reservedFor } from './keymap';
import { DocketRegistry } from './docket-registry';
import { SearchService } from './search-service';
import { LockService } from './lock/service';
import { MediaPlayers } from './media';
import type { TFile } from './files';
import { SettingsModal } from './settings-modal';
import { Modal, Notice, topModal } from './ui';
import { Platform } from './util';
import { Vault } from './vault';
import { Workspace, type WorkspaceLeaf } from './workspace';
import { CustomCss } from './themes/manager';
import { Spellchecker } from './spellcheck';

// -------------------------------------------------------------------------------------------------
// Commands and hotkeys

const platform = () => Platform;

export function formatHotkey(h: Hotkey): string {
	return formatHotkeyFor(h, platform());
}

/** The command registry: every action in the app, its shortcuts, and running it. */
export class Commands {
	commands: Record<string, Command> = {};
	/** User overrides in this homebase: command id to hotkeys (empty array removes the default). */
	customKeys: Record<string, Hotkey[]> = {};
	/** User overrides for every homebase, kept in the app's own settings (the Docket key). Under `customKeys`. */
	appKeys: Record<string, Hotkey[]> = {};

	constructor(private app: App) {
		if (typeof window !== 'undefined') window.addEventListener('keydown', (e) => this.onKeyDown(e), true);
	}

	addCommand(cmd: Command): void {
		if (!cmd.source) cmd.source = 'core';
		this.commands[cmd.id] = cmd;
	}
	removeCommand(id: string): void { delete this.commands[id]; }
	findCommand(id: string): Command | undefined { return this.commands[id]; }
	listCommands(): Command[] { return Object.values(this.commands); }

	hotkeysFor(cmd: Command): Hotkey[] {
		return this.customKeys[cmd.id] ?? this.appKeys[cmd.id] ?? cmd.hotkeys ?? [];
	}

	/** Whether the hotkeys were changed for every homebase. */
	isAppCustomised(id: string): boolean {
		return id in this.appKeys;
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
		} catch {
			console.error('Could not read the hotkeys file');
		}
		try {
			const getConfig = this.app.host?.app?.getConfig;
			const app = getConfig ? (await getConfig()).hotkeys : null;
			if (app && typeof app === 'object') this.appKeys = Object.fromEntries(Object.entries(app as Record<string, unknown>).filter((e): e is [string, Hotkey[]] => Array.isArray(e[1])));
		} catch {
			console.error('Could not read the app hotkeys');
		}
	}

	/** Set a command's hotkeys (an empty list removes them all); null goes back to the default. */
	async setHotkeys(id: string, keys: Hotkey[] | null): Promise<void> {
		if (keys === null) delete this.customKeys[id];
		else this.customKeys[id] = keys;
		await this.app.vault.adapter.write(this.hotkeysPath, JSON.stringify(this.customKeys, null, '\t'));
		this.app.trigger('hotkeys-changed', id);
	}

	/** Set a command's hotkeys for every homebase (in the app's settings); null goes back to the default. */
	async setAppHotkeys(id: string, keys: Hotkey[] | null): Promise<void> {
		if (keys === null) delete this.appKeys[id];
		else this.appKeys[id] = keys;
		await this.app.host.app.setConfig({ hotkeys: this.appKeys });
		this.app.trigger('hotkeys-changed', id);
	}

	/**
	 * Commands (other than `except`) that a hotkey would also run. Two commands clash when they work in
	 * the same place. A command for one place (the Docket, the editor) is not a clash with a global one:
	 * there it wins on purpose (Mod+Alt+↑ resizes the Docket while it has the keyboard, moves between
	 * panes elsewhere).
	 */
	conflicts(h: Hotkey, except?: string): Command[] {
		const key = hotkeyString(h, platform());
		const ctx = except ? this.commands[except]?.context ?? 'global' : 'global';
		return this.listCommands().filter((c) => {
			if (c.id === except || !this.hotkeysFor(c).some((k) => hotkeyString(k, platform()) === key)) return false;
			return (c.context ?? 'global') === ctx;
		});
	}

	/** What the system already does with this hotkey ("Copy", "Quit" …), if anything. */
	reservedFor(h: Hotkey): string | null {
		return reservedFor(h, platform());
	}

	/** The context a command runs in: the active editor, view and note, and its arguments. */
	context(args: Record<string, unknown> = {}): CommandContext {
		const view = this.app.workspace?.getActiveViewOfType(MarkdownView) ?? null;
		const source = view && view.getMode() === 'source' ? view : null;
		return { app: this.app, editor: source?.editor ?? null, view, file: this.app.workspace?.getActiveFile() ?? null, args };
	}

	/** Whether the command can run now: its `when`, or its callbacks' own checks. */
	isAvailable(cmd: Command, args: Record<string, unknown> = {}): boolean {
		const ctx = this.context(args);
		try {
			if (cmd.when) return cmd.when(ctx);
			if (cmd.run) return true;
			const view = ctx.editor ? ctx.view : null;
			if (cmd.editorCheckCallback) return !!view && cmd.editorCheckCallback(true, view.editor, view) === true;
			if (cmd.editorCallback) return !!view;
			if (cmd.checkCallback) return cmd.checkCallback(true) === true;
			return !!cmd.callback;
		} catch {
			console.error(`Command ${cmd.id}: its availability check failed`);
			return false;
		}
	}

	/**
	 * Run a command, with arguments (menus pass the file or pane they were opened on). Returns false when
	 * it is not available. Commands with `confirm` ask first; `requiresUnlocked` ones refuse while locked.
	 */
	executeCommand(cmd: Command, args: Record<string, unknown> = {}): boolean {
		if (!this.isAvailable(cmd, args)) return false;
		const ctx = this.context(args);
		if (cmd.requiresUnlocked && this.app.isLocked(ctx.file)) {
			new Notice(`${cmd.name}: unlock first.`);
			return false;
		}
		const go = () => this.runNow(cmd, ctx);
		if (cmd.confirm) {
			const question = typeof cmd.confirm === 'function' ? cmd.confirm(ctx) : typeof cmd.confirm === 'string' ? cmd.confirm : `${cmd.name}?`;
			new ConfirmCommandModal(this.app, cmd.name, question, go, cmd.confirmAction ?? 'Continue', cmd.danger === true).open();
			return true;
		}
		go();
		return true;
	}

	private runNow(cmd: Command, ctx: CommandContext): void {
		try {
			const view = ctx.editor ? ctx.view : null;
			let r: unknown;
			if (cmd.run) r = cmd.run(ctx, ctx.args);
			else if (cmd.editorCheckCallback) r = cmd.editorCheckCallback(false, view!.editor, view!);
			else if (cmd.editorCallback) r = cmd.editorCallback(view!.editor, view!);
			else if (cmd.checkCallback) r = cmd.checkCallback(false);
			else r = cmd.callback?.();
			if (r instanceof Promise) r.catch((e: unknown) => this.failed(cmd, e));
		} catch (e) {
			this.failed(cmd, e);
		}
		this.app.lastCommand = cmd.id;
		this.app.trigger('command-run', cmd.id);
	}

	private failed(cmd: Command, e: unknown) {
		// The message may name a file: shown to the user, never written to the log.
		console.error(`Command ${cmd.id} failed`);
		new Notice(`${cmd.name} failed: ${e instanceof Error ? e.message : String(e)}`);
	}

	executeCommandById(id: string, args: Record<string, unknown> = {}): boolean {
		const cmd = this.commands[id];
		return cmd ? this.executeCommand(cmd, args) : false;
	}

	/** Where the keyboard is: the Docket, an editor, or elsewhere. */
	private keyContexts(): Set<KeyContext> {
		const set = new Set<KeyContext>(['global']);
		if (this.app.docketOpen) set.add('docket');
		const active = typeof document !== 'undefined' ? document.activeElement : null;
		if (active?.closest?.('.cm-editor')) set.add('editor');
		return set;
	}

	private onKeyDown(e: KeyboardEvent) {
		if (e.isComposing || topModal()) return;
		if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;
		const pressed = eventString(e);
		const where = this.keyContexts();
		// Commands for where the keyboard is (the Docket, the editor) before global ones with the same keys.
		const ordered = Object.values(this.commands).sort((a, b) => ((a.context ?? 'global') === 'global' ? 1 : 0) - ((b.context ?? 'global') === 'global' ? 1 : 0));
		for (const cmd of ordered) {
			if (!where.has(cmd.context ?? 'global')) continue;
			if (!this.hotkeysFor(cmd).some((h) => hotkeyString(h, platform()) === pressed)) continue;
			if (this.executeCommand(cmd)) {
				e.preventDefault();
				e.stopPropagation();
				return;
			}
		}
	}
}

/** Asks before a command with `confirm` runs. */
class ConfirmCommandModal extends Modal {
	constructor(app: App, title: string, private question: string, private onYes: () => void, private action = 'Continue', private danger = false) {
		super(app);
		this.setTitle(title);
	}
	override onOpen(): void {
		this.contentEl.createEl('p', { text: this.question });
		const row = this.contentEl.createDiv({ cls: 'modal-button-container' });
		const no = row.createEl('button', { text: 'Cancel' });
		no.addEventListener('click', () => this.close());
		const yes = row.createEl('button', { cls: this.danger ? 'mod-warning' : 'mod-cta', text: this.action });
		yes.addEventListener('click', () => { this.close(); this.onYes(); });
		window.setTimeout(() => yes.focus(), 0);
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
			this.dropDuplicateRibbonCommands(id, manifest.name);
			return true;
		} catch (e) {
			console.error(`Plugin ${id} failed to load`, e);
			this.errors[id] = e instanceof Error ? e.message : String(e);
			new Notice(`Plugin "${manifest.name}" failed to load: ${this.errors[id]}`);
			await this.disablePlugin(id);
			return false;
		}
	}

	/**
	 * Ribbon buttons become commands (there is no ribbon), but most plugins also have a command for the same
	 * thing, often added later in onload or named a little differently ("Open AGLC4 page preview" and "Open
	 * page preview"). Keep the plugin's own command.
	 */
	private dropDuplicateRibbonCommands(id: string, pluginName: string): void {
		const nameWords = new Set(pluginName.toLowerCase().split(/\s+/));
		const norm = (s: string) => s.toLowerCase().replace(/^[^:]*:\s*/, '').split(/\s+/).filter((w) => w && !nameWords.has(w)).join(' ');
		const own = this.app.commands.listCommands().filter((c) => c.source === `plugin:${id}`);
		const real = new Set(own.filter((c) => !c.id.startsWith(`${id}:ribbon-`)).map((c) => norm(c.name)));
		for (const c of own) if (c.id.startsWith(`${id}:ribbon-`) && real.has(norm(c.name))) this.app.commands.removeCommand(c.id);
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
	/** Skip capitalised words in mid-sentence: names. */
	spellcheckNames: boolean;
	/** Accept legal terms: Latin, AGLC abbreviations, legal vocabulary. */
	spellcheckLegal: boolean;
	autoPairBrackets: boolean;
	newFileLocation: 'root' | 'current' | 'folder';
	newFileFolderPath: string;
	/** Where pasted and dropped files go: a folder from the root, "./" (the note's folder) or "./name". */
	attachmentFolder: string;
	alwaysUpdateLinks: boolean;
	/** Notes opened from the Docket go in a new tab (or the tab already showing them), not over the note in use. */
	docketNewTab: boolean;
	vimMode: boolean;
	/** Show Markdown formatted while writing (raw on the lines being edited). */
	livePreview: boolean;
	/** The note's name as an editable title above its text (editing it renames the file). */
	inlineTitle: boolean;
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
	/** The Docket (always on; false only while tests take it down and build it again). */
	docket: boolean;
	/** Peek overlays the editor; pinned docks above it. */
	docketMode: 'peek' | 'pinned';
	/** The title bar: 'hidden' (window buttons in Quire's top bar) or 'native' (the system's). Applies on restart. */
	windowFrame: 'hidden' | 'native';
	/** Height as a fraction of the window (0.2–0.6). */
	docketHeight: number;
	/** The last panel shown. */
	docketPanel: string;
	/** The first-run hint ("Press the Docket key for everything") was seen. */
	docketHintSeen: boolean;
	/** Notes pinned in the Subjects panel (paths). */
	pinnedNotes: string[];
	/** Lock the homebase after this many idle minutes (0: never). */
	lockIdleMinutes: number;
	/** Lock when the computer sleeps or its screen locks. */
	lockOnSleep: boolean;
	/** Where archived notes go (keeping their folders). */
	archiveFolder: string;
	/** Citation style for the Cite panel. */
	citationStyle: string;
	/** Layouts saved by name (the main area's panes and tabs). */
	savedLayouts: Record<string, unknown>;
	[key: string]: unknown;
}

export const DEFAULT_CONFIG: AppConfig = {
	theme: 'system',
	fontSize: 16,
	readableLineLength: true,
	spellcheck: true,
	spellcheckLanguage: 'en-AU',
	spellcheckFootnotes: false,
	spellcheckNames: true,
	spellcheckLegal: true,
	autoPairBrackets: false,
	windowFrame: 'hidden',
	newFileLocation: 'current',
	newFileFolderPath: '',
	attachmentFolder: 'attachments',
	alwaysUpdateLinks: true,
	docketNewTab: true,
	vimMode: false,
	livePreview: true,
	inlineTitle: true,
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
	docket: true,
	docketMode: 'peek',
	docketHeight: 0.35,
	docketPanel: 'core:outline',
	docketHintSeen: false,
	pinnedNotes: [],
	archiveFolder: 'Archive',
	lockIdleMinutes: 15,
	lockOnSleep: true,
	citationStyle: 'aglc4',
	savedLayouts: {},
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
	/** Docket panels, search providers and result actions (core and plugins). */
	docket: DocketRegistry;
	/** Audio and video players on screen, and the one in use. */
	readonly media = new MediaPlayers();
	/** The in-memory search index and the record of what is used (for ranking). */
	search: SearchService;
	/** True while the Docket is open (for shortcuts that only work there). */
	docketOpen = false;
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
		this.docket = new DocketRegistry();
		this.search = new SearchService(this);
		this.lock = new LockService(this);
		this.lock.on('before-lock', (wait: (p: Promise<unknown>) => void) => wait(this.closeLockedViews()));
		this.lock.on('locked', () => this.forgetLocked());
		this.lock.on('unlocked', () => { void this.learnUnlocked(); });
	}

	/** Before locking: save, then close, every tab showing a locked note. */
	private async closeLockedViews(): Promise<void> {
		const leaves: WorkspaceLeaf[] = [];
		this.workspace.iterateAllLeaves((l) => {
			const f = (l.view as { file?: TFile | null }).file;
			if (f && this.isEncrypted(f)) leaves.push(l);
		});
		for (const l of leaves) {
			const v = l.view;
			if (v instanceof MarkdownView) await v.save();
			l.detach();
		}
		await new Promise((r) => setTimeout(r, 0));
	}

	/** After locking: nothing of locked notes stays in memory (text cache, links, search, usage). */
	private forgetLocked(): void {
		for (const f of this.vault.getMarkdownFiles()) {
			if (!this.isEncrypted(f)) continue;
			this.vault.forget(f);
			void this.metadataCache.update(f);
			this.search.index.remove(f.path);
			this.search.usage.forget('note', f.path);
		}
		this.trigger('lock-change', true);
	}

	/** After unlocking: locked notes are read again, so links, search and outline see them. */
	private async learnUnlocked(): Promise<void> {
		for (const f of this.vault.getMarkdownFiles()) {
			if (!this.isEncrypted(f)) continue;
			try {
				await this.metadataCache.update(f);
				await this.search.reindex(f);
			} catch {
				console.error('Could not read a locked note after unlocking');
			}
		}
		this.trigger('lock-change', false);
	}

	/**
	 * Whether the homebase, or `file`, is locked. Nothing can be locked until the locking phase; commands
	 * and search already ask, so they need no change then.
	 */
	isLocked(file?: TFile | null): boolean {
		return !!file && this.lock.isLocked(file.path);
	}

	/** Whether a note is locked on disk (encrypted), whether or not the homebase is unlocked now. */
	isEncrypted(file?: TFile | null): boolean {
		return !!file && this.lock.isEncrypted(file.path);
	}

	/** Locking: setting up, unlocking, locking notes and folders (lock/service.ts). */
	lock: LockService;

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
		if (key === 'vimMode' || key === 'autoPairBrackets' || key === 'livePreview' || key === 'spellcheck' || key === 'inlineTitle') this.workspace.updateOptions();
		if ((key === 'spellcheck' || key === 'spellcheckLanguage') && this.config.spellcheck) void this.spellchecker.load(this.config.spellcheckLanguage).catch((e: unknown) => console.error(e));
		if (key === 'spellcheckFootnotes' || key === 'spellcheckNames') this.spellchecker.refreshEditors();
		if (key === 'spellcheckLegal' && this.config.spellcheck) void this.spellchecker.load(this.config.spellcheckLanguage, true).catch((e: unknown) => console.error(e));
		this.trigger('config-changed', key);
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
		await this.lock.load();
		await this.metadataCache.indexAll();
		await this.search.usage.load();
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
		// The search index builds in the background (the notes' text is already in memory).
		void this.search.build();
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
