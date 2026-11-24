export interface Debouncer<T extends unknown[], V> {
	(...args: T): this;
	cancel(): this;
	run(): V | void;
}

/**
 * Call `cb` once `timeout` ms have passed since the last call. With `resetTimer`, each call restarts
 * the wait; without it, the first call's timer stands.
 */
export function debounce<T extends unknown[], V>(cb: (...args: T) => V, timeout = 0, resetTimer = false): Debouncer<T, V> {
	let timer: ReturnType<typeof setTimeout> | null = null;
	let lastArgs: T | null = null;
	const fire = () => {
		timer = null;
		const args = lastArgs;
		lastArgs = null;
		if (args) return cb(...args);
		return undefined;
	};
	const d = function (this: unknown, ...args: T) {
		lastArgs = args;
		if (timer !== null && resetTimer) { clearTimeout(timer); timer = null; }
		if (timer === null) timer = setTimeout(fire, timeout);
		return d;
	} as Debouncer<T, V>;
	d.cancel = () => { if (timer !== null) clearTimeout(timer); timer = null; lastArgs = null; return d; };
	d.run = () => { if (timer === null) return undefined; clearTimeout(timer); return fire(); };
	return d;
}

/** Vault paths: forward slashes, no leading, trailing or repeated slashes. The vault root is "/". */
export function normalizePath(path: string): string {
	let p = path.replace(/\\/g, '/').replace(/ | /g, ' ').replace(/\/+/g, '/').replace(/^\/|\/$/g, '');
	p = p.normalize('NFC');
	return p === '' ? '/' : p;
}

const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';

/**
 * What may be logged about an error: its kind and code, never its message (file system errors put the
 * path in the message, and the plan forbids paths, note text and queries in logs).
 */
export function errorSummary(e: unknown): string {
	if (e instanceof Error) {
		const code = (e as { code?: unknown }).code;
		return typeof code === 'string' ? `${e.name} ${code}` : e.name;
	}
	return typeof e;
}

export const Platform = {
	isDesktop: true,
	isMobile: false,
	isDesktopApp: true,
	isMobileApp: false,
	isIosApp: false,
	isAndroidApp: false,
	isPhone: false,
	isTablet: false,
	isMacOS: /Mac OS X/.test(ua),
	isWin: /Windows/.test(ua),
	isLinux: /Linux/.test(ua) && !/Android/.test(ua),
	isSafari: false,
};

/** Escape text for a RegExp. */
export function escapeRegExp(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Score a fuzzy (subsequence) match of `query` in `text`; null when it does not match. Higher is better. */
/**
 * A stricter fuzzy match for names made of words (commands, settings): each typed letter must follow the
 * previous match directly or start a later word, so "ntab" finds "New tab" and "spl" finds "Split right",
 * but "mabo" does not match "Move tab to the pane". Higher is better; null when it does not match.
 */
export function wordMatch(query: string, text: string): number | null {
	const q = query.toLowerCase().replace(/\s+/g, '');
	if (!q) return 0;
	const t = text.toLowerCase();
	const direct = t.indexOf(q);
	if (direct !== -1) return 1000 - direct - (t.length - q.length) * 0.01;
	const starts: number[] = [];
	for (let i = 0; i < t.length; i++) if (i === 0 || /[\s/\-_.:(]/.test(t[i - 1]!)) starts.push(i);
	// Depth-first: continue the current word, or jump to the next word start; each (letter, place) once.
	const memo = new Map<number, number | null>();
	const go = (qi: number, ti: number): number | null => {
		if (qi === q.length) return 0;
		const key = qi * 4096 + ti;
		if (memo.has(key)) return memo.get(key)!;
		const r = step(qi, ti);
		memo.set(key, r);
		return r;
	};
	const step = (qi: number, ti: number): number | null => {
		const ch = q[qi]!;
		let best: number | null = null;
		if (ti < t.length && ti > 0 && t[ti] === ch) {
			const r = go(qi + 1, ti + 1);
			if (r !== null) best = r + 5;
		}
		for (const s of starts) {
			if (s < ti || t[s] !== ch) continue;
			const r = go(qi + 1, s + 1);
			if (r !== null && (best === null || r + 3 > best)) best = r + 3;
			break; // the nearest word start is enough
		}
		return best;
	};
	const r = go(0, 0);
	return r === null ? null : r - t.length * 0.01;
}

export function fuzzyScore(query: string, text: string): number | null {
	const q = query.toLowerCase().replace(/\s+/g, '');
	if (!q) return 0;
	const t = text.toLowerCase();
	const direct = t.indexOf(q);
	if (direct !== -1) return 1000 - direct - (t.length - q.length) * 0.01;
	let score = 0;
	let ti = 0;
	let prev = -2;
	for (const ch of q) {
		const found = t.indexOf(ch, ti);
		if (found === -1) return null;
		score += found === prev + 1 ? 5 : 1;
		if (found === 0 || /[\s/\-_.]/.test(t[found - 1] ?? '')) score += 3;
		prev = found;
		ti = found + 1;
	}
	return score - t.length * 0.01;
}
