/** A subscription returned by `on()`; pass it to `offref()` or `Component.registerEvent()`. */
export interface EventRef {
	e: Events;
	name: string;
	fn: (...args: any[]) => unknown;
	ctx?: unknown;
}

export class Events {
	private _handlers = new Map<string, EventRef[]>();

	on(name: string, callback: (...data: any[]) => unknown, ctx?: unknown): EventRef {
		const ref: EventRef = { e: this, name, fn: callback, ctx };
		const list = this._handlers.get(name) ?? [];
		list.push(ref);
		this._handlers.set(name, list);
		return ref;
	}

	off(name: string, callback: (...data: any[]) => unknown): void {
		const list = this._handlers.get(name);
		if (!list) return;
		this._handlers.set(name, list.filter((r) => r.fn !== callback));
	}

	offref(ref: EventRef): void {
		const list = this._handlers.get(ref.name);
		if (!list) return;
		this._handlers.set(ref.name, list.filter((r) => r !== ref));
	}

	trigger(name: string, ...data: unknown[]): void {
		const list = this._handlers.get(name);
		if (!list) return;
		for (const ref of [...list]) this.tryTrigger(ref, data);
	}

	tryTrigger(ref: EventRef, args: unknown[]): void {
		try {
			ref.fn.apply(ref.ctx, args);
		} catch (e) {
			console.error(`Error in "${ref.name}" handler`, e);
		}
	}
}
