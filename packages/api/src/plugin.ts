import { errorSummary } from './util';
import type { Extension } from '@codemirror/state';
import type { App } from './app';
import { Component } from './component';
import type { Editor, MarkdownFileInfo } from './editor';
import type { EditorSuggest } from './editor-suggest';
import type { PluginManifestData } from './host';
import { registerPostProcessor, type MarkdownPostProcessor } from './markdown-render';
import type { MarkdownView } from './markdown-view';
import type { PluginSettingTab } from './ui';
import type { ViewCreator } from './workspace';
import type { Palette } from './themes/palettes';
import type { KeyContext } from './keymap';
import type { TFile } from './files';
import type { DocketPanel, ResultAction, SearchProvider } from './docket-registry';

export type PluginManifest = PluginManifestData;
export type Modifier = 'Mod' | 'Ctrl' | 'Meta' | 'Shift' | 'Alt';

export interface Hotkey {
	modifiers: Modifier[];
	key: string;
}

/** What a command sees when it runs: the active editor, view and note, and any arguments. */
export interface CommandContext {
	app: App;
	editor: Editor | null;
	view: MarkdownView | null;
	file: TFile | null;
	args: Record<string, unknown>;
}

/**
 * An action. The Obsidian-shaped callbacks (`callback`, `checkCallback`, `editorCallback`,
 * `editorCheckCallback`) still work; new code can use `when` and `run`, which also take arguments, so menus
 * and buttons can run the same command for a particular file or pane.
 */
export interface Command {
	/** Namespaced: "app:new-note", "<pluginId>:<name>". */
	id: string;
	/** Shown in the Docket and command palette. */
	name: string;
	icon?: string;
	/** Default shortcuts (the user can change them). */
	hotkeys?: Hotkey[];
	/** Other names and words to match when searching for the command. */
	aliases?: string[];
	keywords?: string[];
	/** Group in the Docket: Notes, Files, Layout, Edit, View, Search, Cite, Homebase, App … */
	section?: string;
	/** Where its shortcuts work. Global (default), only in the editor, or only with the Docket open. */
	context?: KeyContext;
	/** Available now? Without it, the callbacks' own checks decide. */
	when?: (ctx: CommandContext) => boolean;
	/** The action. Without it, the callbacks run. */
	run?: (ctx: CommandContext, args: Record<string, unknown>) => unknown;
	/** Blocked while the homebase or the note is locked (from the locking phase). */
	requiresUnlocked?: boolean;
	/** Ask first: true, a question, or a question made from the context (deletes, exports). */
	confirm?: boolean | string | ((ctx: CommandContext) => string);
	/** The confirming button's label ("Move to trash"); "Continue" if not given. */
	confirmAction?: string;
	/** The confirmation is for something hard to undo: its button is red. */
	danger?: boolean;
	/** "core" or "plugin:<id>". Set by the app. */
	source?: string;
	repeatable?: boolean;
	mobileOnly?: boolean;
	callback?: () => unknown;
	checkCallback?: (checking: boolean) => boolean | void;
	// Method syntax, as Obsidian declares them, so a plugin may take `view: MarkdownView` (the context is one here).
	editorCallback?(editor: Editor, ctx: MarkdownView | MarkdownFileInfo): unknown;
	editorCheckCallback?(checking: boolean, editor: Editor, ctx: MarkdownView | MarkdownFileInfo): boolean | void;
}

/** Base class of a plugin. `main.js` exports a subclass as its default export. */
export abstract class Plugin extends Component {
	app: App;
	manifest: PluginManifest;

	constructor(app: App, manifest: PluginManifest) {
		super();
		this.app = app;
		this.manifest = manifest;
	}

	override onload(): void | Promise<void> {}

	addCommand(command: Command): Command {
		const full: Command = {
			section: this.manifest.name,
			...command,
			id: `${this.manifest.id}:${command.id}`,
			name: `${this.manifest.name}: ${command.name}`,
			source: `plugin:${this.manifest.id}`,
		};
		this.app.commands.addCommand(full);
		this.register(() => this.app.commands.removeCommand(full.id));
		return full;
	}

	/** The same as `addCommand`, by the Docket plan's name. */
	registerCommand(command: Command): Command {
		return this.addCommand(command);
	}

