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
export { debounce, normalizePath, Platform, escapeRegExp, fuzzyScore, wordMatch, type Debouncer } from './util';
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
export { Plugin, type Command, type CommandContext, type Hotkey, type Modifier, type PluginManifest } from './plugin';
export { type KeyContext, hotkeyString, eventString, parseHotkey, physicalKey, reservedFor } from './keymap';
export { parsePrefix, caseNameAt, inFootnote, contextPanel, groupResults, mergeResults, clampHeight, DOCKET_PREFIXES } from './docket-logic';
export { SearchIndex, tokenize, type TextHit, type NameHit, type HeadingHit, type RankContext, type IndexedHeading } from './search-index';
export { SearchService } from './search-service';
export { findAuthorities, nextOccurrence, normaliseName, JURISDICTIONS, type Authority, type AuthorityKind, type AuthorityDecisions, type Jurisdiction, type Occurrence } from './authorities';
export { outlineHeadings, moveSection, shiftLevel, isCaseBrief, addBriefField, BRIEF_FIELDS, type OutlineHeading } from './outline-edit';
export { PRESETS, neighbour, paneRects, resizePane, equalise, zoomChain, type LayoutNode, type Direction, type Preset } from './layout-tree';
export { CITATION_STYLES, AGLC4, planCitation, footnoteChanges, noteFootnotes, type CitationStyle, type FieldDef, type Source, type SourceKind, type SourceKindDef } from './cite';
export { Usage, frecency, type UsageEntry } from './usage';
export { DocketRegistry, arrangePanels, type PanelArrangement, type DocketPanel, type SearchProvider, type SearchResult, type SearchResults, type SearchQuery, type ResultAction, type OpenWhere } from './docket-registry';
export { App, Commands, PluginManager, DEFAULT_CONFIG, formatHotkey, type AppConfig } from './app';
export { SettingsModal } from './settings-modal';
export { getHost, type HostBridge, type HostFs, type HostStat, type HostEntry, type HostFsEvent, type HostPluginInfo, type PluginManifestData } from './host';
export { baseExtensions, quireHighlight, linkAt } from './cm-setup';
export { Spellchecker, SPELL_LANGUAGES, spellRefresh } from './spellcheck';
export { LEGAL_WORDS } from './legal-words';
export { VIDEO_EXTENSIONS, AUDIO_EXTENSIONS, mediaKind, isMedia, parseTimestamp, formatTimestamp, timeFromSubpath, timestampLink, SPEEDS, nextSpeed, captionsFor, createPlayer, MediaPlayers, MediaView } from './media';
export { IMAGE_EXTENSIONS, isImage, attachmentFolder, availablePath, saveAttachment, attachFiles, embedMarkdown } from './attachments';

/** This API's version. */
export const apiVersion = '0.14.0';
export { type Table, type Align, parseTable, formatTable, addRow, addColumn, deleteRow, deleteColumn, tableAt, allTables } from './tables';
export { type TableOp, tableOp, tableHere } from './tables-editor';
