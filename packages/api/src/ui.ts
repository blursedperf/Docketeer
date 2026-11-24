import type { App } from './app';
import { Component } from './component';
import { setIcon } from './icons';
import { fuzzyScore } from './util';

// -------------------------------------------------------------------------------------------------
// Notice

function noticeContainer(): HTMLElement {
	let el = document.body.querySelector<HTMLElement>(':scope > .notice-container');
	if (!el) el = document.body.createDiv({ cls: 'notice-container' });
	return el;
}

/** A short message in the corner. `duration` 0 keeps it until clicked. */
export class Notice {
	noticeEl: HTMLElement;
	messageEl: HTMLElement;
	containerEl: HTMLElement;
	private _timer: number | null = null;

	constructor(message: string | DocumentFragment, duration = 5000) {
		this.containerEl = noticeContainer();
		this.noticeEl = this.containerEl.createDiv({ cls: 'notice' });
		this.messageEl = this.noticeEl.createDiv({ cls: 'notice-message' });
		this.setMessage(message);
		this.noticeEl.addEventListener('click', () => this.hide());
		if (duration > 0) this._timer = window.setTimeout(() => this.hide(), duration);
		(globalThis as { __quireNotices?: string[] }).__quireNotices?.push(typeof message === 'string' ? message : message.textContent ?? '');
	}

	setMessage(message: string | DocumentFragment): this {
		this.messageEl.setText(message);
		return this;
	}

	hide(): void {
		if (this._timer !== null) window.clearTimeout(this._timer);
		this._timer = null;
		this.noticeEl.addClass('is-hiding');
		window.setTimeout(() => this.noticeEl.detach(), 150);
	}
}

// -------------------------------------------------------------------------------------------------
// Modal

const openModals: Modal[] = [];

export function topModal(): Modal | null {
	return openModals[openModals.length - 1] ?? null;
}

/** A dialog over the app. Subclasses fill `contentEl` in `onOpen()`. */
export class Modal {
	app: App;
	containerEl: HTMLElement;
	modalEl: HTMLElement;
	titleEl: HTMLElement;
	contentEl: HTMLElement;
	shouldRestoreSelection = true;
	private _bgEl: HTMLElement;
	private _previousFocus: Element | null = null;
	private _keyHandler = (e: KeyboardEvent) => this.onKey(e);
	private _onCloseCallback: (() => void) | null = null;

	constructor(app: App) {
		this.app = app;
		this.containerEl = createDiv({ cls: 'modal-container' });
		this._bgEl = this.containerEl.createDiv({ cls: 'modal-bg' });
		this.modalEl = this.containerEl.createDiv({ cls: 'modal', attr: { role: 'dialog', 'aria-modal': 'true' } });
		const close = this.modalEl.createDiv({ cls: 'modal-close-button', attr: { 'aria-label': 'Close' } });
		setIcon(close, 'x');
		close.addEventListener('click', () => this.close());
		this.titleEl = this.modalEl.createDiv({ cls: 'modal-title' });
		this.contentEl = this.modalEl.createDiv({ cls: 'modal-content' });
		this._bgEl.addEventListener('click', () => this.close());
	}

	setTitle(title: string): this {
		this.titleEl.setText(title);
		return this;
	}

	setContent(content: string | DocumentFragment): this {
		this.contentEl.setText(content);
		return this;
	}

	setCloseCallback(cb: () => void): this {
		this._onCloseCallback = cb;
		return this;
	}

	open(): void {
		this._previousFocus = document.activeElement;
		document.body.appendChild(this.containerEl);
		openModals.push(this);
		window.addEventListener('keydown', this._keyHandler, true);
		this.onOpen();
		if (!this.modalEl.contains(document.activeElement)) {
			const focusable = this.modalEl.querySelector<HTMLElement>('input, textarea, select, button.mod-cta, button');
			(focusable ?? this.modalEl).focus();
		}
	}

