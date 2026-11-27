/**
 * Small DOM helpers on HTMLElement, and global createEl/createDiv/createSpan/createFragment.
 * Plugins written for Obsidian-style APIs use these everywhere; installing them once here means plugin
 * view code ports unchanged.
 */

export interface DomElementInfo {
	cls?: string | string[];
	text?: string | DocumentFragment;
	attr?: Record<string, string | number | boolean | null>;
	title?: string;
	value?: string;
	type?: string;
	placeholder?: string;
	href?: string;
	parent?: Node;
	prepend?: boolean;
}

type Callback<T> = (el: T) => void;

declare global {
	interface Node {
		empty(): void;
		detach(): void;
		createEl<K extends keyof HTMLElementTagNameMap>(tag: K, o?: DomElementInfo | string, callback?: Callback<HTMLElementTagNameMap[K]>): HTMLElementTagNameMap[K];
		createDiv(o?: DomElementInfo | string, callback?: Callback<HTMLDivElement>): HTMLDivElement;
		createSpan(o?: DomElementInfo | string, callback?: Callback<HTMLSpanElement>): HTMLSpanElement;
		appendText(text: string): void;
		/** The document and window this node is in (Obsidian's names, for its pop-out windows; here always the one). */
		readonly doc: Document;
		readonly win: Window;
		createSvg<K extends keyof SVGElementTagNameMap>(tag: K, o?: SvgElementInfo | string, callback?: Callback<SVGElementTagNameMap[K]>): SVGElementTagNameMap[K];
	}
	interface Element {
		setText(text: string | DocumentFragment): void;
		addClass(...cls: string[]): void;
		addClasses(cls: string[]): void;
		removeClass(...cls: string[]): void;
		toggleClass(cls: string | string[], on: boolean): void;
		hasClass(cls: string): boolean;
		setAttr(name: string, value: string | number | boolean | null): void;
		setAttrs(obj: Record<string, string | number | boolean | null>): void;
		getText(): string;
		find(selector: string): HTMLElement | null;
		findAll(selector: string): HTMLElement[];
	}
	interface HTMLElement {
		show(): void;
		hide(): void;
		toggle(show: boolean): void;
		isShown(): boolean;
		setCssStyles(styles: Partial<CSSStyleDeclaration>): void;
		setCssProps(props: Record<string, string>): void;
		onClickEvent(listener: (ev: MouseEvent) => unknown, options?: boolean | AddEventListenerOptions): void;
	}
	function createEl<K extends keyof HTMLElementTagNameMap>(tag: K, o?: DomElementInfo | string, callback?: Callback<HTMLElementTagNameMap[K]>): HTMLElementTagNameMap[K];
	function createDiv(o?: DomElementInfo | string, callback?: Callback<HTMLDivElement>): HTMLDivElement;
	function createSpan(o?: DomElementInfo | string, callback?: Callback<HTMLSpanElement>): HTMLSpanElement;
	function createFragment(callback?: Callback<DocumentFragment>): DocumentFragment;
	function createSvg<K extends keyof SVGElementTagNameMap>(tag: K, o?: SvgElementInfo | string, callback?: Callback<SVGElementTagNameMap[K]>): SVGElementTagNameMap[K];
	/** The document and window in front (Obsidian's names; Docketeer has one window). */
	var activeDocument: Document;
	var activeWindow: Window;
}

/** Like DomElementInfo, for SVG elements: classes and attributes (no text). */
export interface SvgElementInfo {
	cls?: string | string[];
	attr?: Record<string, string | number | boolean | null>;
	parent?: Node;
	prepend?: boolean;
}

function makeSvg<K extends keyof SVGElementTagNameMap>(parent: Node | null, tag: K, o?: SvgElementInfo | string, cb?: Callback<SVGElementTagNameMap[K]>): SVGElementTagNameMap[K] {
	const el = document.createElementNS('http://www.w3.org/2000/svg', tag) as SVGElementTagNameMap[K];
	const info: SvgElementInfo = typeof o === 'string' ? { cls: o } : (o ?? {});
	if (info.cls) el.classList.add(...(Array.isArray(info.cls) ? info.cls : info.cls.split(/\s+/)).filter(Boolean));
	for (const [k, v] of Object.entries(info.attr ?? {})) if (v !== null && v !== false) el.setAttribute(k, v === true ? '' : String(v));
	const host = info.parent ?? parent;
	if (host) { if (info.prepend) host.insertBefore(el, host.firstChild); else host.appendChild(el); }
	cb?.(el);
	return el;
}

function applyInfo(el: HTMLElement, o: DomElementInfo | string | undefined) {
	if (o === undefined) return;
	if (typeof o === 'string') {
		el.className = o;
		return;
	}
	if (o.cls) el.addClass(...(Array.isArray(o.cls) ? o.cls : o.cls.split(/\s+/).filter(Boolean)));
	if (o.text !== undefined) el.setText(o.text);
	if (o.attr) for (const [k, v] of Object.entries(o.attr)) el.setAttr(k, v);
	if (o.title !== undefined) el.title = o.title;
	if (o.value !== undefined && 'value' in el) (el as HTMLInputElement).value = o.value;
	if (o.type !== undefined) el.setAttribute('type', o.type);
	if (o.placeholder !== undefined) el.setAttribute('placeholder', o.placeholder);
	if (o.href !== undefined) el.setAttribute('href', o.href);
	if (o.parent) {
		if (o.prepend) o.parent.insertBefore(el, o.parent.firstChild);
		else o.parent.appendChild(el);
	}
}

