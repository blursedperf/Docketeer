/**
 * @quire/api — the plugin API of Quire.
 *
 * Plugins import from here; at run time the import resolves to the app's own instance, so classes,
 * `instanceof` checks and CodeMirror state fields are shared with the app.
 */
import './dom';

export { installDomHelpers, type DomElementInfo } from './dom';
export { Events, type EventRef } from './events';
export { Component } from './component';
export { debounce, normalizePath, Platform, escapeRegExp, fuzzyScore, type Debouncer } from './util';
export { setIcon, getIcon, addIcon, getIconIds, registerIconPack, getIconPacks, setIconPack, getActiveIconPack, type IconPack, type IconData } from './icons';
export { CustomCss, cssProblems, accentVars, type Palette } from './themes/manager';
export { BUILTIN_PALETTES } from './themes/palettes';
export { CONTRAST_PAIRS, contrastFixes, contrastRatio } from './themes/contrast';
export { TAbstractFile, TFile, TFolder, type FileStats } from './files';
export { Vault, DataAdapter } from './vault';
export {
	MetadataCache, FileManager, parseFrontMatter, splitFrontMatter, parseMetadata, getAllTags, parseLinktext, withFrontMatter,
	parseYamlSafe as parseYaml, stringifyYaml,
	type CachedMetadata, type FrontMatterCache, type HeadingCache, type LinkCache, type EmbedCache, type FootnoteCache,
	type FootnoteRefCache, type TagCache, type Pos, type Loc,
} from './metadata';
export { View, ItemView, FileView, EmptyView, type ViewStateResult } from './view';
export {
	Workspace, WorkspaceLeaf, WorkspaceSplit, WorkspaceTabs, WorkspaceSidedock, WorkspaceItem,
	type ViewState, type OpenViewState, type ViewCreator, type SplitDirection, type PaneType,
} from './workspace';
export { Editor, editorInfoField, minimalChange, type EditorPosition, type EditorRange, type EditorSelectionRange, type MarkdownFileInfo } from './editor';
export { MarkdownView, type MarkdownViewModeType } from './markdown-view';
export { MarkdownRenderer, type MarkdownPostProcessor, type MarkdownPostProcessorContext } from './markdown-render';
export { EditorSuggest, type EditorSuggestContext, type EditorSuggestTriggerInfo } from './editor-suggest';
export {
	Notice, Modal, topModal, SuggestModal, FuzzySuggestModal, Menu, MenuItem, Setting, SettingTab, PluginSettingTab,
	ButtonComponent, ExtraButtonComponent, ToggleComponent, TextComponent, SearchComponent, TextAreaComponent, SliderComponent, DropdownComponent, ColorComponent,
	type FuzzyMatch, type Instruction, type SettingDefinitionItem,
} from './ui';
export { Plugin, type Command, type Hotkey, type Modifier, type PluginManifest } from './plugin';
export { App, Commands, PluginManager, DEFAULT_CONFIG, formatHotkey, type AppConfig } from './app';
export { SettingsModal } from './settings-modal';
export { getHost, type HostBridge, type HostFs, type HostStat, type HostEntry, type HostFsEvent, type HostPluginInfo, type PluginManifestData } from './host';
export { baseExtensions, quireHighlight, linkAt } from './cm-setup';

/** This API's version. */
export const apiVersion = '0.2.0';