	close(): void {
		const i = openModals.indexOf(this);
		if (i === -1) return;
		openModals.splice(i, 1);
		window.removeEventListener('keydown', this._keyHandler, true);
		this.containerEl.detach();
		this.onClose();
		this._onCloseCallback?.();
		if (this.shouldRestoreSelection && this._previousFocus instanceof HTMLElement) this._previousFocus.focus();
	}

	onOpen(): void {}
	onClose(): void {}

	/** Keys while this is the top dialog. */
	protected onKey(e: KeyboardEvent): void {
		if (topModal() !== this) return;
		if ((e.target as HTMLElement | null)?.closest?.('.is-recording-hotkey')) return;
		if (e.key === 'Escape') {
			e.preventDefault();
			e.stopPropagation();
			this.close();
		}
	}
}

// -------------------------------------------------------------------------------------------------
// SuggestModal

export interface Instruction { command: string; purpose: string; }

/** A searchable list: type to filter, arrows to move, Enter to choose. */
export abstract class SuggestModal<T> extends Modal {
	limit = 100;
	emptyStateText = 'No results found.';
	inputEl: HTMLInputElement;
	resultContainerEl: HTMLElement;
	private _instructionsEl: HTMLElement;
	private _items: T[] = [];
	private _selected = 0;
	private _generation = 0;

	constructor(app: App) {
		super(app);
		this.modalEl.addClass('prompt');
		this.containerEl.addClass('mod-prompt');
		this.titleEl.detach();
		this.modalEl.querySelector('.modal-close-button')?.detach();
		const inputWrap = this.modalEl.createDiv({ cls: 'prompt-input-container' });
		this.inputEl = inputWrap.createEl('input', { cls: 'prompt-input', attr: { type: 'text', spellcheck: 'false', enterkeyhint: 'done' } });
		this.resultContainerEl = this.modalEl.createDiv({ cls: 'prompt-results' });
		this._instructionsEl = this.modalEl.createDiv({ cls: 'prompt-instructions' });
		this._instructionsEl.hide();
		this.contentEl.detach();
		this.modalEl.insertBefore(inputWrap, this.modalEl.firstChild);
		this.inputEl.addEventListener('input', () => { void this.updateSuggestions(); });
	}

	setPlaceholder(placeholder: string): void {
		this.inputEl.placeholder = placeholder;
	}

	setInstructions(instructions: Instruction[]): void {
		this._instructionsEl.empty();
		this._instructionsEl.toggle(instructions.length > 0);
		for (const i of instructions) {
			const el = this._instructionsEl.createDiv({ cls: 'prompt-instruction' });
			el.createSpan({ cls: 'prompt-instruction-command', text: i.command });
			el.createSpan({ text: i.purpose });
		}
	}

	override onOpen(): void {
		this.inputEl.focus();
		void this.updateSuggestions();
	}

	abstract getSuggestions(query: string): T[] | Promise<T[]>;
	abstract renderSuggestion(value: T, el: HTMLElement): void;
	abstract onChooseSuggestion(item: T, evt: MouseEvent | KeyboardEvent): void;

	onNoSuggestion(): void {
		this.resultContainerEl.empty();
		this.resultContainerEl.createDiv({ cls: 'suggestion-empty', text: this.emptyStateText });
	}

	async updateSuggestions(): Promise<void> {
		const gen = ++this._generation;
		const items = await this.getSuggestions(this.inputEl.value);
		if (gen !== this._generation) return;
		this._items = items.slice(0, this.limit);
		this._selected = 0;
		this.resultContainerEl.empty();
		if (this._items.length === 0) {
			this.onNoSuggestion();
			return;
		}
		this._items.forEach((item, i) => {
			const el = this.resultContainerEl.createDiv({ cls: 'suggestion-item' });
			this.renderSuggestion(item, el);
			el.addEventListener('mousemove', () => this._select(i, false));
			el.addEventListener('click', (e) => this._choose(i, e));
		});
		this._select(0, false);
	}

