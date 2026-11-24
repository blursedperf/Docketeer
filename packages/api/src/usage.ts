/**
 * What was used, how often and how lately: notes opened and commands run, for ranking search results.
 * Kept in `.quire/usage.json` (names and counts only, no note text), like the open tabs in workspace.json.
 */
import { Events } from './events';

export interface UsageEntry { count: number; last: number }

const DAY = 86_400_000;

/**
 * A ranking bonus from use: more uses count, with diminishing returns, and fade with time (half every
 * week). Something used ten times today scores about 17; once a month ago, under 1.
 */
export function frecency(e: UsageEntry | undefined, now = Date.now()): number {
	if (!e) return 0;
	const age = Math.max(0, now - e.last) / DAY;
	return 5 * Math.log2(1 + e.count) * Math.pow(0.5, age / 7);
}

export interface UsageStore { read(): Promise<string | null>; write(data: string): Promise<void> }

export class Usage extends Events {
	private data: Record<string, Record<string, UsageEntry>> = { note: {}, command: {} };
	private saveTimer: number | null = null;

	constructor(private store: UsageStore | null = null, private max = 2000) {
		super();
	}

	async load(): Promise<void> {
		if (!this.store) return;
		try {
			const raw = await this.store.read();
			if (!raw) return;
			const parsed = JSON.parse(raw) as typeof this.data;
			for (const kind of ['note', 'command']) if (parsed[kind] && typeof parsed[kind] === 'object') this.data[kind] = parsed[kind]!;
		} catch {
			console.error('Could not read the usage file');
		}
	}

	record(kind: 'note' | 'command', key: string, now = Date.now()): void {
		const table = (this.data[kind] ??= {});
		const e = table[key] ?? { count: 0, last: 0 };
		table[key] = { count: e.count + 1, last: now };
		const keys = Object.keys(table);
		if (keys.length > this.max) {
			// Forget the least useful.
			keys.sort((a, b) => frecency(table[a], now) - frecency(table[b], now));
			for (const k of keys.slice(0, keys.length - this.max)) delete table[k];
		}
		this.scheduleSave();
	}

	score(kind: 'note' | 'command', key: string, now = Date.now()): number {
		return frecency(this.data[kind]?.[key], now);
	}

	/** Keys used most lately, newest first. */
	recent(kind: 'note' | 'command', n = 20): string[] {
		const table = this.data[kind] ?? {};
		return Object.keys(table).sort((a, b) => table[b]!.last - table[a]!.last).slice(0, n);
	}

	rename(kind: 'note' | 'command', from: string, to: string): void {
		const table = this.data[kind];
		if (!table?.[from]) return;
		table[to] = table[from]!;
		delete table[from];
		this.scheduleSave();
	}

	forget(kind: 'note' | 'command', key: string): void {
		if (this.data[kind]?.[key]) { delete this.data[kind]![key]; this.scheduleSave(); }
	}

	private scheduleSave(): void {
		if (!this.store || this.saveTimer !== null) return;
		this.saveTimer = setTimeout(() => {
			this.saveTimer = null;
			this.store?.write(JSON.stringify(this.data)).catch(() => console.error('Could not save the usage file'));
		}, 2000) as unknown as number;
	}
}
