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

export type PluginManifest = PluginManifestData;
export type Modifier = 'Mod' | 'Ctrl' | 'Meta' | 'Shift' | 'Alt';

export interface Hotkey {
	modifiers: Modifier[];
	key: string;
}

export interface Command {
	id: string;
	name: string;
	icon?: string;
	hotkeys?: Hotkey[];
	repeatable?: boolean;
	mobileOnly?: boolean;
	callback?: () => unknown;
	checkCallback?: (checking: boolean) => boolean | void;
	editorCallback?: (editor: Editor, ctx: MarkdownView | MarkdownFileInfo) => unknown;
	editorCheckCallback?: (checking: boolean, editor: Editor, ctx: MarkdownView | MarkdownFileInfo) => boolean | void;
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
		const full: Command = { ...command, id: `${this.manifest.id}:${command.id}`, name: `${this.manifest.name}: ${command.name}` };
		this.app.commands.addCommand(full);
		this.register(() => this.app.commands.removeCommand(full.id));
		return full;
	}

	removeCommand(id: string): void {
		this.app.commands.removeCommand(`${this.manifest.id}:${id}`);
	}

	addRibbonIcon(icon: string, title: string, callback: (evt: MouseEvent) => unknown): HTMLElement {
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
			console.error(`Could not read settings of ${this.manifest.id}`, e);
			return null;
		}
	}

	async saveData(data: unknown): Promise<void> {
		await this.app.vault.adapter.write(this._dataPath(), JSON.stringify(data, null, '\t'));
	}

	onExternalSettingsChange?(): void | Promise<void>;
}