	private _select(i: number, scroll = true) {
		const els = this.resultContainerEl.querySelectorAll('.suggestion-item');
		els[this._selected]?.removeClass('is-selected');
		this._selected = Math.max(0, Math.min(this._items.length - 1, i));
		const el = els[this._selected] as HTMLElement | undefined;
		el?.addClass('is-selected');
		if (scroll) el?.scrollIntoView({ block: 'nearest' });
	}

	private _choose(i: number, e: MouseEvent | KeyboardEvent) {
		const item = this._items[i];
		if (item === undefined) return;
		this.close();
		this.onChooseSuggestion(item, e);
	}

	selectSuggestion(value: T, evt: MouseEvent | KeyboardEvent): void {
		this.close();
		this.onChooseSuggestion(value, evt);
	}

	protected override onKey(e: KeyboardEvent): void {
		if (topModal() !== this) return;
		if (e.key === 'ArrowDown' || (e.ctrlKey && e.key === 'n')) { e.preventDefault(); this._select(this._selected + 1); return; }
		if (e.key === 'ArrowUp' || (e.ctrlKey && e.key === 'p')) { e.preventDefault(); this._select(this._selected - 1); return; }
		if (e.key === 'PageDown') { e.preventDefault(); this._select(this._selected + 8); return; }
		if (e.key === 'PageUp') { e.preventDefault(); this._select(this._selected - 8); return; }
		if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); e.stopPropagation(); this._choose(this._selected, e); return; }
		super.onKey(e);
	}
}

export interface FuzzyMatch<T> { item: T; score: number; }

/** A SuggestModal that filters `getItems()` by fuzzy match on `getItemText()`. */
export abstract class FuzzySuggestModal<T> extends SuggestModal<FuzzyMatch<T>> {
	abstract getItems(): T[];
	abstract getItemText(item: T): string;
	abstract onChooseItem(item: T, evt: MouseEvent | KeyboardEvent): void;

	getSuggestions(query: string): FuzzyMatch<T>[] {
		const out: FuzzyMatch<T>[] = [];
		for (const item of this.getItems()) {
			const score = fuzzyScore(query, this.getItemText(item));
			if (score !== null) out.push({ item, score });
		}
		return query.trim() ? out.sort((a, b) => b.score - a.score) : out;
	}

	renderSuggestion(m: FuzzyMatch<T>, el: HTMLElement): void {
		el.setText(this.getItemText(m.item));
	}

	onChooseSuggestion(m: FuzzyMatch<T>, evt: MouseEvent | KeyboardEvent): void {
		this.onChooseItem(m.item, evt);
	}
}

// -------------------------------------------------------------------------------------------------
// Menu

export class MenuItem {
	dom: HTMLElement;
	private iconEl: HTMLElement;
	private titleEl: HTMLElement;
	private handler: ((evt: MouseEvent | KeyboardEvent) => unknown) | null = null;
	section = '';
	disabled = false;

	constructor(private menu: Menu) {
		this.dom = createDiv({ cls: 'menu-item' });
		this.iconEl = this.dom.createDiv({ cls: 'menu-item-icon' });
		this.titleEl = this.dom.createDiv({ cls: 'menu-item-title' });
		this.dom.addEventListener('click', (e) => {
			if (this.disabled) return;
			this.menu.hide();
			this.handler?.(e);
		});
	}

	setTitle(title: string | DocumentFragment): this { this.titleEl.setText(title); return this; }
	setIcon(icon: string | null): this { if (icon) setIcon(this.iconEl, icon); else this.iconEl.empty(); return this; }
	setChecked(checked: boolean | null): this { this.dom.toggleClass('is-checked', !!checked); if (checked) setIcon(this.iconEl, 'check'); return this; }
	setDisabled(disabled: boolean): this { this.disabled = disabled; this.dom.toggleClass('is-disabled', disabled); return this; }
	setIsLabel(label: boolean): this { this.dom.toggleClass('is-label', label); return this; }
	setWarning(warning: boolean): this { this.dom.toggleClass('is-warning', warning); return this; }
	setSection(section: string): this { this.section = section; return this; }
	onClick(cb: (evt: MouseEvent | KeyboardEvent) => unknown): this { this.handler = cb; return this; }
}

