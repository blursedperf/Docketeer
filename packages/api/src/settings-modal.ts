import type { App } from './app';
import { Modal, type SettingTab } from './ui';

/** The settings dialog: core pages, then a page per plugin that has one. */
export class SettingsModal extends Modal {
	coreTabs: SettingTab[] = [];
	pluginTabs: SettingTab[] = [];
	private navEl: HTMLElement;
	private pageEl: HTMLElement;
	private current: SettingTab | null = null;
	private isOpen = false;
	private currentEl: HTMLElement;
	private searchEl: HTMLInputElement;
	private searching = false;

	constructor(app: App) {
		super(app);
		this.modalEl.addClass('mod-settings');
		this.titleEl.detach();
		const bar = this.contentEl.createDiv({ cls: 'settings-titlebar' });
		bar.createSpan({ text: 'Settings ›' });
		this.currentEl = bar.createSpan({ cls: 'settings-titlebar-current' });
		const wrap = this.contentEl.createDiv({ cls: 'vertical-tabs-container' });
		const side = wrap.createDiv({ cls: 'vertical-tab-sidebar' });
		this.searchEl = side.createEl('input', { cls: 'settings-search', attr: { type: 'search', placeholder: 'Search settings…', spellcheck: 'false', 'aria-label': 'Search settings' } });
		this.searchEl.addEventListener('input', () => this.search(this.searchEl.value));
		this.searchEl.addEventListener('keydown', (e) => {
			if (e.key === 'Escape' && this.searchEl.value) { e.preventDefault(); e.stopPropagation(); this.searchEl.value = ''; this.search(''); }
		});
		this.navEl = side.createDiv({ cls: 'vertical-tab-header' });
		this.pageEl = wrap.createDiv({ cls: 'vertical-tab-content-container' });
	}

	addCoreTab(tab: SettingTab): void { this.coreTabs.push(tab); if (this.isOpen) this.renderNav(); }

	addSettingTab(tab: SettingTab): void {
		this.pluginTabs.push(tab);
		if (this.isOpen) this.renderNav();
	}

	removeSettingTab(tab: SettingTab): void {
		this.pluginTabs = this.pluginTabs.filter((t) => t !== tab);
		if (this.current === tab) { tab.hide(); this.current = null; if (this.isOpen) this.openTab(this.coreTabs[0]!); }
		if (this.isOpen) this.renderNav();
	}

	private renderNav() {
		this.navEl.empty();
		const group = (title: string, tabs: SettingTab[]) => {
			if (!tabs.length) return;
			this.navEl.createDiv({ cls: 'vertical-tab-header-group-title', text: title });
			for (const t of tabs) {
				const item = this.navEl.createDiv({ cls: 'vertical-tab-nav-item', text: t.name });
				if (t === this.current && !this.searching) item.addClass('is-active');
				item.addEventListener('click', () => this.openTab(t));
			}
		};
		group('Options', this.coreTabs);
		group('Plugin options', [...this.pluginTabs].sort((a, b) => a.name.localeCompare(b.name)));
	}

	/**
	 * Show the settings of every page whose name or description has all the words of `query`, grouped
	 * by page. The rows are the pages' own, so their controls work as usual.
	 */
	search(query: string): void {
		const words = query.toLowerCase().split(/\s+/).filter(Boolean);
		if (words.length === 0) {
			if (this.searching) { this.searching = false; this.openTab(this.current ?? this.coreTabs[0]!); }
			return;
		}
		this.searching = true;
		if (this.searchEl.value !== query) this.searchEl.value = query;
		this.current?.hide();
		this.pageEl.empty();
		this.pageEl.scrollTop = 0;
		this.renderNav();
		this.currentEl.setText(`Search: ${query.trim()}`);
		const results = this.pageEl.createDiv({ cls: 'vertical-tab-content settings-search-results' });
		let found = 0;
		for (const tab of [...this.coreTabs, ...[...this.pluginTabs].sort((a, b) => a.name.localeCompare(b.name))]) {
			tab.containerEl.empty();
			try { tab.display(); } catch (e) { console.error(`Settings page ${tab.name} failed`, e); continue; }
			const rows = [...tab.containerEl.querySelectorAll<HTMLElement>('.setting-item:not(.setting-item-heading):not(.mod-buttons)')].filter((row) => {
				const text = `${row.querySelector('.setting-item-name')?.textContent ?? ''} ${row.querySelector('.setting-item-description')?.textContent ?? ''}`.toLowerCase();
				return words.every((w) => text.includes(w));
			});
			if (rows.length === 0) continue;
			found += rows.length;
			const head = results.createDiv({ cls: 'setting-item setting-item-heading settings-search-group' });
			const name = head.createDiv({ cls: 'setting-item-info' }).createDiv({ cls: 'setting-item-name', text: tab.name });
			name.addEventListener('click', () => { this.searchEl.value = ''; this.searching = false; this.openTab(tab); });
			for (const row of rows) results.appendChild(row);
		}
		if (found === 0) results.createDiv({ cls: 'settings-search-empty', text: `No settings match "${query.trim()}".` });
	}

	openTab(tab: SettingTab): void {
		if (this.searching) { this.searching = false; this.searchEl.value = ''; }
		this.current?.hide();
		this.current = tab;
		this.pageEl.empty();
		this.pageEl.scrollTop = 0;
		this.pageEl.appendChild(tab.containerEl);
		tab.containerEl.empty();
		tab.display();
		this.currentEl.setText(tab.name);
		this.renderNav();
	}

	openTabById(id: string): void {
		const tab = [...this.coreTabs, ...this.pluginTabs].find((t) => t.id === id);
		if (!this.isOpen) this.open();
		if (tab) this.openTab(tab);
	}

	override onOpen(): void {
		this.isOpen = true;
		this.searchEl.value = '';
		this.searching = false;
		this.renderNav();
		this.openTab(this.current ?? this.coreTabs[0]!);
	}

	override onClose(): void {
		this.isOpen = false;
		this.current?.hide();
	}
}
