import type { EventRef } from './events';

/** Something with a lifetime: everything it registers is undone when it is unloaded. */
export class Component {
	private _loaded = false;
	private _cleanups: (() => void)[] = [];
	private _children: Component[] = [];

	/** Settles when an async `onload()` has finished. */
	_onloadPromise: Promise<void> | null = null;

	load(): void {
		if (this._loaded) return;
		this._loaded = true;
		const r = this.onload();
		if (r instanceof Promise) this._onloadPromise = r.catch((e) => { console.error('Error in onload', e); throw e; });
		for (const c of this._children) c.load();
	}

	onload(): void | Promise<void> {}

	unload(): void {
		if (!this._loaded) return;
		this._loaded = false;
		for (const c of this._children.splice(0)) c.unload();
		for (const fn of this._cleanups.splice(0).reverse()) {
			try { fn(); } catch (e) { console.error('Error while unloading', e); }
		}
		this.onunload();
	}

	onunload(): void {}

	get loaded(): boolean { return this._loaded; }

	addChild<T extends Component>(c: T): T {
		this._children.push(c);
		if (this._loaded) c.load();
		return c;
	}

	removeChild<T extends Component>(c: T): T {
		this._children = this._children.filter((x) => x !== c);
		c.unload();
		return c;
	}

	register(cb: () => unknown): void {
		this._cleanups.push(() => { cb(); });
	}

	registerEvent(ref: EventRef): void {
		this.register(() => ref.e.offref(ref));
	}

	registerDomEvent<K extends keyof HTMLElementEventMap>(el: HTMLElement | Document | Window, type: K, cb: (ev: HTMLElementEventMap[K]) => unknown, options?: boolean | AddEventListenerOptions): void {
		el.addEventListener(type, cb as EventListener, options);
		this.register(() => el.removeEventListener(type, cb as EventListener, options));
	}

	registerInterval(id: number): number {
		this.register(() => window.clearInterval(id));
		return id;
	}
}