/** A context menu. */
export class Menu extends Component {
	dom: HTMLElement;
	private _items: (MenuItem | 'separator')[] = [];
	private _hideCallbacks: (() => unknown)[] = [];
	private _outside = (e: MouseEvent) => { if (!this.dom.contains(e.target as Node)) this.hide(); };
	private _keys = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); this.hide(); } };

	constructor() {
		super();
		this.dom = createDiv({ cls: 'menu' });
	}

	/** The items added so far (for offering a menu's actions elsewhere, such as in the Docket). */
	listItems(): { title: string; icon: string | null; warning: boolean; run(): void }[] {
		return this._items.filter((i): i is MenuItem => i !== 'separator' && !i.disabled).map((i) => ({
			title: i.dom.querySelector('.menu-item-title')?.textContent ?? '',
			icon: (i.dom.querySelector('.menu-item-icon') as HTMLElement | null)?.dataset.icon ?? null,
			warning: i.dom.classList.contains('is-warning'),
			run: () => i.dom.click(),
		}));
	}

	addItem(cb: (item: MenuItem) => unknown): this {
		const item = new MenuItem(this);
		cb(item);
		this._items.push(item);
		return this;
	}

	addSeparator(): this {
		this._items.push('separator');
		return this;
	}

	setNoIcon(): this { this.dom.addClass('mod-no-icon'); return this; }

	showAtMouseEvent(evt: MouseEvent): this {
		evt.preventDefault();
		return this.showAtPosition({ x: evt.clientX, y: evt.clientY });
	}

	showAtPosition(pos: { x: number; y: number }): this {
		this.dom.empty();
		let last: 'separator' | null = 'separator';
		for (const it of this._items) {
			if (it === 'separator') {
				if (last !== 'separator') this.dom.createDiv({ cls: 'menu-separator' });
				last = 'separator';
			} else {
				this.dom.appendChild(it.dom);
				last = null;
			}
		}
		document.body.appendChild(this.dom);
		const r = this.dom.getBoundingClientRect();
		const x = Math.min(pos.x, window.innerWidth - r.width - 4);
		const y = Math.min(pos.y, window.innerHeight - r.height - 4);
		this.dom.setCssStyles({ left: `${Math.max(4, x)}px`, top: `${Math.max(4, y)}px` });
		window.setTimeout(() => {
			document.addEventListener('mousedown', this._outside, true);
			window.addEventListener('keydown', this._keys, true);
		}, 0);
		this.load();
		return this;
	}

	hide(): this {
		document.removeEventListener('mousedown', this._outside, true);
		window.removeEventListener('keydown', this._keys, true);
		if (this.dom.parentNode) {
			this.dom.detach();
			for (const cb of this._hideCallbacks) cb();
		}
		this.unload();
		return this;
	}

	close(): void { this.hide(); }

	onHide(cb: () => unknown): void { this._hideCallbacks.push(cb); }
}

// -------------------------------------------------------------------------------------------------
// Setting and its controls

abstract class ValueComponent<T> {
	protected changeHandlers: ((v: T) => unknown)[] = [];
	disabled = false;
	abstract getValue(): T;
	abstract setValue(v: T): this;
	onChange(cb: (v: T) => unknown): this { this.changeHandlers.push(cb); return this; }
	protected changed(): void { const v = this.getValue(); for (const h of this.changeHandlers) h(v); }
	registerOptionListener(listeners: Record<string, (value?: T) => T>, key: string): this {
		this.onChange((v) => listeners[key]?.(v));
		return this;
	}
}

