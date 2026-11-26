/**
 * Versions of notes from other devices that the sync service kept apart (iCloud's conflict versions, Syncthing's
 * `.sync-conflict-` files), for a host that lists them (HostFs.conflicts: iOS). They are shown at the top of the
 * Homebase panel, compared side by side, and settled by keeping this device's version, the other one, or both.
 * Nothing is removed until you choose.
 */
import { type App, type HostConflict, Events, Modal, Notice, conflictCopyPath, debounce } from '@quire/api';

/** "27 Nov, 9:05 am": when the other version was saved. */
export function savedWhen(ms: number): string {
	const d = new Date(ms);
	const time = d.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' });
	return `${d.getDate()} ${d.toLocaleString('en-AU', { month: 'short' })}, ${time}`;
}

export class ConflictsStore extends Events {
	list: HostConflict[] = [];
	private seen = new Set<string>();

	constructor(private app: App) {
		super();
	}

	get supported(): boolean { return !!this.app.host.fs.conflicts; }

	/** Ask the host again; a version not seen before gets a notice. */
	async refresh(): Promise<void> {
		const fs = this.app.host.fs;
		if (!fs.conflicts) return;
		let next: HostConflict[];
		try { next = await fs.conflicts(); } catch (e) { console.error('Could not list versions from other devices', e); return; }
		const fresh = next.filter((c) => !this.seen.has(c.id));
		for (const c of next) this.seen.add(c.id);
		const changed = next.length !== this.list.length || next.some((c, i) => c.id !== this.list[i]?.id);
		this.list = next;
		if (fresh.length) {
			const first = fresh[0]!;
			const name = this.app.vault.getFileByPath(first.path)?.basename ?? first.path;
			new Notice(fresh.length === 1
				? `“${name}” has another version, from ${first.from}. Homebase (in the Docket) lets you compare them and choose.`
				: `${fresh.length} notes have versions from other devices. Homebase (in the Docket) lets you compare them and choose.`, 10000);
		}
		if (changed) this.trigger('change');
	}

	read(c: HostConflict): Promise<string> {
		return this.app.host.fs.readConflict!(c.id);
	}

	/** Keep this device's version, the other one, or both (the other as a conflict copy beside the note). */
	async resolve(c: HostConflict, keep: 'mine' | 'theirs' | 'both'): Promise<void> {
		const copy = keep === 'both' ? conflictCopyPath(c.path, new Date(c.mtime), (p) => !!this.app.vault.getAbstractFileByPath(p)) : undefined;
		await this.app.host.fs.resolveConflict!(c.id, keep, copy);
		const name = this.app.vault.getFileByPath(c.path)?.basename ?? c.path;
		new Notice(keep === 'mine' ? `Kept this device's “${name}”.` : keep === 'theirs' ? `Kept the version of “${name}” from ${c.from}.` : `Kept both: the version from ${c.from} is “${copy!.split('/').pop()!.replace(/\.md$/, '')}”.`);
		await this.refresh();
	}
}

const stores = new WeakMap<App, ConflictsStore>();

/** The app's conflicts: listed at start, and again (in a moment) whenever files change. */
export function conflictsStore(app: App): ConflictsStore {
	let s = stores.get(app);
	if (!s) {
		const store = new ConflictsStore(app);
		s = store;
		stores.set(app, store);
		if (store.supported) {
			const again = debounce(() => { void store.refresh(); }, 1500, true);
			for (const ev of ['create', 'modify', 'delete'] as const) app.vault.on(ev, again);
			void store.refresh();
		}
	}
	return s;
}

/** The two versions side by side, and the three choices. */
export class CompareModal extends Modal {
	constructor(app: App, private store: ConflictsStore, private conflict: HostConflict, private done: () => void = () => undefined) {
		super(app);
		const name = app.vault.getFileByPath(conflict.path)?.basename ?? conflict.path;
		this.setTitle(`Two versions of “${name}”`);
	}

	override onOpen(): void {
		const { contentEl, conflict: c } = this;
		this.modalEl.addClass('mod-conflict');
		contentEl.createEl('p', { cls: 'setting-item-description', text: `The sync service kept both. Choose which to keep; nothing is removed until you do.` });
		const cols = contentEl.createDiv({ cls: 'conflict-columns' });
		const column = (title: string, text: Promise<string>) => {
			const col = cols.createDiv({ cls: 'conflict-column' });
			col.createEl('h3', { text: title });
			const pre = col.createEl('pre', { cls: 'conflict-text', text: 'Reading…', attr: { tabindex: '0' } });
			text.then((t) => pre.setText(t), (e: unknown) => pre.setText(`Could not read it: ${e instanceof Error ? e.message : String(e)}`));
		};
		const file = this.app.vault.getFileByPath(c.path);
		column('On this device', file ? this.app.vault.read(file) : Promise.resolve(''));
		column(`From ${c.from} · ${savedWhen(c.mtime)}`, this.store.read(c));
		const buttons = contentEl.createDiv({ cls: 'modal-button-container' });
		const choose = (label: string, keep: 'mine' | 'theirs' | 'both', cta = false) => {
			const b = buttons.createEl('button', { text: label, cls: cta ? 'mod-cta' : '' });
			b.addEventListener('click', () => {
				void this.store.resolve(c, keep).then(() => { this.close(); this.done(); }, (e: unknown) => new Notice(`Could not settle it: ${e instanceof Error ? e.message : String(e)}`));
			});
		};
		buttons.createEl('button', { text: 'Later' }).addEventListener('click', () => this.close());
		choose('Keep this device\'s', 'mine');
		choose(`Keep ${c.from}'s`, 'theirs');
		choose('Keep both', 'both', true);
	}
}
