import { type App, PluginSettingTab, Setting } from "@quire/api";
import type TaskDocketPlugin from "./main";
import type { GroupMode, SortMode } from "./arrange";
import type { MetadataFormat } from "./task";

export interface TaskDocketSettings {
	/** Note new tasks are added to (created if missing). */
	inboxPath: string;
	/** One folder per line; tasks in these folders (and subfolders) are ignored. */
	excludedFolders: string;
	/** Stamp today's date (✅ or [completion:: ]) when a task is checked off. */
	stampDoneDate: boolean;
	/** Format for dates and priorities the plugin writes on lines that do not have one yet. */
	metadataFormat: MetadataFormat;
	defaultSort: SortMode;
	defaultGroup: GroupMode;
	/** Overdue / due-today counts in the status bar. */
	showStatusBar: boolean;
	/** Typing the trigger on a task line offers dates, times and priorities. */
	inlineSuggest: boolean;
	/** The character that opens those suggestions. */
	inlineTrigger: string;
	/** Due date and priority items in the editor's right-click menu on task lines. */
	editorMenu: boolean;
}

export const DEFAULT_SETTINGS: TaskDocketSettings = {
	inboxPath: "Tasks.md",
	excludedFolders: "",
	stampDoneDate: true,
	metadataFormat: "emoji",
	defaultSort: "urgency",
	defaultGroup: "when",
	showStatusBar: true,
	inlineSuggest: true,
	inlineTrigger: "@",
	editorMenu: true,
};

export const SORT_OPTIONS: Record<SortMode, string> = {
	urgency: "Urgency",
	due: "Due date and time",
	priority: "Priority",
	note: "Note",
};

export const GROUP_OPTIONS: Record<GroupMode, string> = {
	when: "Due date",
	priority: "Priority",
	note: "Note",
	tag: "Tag",
	none: "No grouping",
};

type Key = keyof TaskDocketSettings;

export class TaskDocketSettingTab extends PluginSettingTab {
	constructor(app: App, private plugin: TaskDocketPlugin) {
		super(app, plugin);
	}

	private async set<K extends Key>(key: K, value: TaskDocketSettings[K]): Promise<void> {
		this.plugin.settings[key] = value;
		await this.plugin.saveSettings();
		if (key === "excludedFolders") this.plugin.requestRebuild();
		if (key === "showStatusBar") this.plugin.refreshStatusBar();
	}

	display(): void {
		const el = this.containerEl;
		el.empty();
		const s = this.plugin.settings;
		new Setting(el).setName("Tasks").setHeading();
		new Setting(el).setName("Inbox note").setDesc("Where tasks added from the Tasks panel are written. Made if it does not exist.")
			.addText((t) => t.setPlaceholder("Tasks.md").setValue(s.inboxPath).onChange((v) => void this.set("inboxPath", v)));
		new Setting(el).setName("Excluded folders").setDesc("Tasks in these folders (and their folders) are not collected. One folder path per line.")
			.addTextArea((t) => t.setPlaceholder("Templates\nArchive").setValue(s.excludedFolders).onChange((v) => void this.set("excludedFolders", v)));
		new Setting(el).setName("Stamp the completion date").setDesc("When a task is checked off, add today's date (✅ 2026-11-13 or [completion:: 2026-11-13]). Reopening it removes the date.")
			.addToggle((t) => t.setValue(s.stampDoneDate).onChange((v) => void this.set("stampDoneDate", v)));
		new Setting(el).setName("Date and priority format").setDesc("How new dates and priorities are written. A task that already uses one format keeps it.")
			.addDropdown((d) => d.addOptions({ emoji: "Tasks emoji (📅 2026-11-13 ⏫)", dataview: "Dataview fields ([due:: 2026-11-13])" })
				.setValue(s.metadataFormat).onChange((v) => void this.set("metadataFormat", v as MetadataFormat)));
		new Setting(el).setName("Writing tasks").setHeading();
		new Setting(el).setName("Suggest dates and priorities while typing").setDesc("On a checklist line, type @ to set a due date, time or priority: @tomorrow, @fri 9am, @17:00, @3d, @high, @!!.")
			.addToggle((t) => t.setValue(s.inlineSuggest).onChange((v) => void this.set("inlineSuggest", v)));
		new Setting(el).setName("Trigger character").setDesc("What opens the suggestions. It only works at the start of a word on a checklist line, so e-mail addresses are safe.")
			.addText((t) => t.setPlaceholder("@").setValue(s.inlineTrigger).onChange((v) => void this.set("inlineTrigger", v)));
		new Setting(el).setName("Task actions in the editor menu").setDesc("Right-click a checklist line to set its due date or priority.")
			.addToggle((t) => t.setValue(s.editorMenu).onChange((v) => void this.set("editorMenu", v)));
		new Setting(el).setName("Tasks panel").setHeading();
		new Setting(el).setName("Default sort").setDesc("How tasks are ordered when Caselore starts.")
			.addDropdown((d) => d.addOptions(SORT_OPTIONS).setValue(s.defaultSort).onChange((v) => void this.set("defaultSort", v as SortMode)));
		new Setting(el).setName("Default grouping").setDesc("How tasks are grouped when Caselore starts.")
			.addDropdown((d) => d.addOptions(GROUP_OPTIONS).setValue(s.defaultGroup).onChange((v) => void this.set("defaultGroup", v as GroupMode)));
		new Setting(el).setName("Show due counts in the status bar").setDesc("Overdue and due-today counts at the bottom of the window. Click them to open the Tasks panel.")
			.addToggle((t) => t.setValue(s.showStatusBar).onChange((v) => void this.set("showStatusBar", v)));
	}
}