export class ButtonComponent {
	buttonEl: HTMLButtonElement;
	disabled = false;
	constructor(containerEl: HTMLElement) {
		this.buttonEl = containerEl.createEl('button');
	}
	setButtonText(text: string): this { this.buttonEl.setText(text); return this; }
	setIcon(icon: string): this { setIcon(this.buttonEl, icon); this.buttonEl.addClass('mod-icon'); return this; }
	setCta(): this { this.buttonEl.addClass('mod-cta'); return this; }
	removeCta(): this { this.buttonEl.removeClass('mod-cta'); return this; }
	setWarning(): this { this.buttonEl.addClass('mod-warning'); return this; }
	setTooltip(tip: string): this { this.buttonEl.setAttribute('aria-label', tip); this.buttonEl.title = tip; return this; }
	setClass(cls: string): this { this.buttonEl.addClass(cls); return this; }
	setDisabled(d: boolean): this { this.disabled = d; this.buttonEl.disabled = d; return this; }
	onClick(cb: (evt: MouseEvent) => unknown): this { this.buttonEl.addEventListener('click', cb); return this; }
}

export class ExtraButtonComponent {
	extraSettingsEl: HTMLElement;
	disabled = false;
	constructor(containerEl: HTMLElement) {
		this.extraSettingsEl = containerEl.createDiv({ cls: 'clickable-icon extra-setting-button' });
		setIcon(this.extraSettingsEl, 'settings');
	}
	setIcon(icon: string): this { setIcon(this.extraSettingsEl, icon); return this; }
	setTooltip(tip: string): this { this.extraSettingsEl.setAttribute('aria-label', tip); this.extraSettingsEl.title = tip; return this; }
	setDisabled(d: boolean): this { this.disabled = d; this.extraSettingsEl.toggleClass('is-disabled', d); return this; }
	onClick(cb: () => unknown): this { this.extraSettingsEl.addEventListener('click', () => { if (!this.disabled) cb(); }); return this; }
}

export class ToggleComponent extends ValueComponent<boolean> {
	toggleEl: HTMLElement;
	private value = false;
	constructor(containerEl: HTMLElement) {
		super();
		this.toggleEl = containerEl.createDiv({ cls: 'checkbox-container', attr: { role: 'switch', tabindex: '0' } });
		this.toggleEl.createEl('input', { attr: { type: 'checkbox', tabindex: '-1' } });
		const flip = () => { if (!this.disabled) { this.setValue(!this.value); this.changed(); } };
		this.toggleEl.addEventListener('click', (e) => { e.preventDefault(); flip(); });
		this.toggleEl.addEventListener('keydown', (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); flip(); } });
	}
	getValue(): boolean { return this.value; }
	setValue(v: boolean): this { this.value = !!v; this.toggleEl.toggleClass('is-enabled', this.value); this.toggleEl.setAttr('aria-checked', String(this.value)); return this; }
	setDisabled(d: boolean): this { this.disabled = d; this.toggleEl.toggleClass('is-disabled', d); return this; }
	setTooltip(tip: string): this { this.toggleEl.setAttribute('aria-label', tip); return this; }
	onClick(): void { this.setValue(!this.value); this.changed(); }
}

export class TextComponent extends ValueComponent<string> {
	inputEl: HTMLInputElement;
	constructor(containerEl: HTMLElement) {
		super();
		this.inputEl = containerEl.createEl('input', { attr: { type: 'text', spellcheck: 'false' } });
		this.inputEl.addEventListener('input', () => this.changed());
	}
	getValue(): string { return this.inputEl.value; }
	setValue(v: string): this { this.inputEl.value = v ?? ''; return this; }
	setPlaceholder(p: string): this { this.inputEl.placeholder = p; return this; }
	setDisabled(d: boolean): this { this.disabled = d; this.inputEl.disabled = d; return this; }
	onChanged(): void { this.changed(); }
}