	/** A panel in the Docket (Mod+number). Removed when the plugin is unloaded. */
	registerDocketPanel(panel: DocketPanel): DocketPanel {
		const full: DocketPanel = { ...panel, id: `${this.manifest.id}:${panel.id}`, source: `plugin:${this.manifest.id}` };
		this.register(this.app.docket.addPanel(full));
		return full;
	}

	/** Results for the Docket's search (all of it, or one prefix). Removed when the plugin is unloaded. */
	registerSearchProvider(provider: SearchProvider): SearchProvider {
		const full: SearchProvider = { ...provider, id: `${this.manifest.id}:${provider.id}`, source: `plugin:${this.manifest.id}` };
		this.register(this.app.docket.addSearchProvider(full));
		return full;
	}

	/** An action offered on search results it applies to (→ or Mod+. in the Docket). */
	registerResultAction(action: ResultAction): ResultAction {
		const full: ResultAction = { ...action, id: `${this.manifest.id}:${action.id}`, source: `plugin:${this.manifest.id}` };
		this.register(this.app.docket.addResultAction(full));
		return full;
	}

	removeCommand(id: string): void {
		this.app.commands.removeCommand(`${this.manifest.id}:${id}`);
	}

	addRibbonIcon(icon: string, title: string, callback: (evt: MouseEvent) => unknown): HTMLElement {
		// With no ribbon (the Docket), the button is a command, unless the plugin has one of that name.
		const exists = this.app.commands.listCommands().some((c) => c.source === `plugin:${this.manifest.id}` && c.name.toLowerCase().endsWith(`: ${title.toLowerCase()}`));
		if (!exists) this.addCommand({ id: `ribbon-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, name: title, icon, callback: () => callback(new MouseEvent('click')) });
		const el = this.app.workspace.leftRibbon.addRibbonItemButton(`${this.manifest.id}:${title}`, icon, title, callback);
		this.register(() => el.detach());
		return el;
	}

	addStatusBarItem(): HTMLElement {
		const el = this.app.statusBarEl.createDiv({ cls: 'status-bar-item', attr: { 'data-plugin': this.manifest.id } });
		this.register(() => el.detach());
		return el;
	}

	addSettingTab(tab: PluginSettingTab): void {
		this.app.setting.addSettingTab(tab);
		this.register(() => this.app.setting.removeSettingTab(tab));
	}

	registerView(type: string, creator: ViewCreator): void {
		this.app.workspace.registerViewType(type, creator);
		this.register(() => this.app.workspace.unregisterViewType(type));
	}

	registerExtensions(extensions: string[], viewType: string): void {
		this.app.workspace.registerExtensions(extensions, viewType);
	}

	/** Add CodeMirror extensions to every editor. Change the array and call `workspace.updateOptions()` to update. */
	registerEditorExtension(extension: Extension): void {
		this.app.addEditorExtension(extension);
		this.register(() => this.app.removeEditorExtension(extension));
	}

	registerEditorSuggest(suggest: EditorSuggest<any>): void {
		this.app.editorSuggests.push(suggest);
		this.register(() => {
			suggest.close();
			this.app.editorSuggests = this.app.editorSuggests.filter((s) => s !== suggest);
		});
	}

	/** Add a colour palette to Appearance while the plugin is on. */
	registerPalette(palette: Palette): void {
		this.register(this.app.customCss.registerPalette(palette));
	}

	registerMarkdownPostProcessor(p: MarkdownPostProcessor): MarkdownPostProcessor {
		this.register(registerPostProcessor(p));
		return p;
	}

	private _dataPath(): string {
		return `${this.app.vault.configDir}/plugins/${this.manifest.id}/data.json`;
	}

	async loadData(): Promise<any> {
		const path = this._dataPath();
		if (!(await this.app.vault.adapter.exists(path))) return null;
		try {
			return JSON.parse(await this.app.vault.adapter.read(path));
		} catch (e) {
			console.error(`Could not read settings of ${this.manifest.id}:`, errorSummary(e));
			return null;
		}
	}

	async saveData(data: unknown): Promise<void> {
		await this.app.vault.adapter.write(this._dataPath(), JSON.stringify(data, null, '\t'));
	}

	onExternalSettingsChange?(): void | Promise<void>;
}
