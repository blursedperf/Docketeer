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

	constructor(app: App) {
		super(app);
		this.modalEl.addClass('mod-settings');
		this.titleEl.detach();
		const wrap = this.contentEl.createDiv({ cls: 'vertical-tabs-container' });
		this.navEl = wrap.createDiv({ cls: 'vertical-tab-header' });
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
				if (t === this.current) item.addClass('is-active');
				item.addEventListener('click', () => this.openTab(t));
			}
		};
		group('Options', this.coreTabs);
		group('Plugin options', [...this.pluginTabs].sort((a, b) => a.name.localeCompare(b.name)));
	}

	openTab(tab: SettingTab): void {
		this.current?.hide();
		this.current = tab;
		this.pageEl.empty();
		this.pageEl.appendChild(tab.containerEl);
		tab.containerEl.empty();
		tab.display();
		this.renderNav();
	}

	openTabById(id: string): void {
		const tab = [...this.coreTabs, ...this.pluginTabs].find((t) => t.id === id);
		if (!this.isOpen) this.open();
		if (tab) this.openTab(tab);
	}

	override onOpen(): void {
		this.isOpen = true;
		this.renderNav();
		this.openTab(this.current ?? this.coreTabs[0]!);
	}

	override onClose(): void {
		this.isOpen = false;
		this.current?.hide();
	}
}