export class SearchComponent extends TextComponent {
	constructor(containerEl: HTMLElement) {
		super(containerEl);
		this.inputEl.type = 'search';
		this.inputEl.addClass('search-input');
	}
	clearButtonEl: HTMLElement = createDiv();
}

export class TextAreaComponent extends ValueComponent<string> {
	inputEl: HTMLTextAreaElement;
	constructor(containerEl: HTMLElement) {
		super();
		this.inputEl = containerEl.createEl('textarea', { attr: { spellcheck: 'false' } });
		this.inputEl.addEventListener('input', () => this.changed());
	}
	getValue(): string { return this.inputEl.value; }
	setValue(v: string): this { this.inputEl.value = v ?? ''; return this; }
	setPlaceholder(p: string): this { this.inputEl.placeholder = p; return this; }
	setDisabled(d: boolean): this { this.disabled = d; this.inputEl.disabled = d; return this; }
}

export class SliderComponent extends ValueComponent<number> {
	sliderEl: HTMLInputElement;
	private valueEl: HTMLElement;
	constructor(containerEl: HTMLElement) {
		super();
		const wrap = containerEl.createDiv({ cls: 'slider-wrap' });
		this.sliderEl = wrap.createEl('input', { cls: 'slider', attr: { type: 'range' } });
		this.valueEl = wrap.createSpan({ cls: 'slider-value' });
		this.sliderEl.addEventListener('input', () => { this.valueEl.setText(this.sliderEl.value); this.changed(); });
	}
	setLimits(min: number | null, max: number | null, step: number | 'any'): this {
		if (min !== null) this.sliderEl.min = String(min);
		if (max !== null) this.sliderEl.max = String(max);
		this.sliderEl.step = String(step);
		return this;
	}
	getValue(): number { return Number(this.sliderEl.value); }
	setValue(v: number): this { this.sliderEl.value = String(v); this.valueEl.setText(String(v)); return this; }
	setDynamicTooltip(): this { return this; }
	setInstant(): this { return this; }
	showTooltip(): void {}
	getValuePretty(): string { return this.sliderEl.value; }
	setDisabled(d: boolean): this { this.disabled = d; this.sliderEl.disabled = d; return this; }
}

export class DropdownComponent extends ValueComponent<string> {
	selectEl: HTMLSelectElement;
	constructor(containerEl: HTMLElement) {
		super();
		this.selectEl = containerEl.createEl('select', { cls: 'dropdown' });
		this.selectEl.addEventListener('change', () => this.changed());
	}
	addOption(value: string, display: string): this { this.selectEl.createEl('option', { text: display, attr: { value } }); return this; }
	addOptions(options: Record<string, string>): this { for (const [v, d] of Object.entries(options)) this.addOption(v, d); return this; }
	getValue(): string { return this.selectEl.value; }
	setValue(v: string): this { this.selectEl.value = v; return this; }
	setDisabled(d: boolean): this { this.disabled = d; this.selectEl.disabled = d; return this; }
}