function make<K extends keyof HTMLElementTagNameMap>(parent: Node | null, tag: K, o?: DomElementInfo | string, cb?: Callback<HTMLElementTagNameMap[K]>): HTMLElementTagNameMap[K] {
	const el = document.createElement(tag);
	applyInfo(el, o);
	if (parent && !(typeof o === 'object' && o.parent)) {
		if (typeof o === 'object' && o.prepend) parent.insertBefore(el, parent.firstChild);
		else parent.appendChild(el);
	}
	cb?.(el);
	return el;
}

let installed = false;

/** Install the helpers. Safe to call more than once; does nothing outside a browser. */
export function installDomHelpers(): void {
	if (installed || typeof document === 'undefined') return;
	installed = true;
	const N = Node.prototype;
	const E = Element.prototype;
	const H = HTMLElement.prototype;
	const def = (proto: object, name: string, fn: unknown) => Object.defineProperty(proto, name, { value: fn, configurable: true, writable: true });

	def(N, 'empty', function (this: Node) { while (this.firstChild) this.removeChild(this.firstChild); });
	def(N, 'detach', function (this: Node) { this.parentNode?.removeChild(this); });
	def(N, 'appendText', function (this: Node, text: string) { this.appendChild(document.createTextNode(text)); });
	def(N, 'createEl', function (this: Node, tag: keyof HTMLElementTagNameMap, o?: DomElementInfo | string, cb?: Callback<HTMLElement>) { return make(this, tag, o, cb); });
	def(N, 'createDiv', function (this: Node, o?: DomElementInfo | string, cb?: Callback<HTMLDivElement>) { return make(this, 'div', o, cb); });
	def(N, 'createSpan', function (this: Node, o?: DomElementInfo | string, cb?: Callback<HTMLSpanElement>) { return make(this, 'span', o, cb); });
	def(N, 'createSvg', function (this: Node, tag: keyof SVGElementTagNameMap, o?: SvgElementInfo | string, cb?: Callback<SVGElement>) { return makeSvg(this, tag, o, cb); });
	Object.defineProperty(N, 'doc', { configurable: true, get(this: Node) { return this.ownerDocument ?? document; } });
	Object.defineProperty(N, 'win', { configurable: true, get(this: Node) { return (this.ownerDocument ?? document).defaultView ?? window; } });

	def(E, 'setText', function (this: Element, text: string | DocumentFragment) {
		if (typeof text === 'string') this.textContent = text;
		else { this.empty(); this.appendChild(text); }
	});
	def(E, 'addClass', function (this: Element, ...cls: string[]) { this.classList.add(...cls.flatMap((c) => c.split(/\s+/)).filter(Boolean)); });
	def(E, 'addClasses', function (this: Element, cls: string[]) { this.addClass(...cls); });
	def(E, 'removeClass', function (this: Element, ...cls: string[]) { this.classList.remove(...cls.flatMap((c) => c.split(/\s+/)).filter(Boolean)); });
	def(E, 'toggleClass', function (this: Element, cls: string | string[], on: boolean) {
		for (const c of Array.isArray(cls) ? cls : [cls]) this.classList.toggle(c, on);
	});
	def(E, 'hasClass', function (this: Element, cls: string) { return this.classList.contains(cls); });
	def(E, 'setAttr', function (this: Element, name: string, value: string | number | boolean | null) {
		if (value === null || value === false) this.removeAttribute(name);
		else this.setAttribute(name, value === true ? '' : String(value));
	});
	def(E, 'setAttrs', function (this: Element, obj: Record<string, string | number | boolean | null>) { for (const [k, v] of Object.entries(obj)) this.setAttr(k, v); });
	def(E, 'getText', function (this: Element) { return this.textContent ?? ''; });
	def(E, 'find', function (this: Element, s: string) { return this.querySelector(s); });
	def(E, 'findAll', function (this: Element, s: string) { return Array.from(this.querySelectorAll(s)); });

	def(H, 'show', function (this: HTMLElement) { this.style.removeProperty('display'); });
	def(H, 'hide', function (this: HTMLElement) { this.style.display = 'none'; });
	def(H, 'toggle', function (this: HTMLElement, show: boolean) { if (show) this.show(); else this.hide(); });
	def(H, 'isShown', function (this: HTMLElement) { return this.style.display !== 'none'; });
	def(H, 'setCssStyles', function (this: HTMLElement, styles: Partial<CSSStyleDeclaration>) { Object.assign(this.style, styles); });
	def(H, 'setCssProps', function (this: HTMLElement, props: Record<string, string>) { for (const [k, v] of Object.entries(props)) this.style.setProperty(k.startsWith('--') ? k : `--${k}`, v); });
	def(H, 'onClickEvent', function (this: HTMLElement, l: (ev: MouseEvent) => unknown, opts?: boolean | AddEventListenerOptions) {
		this.addEventListener('click', l as EventListener, opts);
		this.addEventListener('auxclick', l as EventListener, opts);
	});

	const g = globalThis as Record<string, unknown>;
	g.createEl = (tag: keyof HTMLElementTagNameMap, o?: DomElementInfo | string, cb?: Callback<HTMLElement>) => make(null, tag, o, cb);
	g.createDiv = (o?: DomElementInfo | string, cb?: Callback<HTMLDivElement>) => make(null, 'div', o, cb);
	g.createSpan = (o?: DomElementInfo | string, cb?: Callback<HTMLSpanElement>) => make(null, 'span', o, cb);
	g.createSvg = (tag: keyof SVGElementTagNameMap, o?: SvgElementInfo | string, cb?: Callback<SVGElement>) => makeSvg(null, tag, o, cb);
	g.activeDocument = document;
	g.activeWindow = window;
	g.createFragment = (cb?: Callback<DocumentFragment>) => {
		const f = document.createDocumentFragment();
		cb?.(f);
		return f;
	};
	g.activeDocument = document;
	g.activeWindow = window;
}

installDomHelpers();
