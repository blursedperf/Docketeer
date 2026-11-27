import { type App, PluginSettingTab, Setting } from "@quire/api";
import type WholeTreeSearchPlugin from "./main";

export interface WholeTreeSearchSettings {
	/** The most matches shown in the Docket (Show all lists up to 200). */
	maxResults: number;
	/** Characters to type after ~ before searching starts. */
	minQueryLength: number;
	caseSensitive: boolean;
	/** Skip matches inside a note's properties (YAML frontmatter). */
	skipFrontmatter: boolean;
	/** One folder per line; notes in them (and their folders) are never searched. */
	excludedFolders: string;
	/** Parent levels shown above the match (0: none, 1: the parent, more: further up). */
	ancestorLevels: number;
	includeChildren: boolean;
	/** Levels of children shown (0: all). */
	maxChildDepth: number;
	/** A blank line ends an outline (off: lists with blank lines between items). */
	stopAtBlankLines: boolean;
	/** Spaces a tab counts as when comparing indentation. */
	tabSize: number;
	/** The nearest heading above a match is shown first. */
	showHeading: boolean;
}

export const DEFAULT_SETTINGS: WholeTreeSearchSettings = {
	maxResults: 50,
	minQueryLength: 2,
	caseSensitive: false,
	skipFrontmatter: false,
	excludedFolders: "",
	ancestorLevels: 1,
	includeChildren: true,
	maxChildDepth: 0,
	stopAtBlankLines: true,
	tabSize: 4,
	showHeading: true,
};

/** Read saved settings, keeping defaults for anything missing or of the wrong kind (an Obsidian list of folders too). */
export function readSettings(data: unknown): WholeTreeSearchSettings {
	const out = { ...DEFAULT_SETTINGS };
	if (!data || typeof data !== "object") return out;
	const d = data as Record<string, unknown>;
	for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof WholeTreeSearchSettings)[]) {
		const v = key === "excludedFolders" && Array.isArray(d[key]) ? (d[key] as unknown[]).filter((x) => typeof x === "string").join("\n") : d[key];
		if (typeof v === typeof DEFAULT_SETTINGS[key]) (out as Record<string, unknown>)[key] = v;
	}
	return out;
}

/** The excluded folders, one per line, without slashes at either end. */
export function excludedFolders(s: WholeTreeSearchSettings): string[] {
	return s.excludedFolders.split("\n").map((f) => f.trim().replace(/^\/+|\/+$/g, "")).filter(Boolean);
}

export function isPathExcluded(path: string, folders: string[]): boolean {
	return folders.some((f) => path === f || path.startsWith(`${f}/`));
}

type Key = keyof WholeTreeSearchSettings;

export class WholeTreeSearchSettingTab extends PluginSettingTab {
	constructor(app: App, private plugin: WholeTreeSearchPlugin) {
		super(app, plugin);
	}

	private async set<K extends Key>(key: K, value: WholeTreeSearchSettings[K]): Promise<void> {
		this.plugin.settings[key] = value;
		await this.plugin.saveSettings();
	}

	private number(el: HTMLElement, key: "maxResults" | "minQueryLength" | "ancestorLevels" | "maxChildDepth" | "tabSize", name: string, desc: string, min: number, max: number): void {
		new Setting(el).setName(name).setDesc(desc).addText((t) => {
			t.inputEl.type = "number";
			t.inputEl.min = String(min);
			t.inputEl.max = String(max);
			t.setValue(String(this.plugin.settings[key])).onChange((v) => {
				const n = Math.floor(Number(v));
				if (Number.isFinite(n) && n >= min && n <= max) void this.set(key, n);
			});
		});
	}

	display(): void {
		const el = this.containerEl;
		el.empty();
		const s = this.plugin.settings;
		new Setting(el).setName("Searching").setHeading();
		this.number(el, "maxResults", "Matches shown", "How many matches the Docket lists at first; Show all lists up to 200.", 1, 200);
		this.number(el, "minQueryLength", "Letters before searching", "How many letters to type after ~ before searching starts.", 1, 10);
		new Setting(el).setName("Match case").setDesc("Find “Duty” but not “duty”.")
			.addToggle((t) => t.setValue(s.caseSensitive).onChange((v) => void this.set("caseSensitive", v)));
		new Setting(el).setName("Skip properties").setDesc("Leave out matches in a note's properties at its top.")
			.addToggle((t) => t.setValue(s.skipFrontmatter).onChange((v) => void this.set("skipFrontmatter", v)));
		new Setting(el).setName("Excluded folders").setDesc("Notes in these folders (and the folders inside them) are never searched. One folder path per line.")
			.addTextArea((t) => t.setPlaceholder("Templates\nArchive").setValue(s.excludedFolders).onChange((v) => void this.set("excludedFolders", v)));
		new Setting(el).setName("Each match").setHeading();
		new Setting(el).setName("Show the heading above").setDesc("The nearest heading over the match comes first, so you can tell which part of the note it is in.")
			.addToggle((t) => t.setValue(s.showHeading).onChange((v) => void this.set("showHeading", v)));
		this.number(el, "ancestorLevels", "Parent levels", "Items shown above the match: 0 for none, 1 for its parent, more to go further up.", 0, 20);
		new Setting(el).setName("Show what is nested under it").setDesc("The items indented under the match.")
			.addToggle((t) => t.setValue(s.includeChildren).onChange((v) => void this.set("includeChildren", v)));
		this.number(el, "maxChildDepth", "Nested levels", "How many levels under the match to show: 0 for all.", 0, 20);
		new Setting(el).setName("A blank line ends an outline").setDesc("Turn off for lists with blank lines between their items.")
			.addToggle((t) => t.setValue(s.stopAtBlankLines).onChange((v) => void this.set("stopAtBlankLines", v)));
		this.number(el, "tabSize", "Tab width", "How many spaces a tab counts as, for notes that mix tabs and spaces.", 1, 8);
	}
}