export class ColorComponent extends ValueComponent<string> {
	colorPickerEl: HTMLInputElement;
	constructor(containerEl: HTMLElement) {
		super();
		this.colorPickerEl = containerEl.createEl('input', { cls: 'color-picker', attr: { type: 'color' } });
		this.colorPickerEl.addEventListener('input', () => this.changed());
	}
	getValue(): string { return this.colorPickerEl.value; }
	setValue(v: string): this { if (/^#[0-9a-f]{6}$/i.test(v)) this.colorPickerEl.value = v; return this; }
	setDisabled(d: boolean): this { this.disabled = d; this.colorPickerEl.disabled = d; return this; }
}

/** One row of a settings page: a name, a description and controls. */
export class Setting {
	settingEl: HTMLElement;
	infoEl: HTMLElement;
	nameEl: HTMLElement;
	descEl: HTMLElement;
	controlEl: HTMLElement;
	components: unknown[] = [];

	constructor(containerEl: HTMLElement) {
		this.settingEl = containerEl.createDiv({ cls: 'setting-item' });
		this.infoEl = this.settingEl.createDiv({ cls: 'setting-item-info' });
		this.nameEl = this.infoEl.createDiv({ cls: 'setting-item-name' });
		this.descEl = this.infoEl.createDiv({ cls: 'setting-item-description' });
		this.controlEl = this.settingEl.createDiv({ cls: 'setting-item-control' });
		// Until it gets a name or description, the row holds only controls (eg a row of buttons).
		this.settingEl.addClass('mod-buttons');
	}

	setName(name: string | DocumentFragment): this { this.nameEl.setText(name); this.settingEl.removeClass('mod-buttons'); return this; }
	setDesc(desc: string | DocumentFragment): this { this.descEl.setText(desc); this.settingEl.removeClass('mod-buttons'); return this; }
	setClass(cls: string): this { this.settingEl.addClass(cls); return this; }
	setTooltip(tip: string): this { this.nameEl.title = tip; return this; }
	setHeading(): this { this.settingEl.addClass('setting-item-heading'); return this; }
	setDisabled(d: boolean): this { this.settingEl.toggleClass('is-disabled', d); return this; }
	then(cb: (s: this) => unknown): this { cb(this); return this; }
	clear(): this { this.controlEl.empty(); this.components = []; return this; }

	private add<C>(c: C, cb: (c: C) => unknown): this {
		this.components.push(c);
		cb(c);
		return this;
	}

	addButton(cb: (c: ButtonComponent) => unknown): this { return this.add(new ButtonComponent(this.controlEl), cb); }
	addExtraButton(cb: (c: ExtraButtonComponent) => unknown): this { return this.add(new ExtraButtonComponent(this.controlEl), cb); }
	addToggle(cb: (c: ToggleComponent) => unknown): this { return this.add(new ToggleComponent(this.controlEl), cb); }
	addText(cb: (c: TextComponent) => unknown): this { return this.add(new TextComponent(this.controlEl), cb); }
	addSearch(cb: (c: SearchComponent) => unknown): this { return this.add(new SearchComponent(this.controlEl), cb); }
	addTextArea(cb: (c: TextAreaComponent) => unknown): this { return this.add(new TextAreaComponent(this.controlEl), cb); }
	addSlider(cb: (c: SliderComponent) => unknown): this { return this.add(new SliderComponent(this.controlEl), cb); }
	addDropdown(cb: (c: DropdownComponent) => unknown): this { return this.add(new DropdownComponent(this.controlEl), cb); }
	addColorPicker(cb: (c: ColorComponent) => unknown): this { return this.add(new ColorComponent(this.controlEl), cb); }
}

/** A page of the settings dialog. */
export abstract class SettingTab {
	app: App;
	containerEl: HTMLElement;
	id = '';
	name = '';
	icon = 'settings';
	constructor(app: App) {
		this.app = app;
		this.containerEl = createDiv({ cls: 'vertical-tab-content' });
	}
	abstract display(): void;
	hide(): void { this.containerEl.empty(); }
}

/** A plugin's page of the settings dialog. */
export abstract class PluginSettingTab extends SettingTab {
	constructor(app: App, plugin: { manifest: { id: string; name: string } }) {
		super(app);
		this.id = plugin.manifest.id;
		this.name = plugin.manifest.name;
	}
}

/**
 * A settings page described as data (the declarative form). Not rendered by API v0: plugins also define
 * `display()`, which is used.
 */
export interface SettingDefinitionItem {
	type?: string;
	heading?: string;
	name?: string;
	desc?: string;
	items?: SettingDefinitionItem[];
	action?: () => unknown;
	control?: Record<string, unknown>;
	[key: string]: unknown;
}
