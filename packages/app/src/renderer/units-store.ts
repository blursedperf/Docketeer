/**
 * The homebase's unit tags (see units-model.ts), loaded once from `.quire/units.json`, saved on every change, and
 * kept right when folders are renamed, moved or deleted. Changes fire `units-changed` on the workspace.
 */
import { type App, TFolder } from '@quire/api';
import { type UnitKind, type UnitTagMap, deleteUnitTags, parseUnitTags, renameUnitTags } from './units-model';

export class UnitsStore {
	tags: UnitTagMap = {};
	loaded = false;

	constructor(private app: App) {
		app.vault.on('rename', (file, oldPath: string) => {
			if (!(file instanceof TFolder) || !Object.keys(this.tags).some((p) => p === oldPath || p.startsWith(`${oldPath}/`))) return;
			void this.replace(renameUnitTags(this.tags, oldPath, file.path));
		});
		app.vault.on('delete', (file) => {
			if (!(file instanceof TFolder) || !Object.keys(this.tags).some((p) => p === file.path || p.startsWith(`${file.path}/`))) return;
			void this.replace(deleteUnitTags(this.tags, file.path));
		});
	}

	private get path(): string { return `${this.app.vault.configDir}/units.json`; }

	async load(): Promise<void> {
		try {
			this.tags = (await this.app.vault.adapter.exists(this.path)) ? parseUnitTags(await this.app.vault.adapter.read(this.path)) : {};
		} catch {
			this.tags = {};
		}
		this.loaded = true;
		this.app.workspace.trigger('units-changed');
	}

	kind(path: string): UnitKind | null { return this.tags[path] ?? null; }
	get isEmpty(): boolean { return Object.keys(this.tags).length === 0; }

	/** Tag a folder as a subject or topic, or (null) take it out of Units. */
	async set(path: string, kind: UnitKind | null): Promise<void> {
		const next = { ...this.tags };
		if (kind) next[path] = kind;
		else delete next[path];
		await this.replace(next);
	}

	async replace(tags: UnitTagMap): Promise<void> {
		this.tags = Object.fromEntries(Object.entries(tags).sort(([a], [b]) => a.localeCompare(b)));
		await this.app.vault.adapter.write(this.path, JSON.stringify(this.tags, null, '\t'));
		this.app.workspace.trigger('units-changed');
	}
}

const stores = new WeakMap<App, UnitsStore>();

/** The homebase's unit tags (made, and loading, on first use). */
export function unitsStore(app: App): UnitsStore {
	let s = stores.get(app);
	if (!s) {
		s = new UnitsStore(app);
		stores.set(app, s);
		void s.load();
	}
	return s;
}
