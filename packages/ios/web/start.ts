/**
 * Boot order on iOS (PLAN §2.3): the renderer calls getHost() the moment it runs, so window.quire must be in place
 * first. Ask native for the host info (which homebase is open, if any), install the bridge, then load the renderer.
 */
import { createHost, NativeEvents, type HostInfo, type Native } from './host';

/** The renderer's entry (built by packages/app). A variable, so the bundler leaves the import to the page. */
export const RENDERER = '/renderer.js';

export async function start(native: Native, load: (url: string) => Promise<unknown>, scope: Record<string, unknown> = globalThis as unknown as Record<string, unknown>): Promise<void> {
	const events = new NativeEvents();
	// Native calls this for fs:events, app:system-lock and app:before-quit.
	scope.__quireNative = Object.freeze({ emit: (name: string, payload?: unknown) => events.emit(name, payload) });
	const info = await native('host:info') as HostInfo;
	scope.quire = createHost(native, info, events);
	await load(RENDERER);
}
