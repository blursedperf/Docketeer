/**
 * Keeps the search index and the usage record in step with the homebase: built from the notes' text
 * (already in memory) after start-up, in small batches so the window stays responsive, then updated on
 * every create, change, rename and delete. Locked notes are left out.
 */
import type { App } from './app';
import { TFile } from './files';
import type { HeadingCache } from './metadata';
import { type IndexedHeading, type RankContext, SearchIndex } from './search-index';
import { Usage } from './usage';

function headingsOf(list: HeadingCache[] | undefined): IndexedHeading[] {
	return (list ?? []).map((h) => ({ text: h.heading, lower: h.heading.toLowerCase(), level: h.level, line: h.position.start.line }));
}

export class SearchService {
	index = new SearchIndex();
	usage: Usage;
	/** Resolves when every note is indexed. */
	ready: Promise<void>;
	private resolveReady!: () => void;
	private built = false;

	constructor(private app: App) {
		this.ready = new Promise((r) => { this.resolveReady = r; });
		const path = () => `${app.vault.configDir}/usage.json`;
		this.usage = new Usage({
			read: async () => ((await app.vault.adapter.exists(path())) ? app.vault.adapter.read(path()) : null),
			write: (data) => app.vault.adapter.write(path(), data),
		});
	}

	get isReady(): boolean { return this.built; }

	/** Index every note, a batch at a time, then follow changes. */
	async build(batch = 400): Promise<void> {
		const { vault } = this.app;
		this.wire();
		const files = vault.getMarkdownFiles();
		for (let i = 0; i < files.length; i += batch) {
			for (const f of files.slice(i, i + batch)) await this.add(f);
			await new Promise((r) => setTimeout(r, 0));
		}
		this.built = true;
		this.resolveReady();
	}

	/** Index a note again (after unlocking). */
	reindex(f: TFile): Promise<void> {
		return this.add(f);
	}

	private async add(f: TFile): Promise<void> {
		if (f.extension !== 'md' || this.app.isLocked(f)) { this.index.remove(f.path); return; }
		try {
			const text = await this.app.vault.cachedRead(f);
			this.index.set(f.path, text, headingsOf(this.app.metadataCache.getFileCache(f)?.headings));
		} catch {
			console.error('Could not index a note');
		}
	}

	private wire(): void {
		const { vault, metadataCache, workspace } = this.app;
		vault.on('create', (f) => { if (f instanceof TFile) void this.add(f); });
		vault.on('modify', (f) => { if (f instanceof TFile) void this.add(f); });
		vault.on('delete', (f) => { this.index.remove(f.path); this.usage.forget('note', f.path); });
		vault.on('rename', (f, oldPath: string) => {
			this.index.remove(oldPath);
			this.usage.rename('note', oldPath, f.path);
			if (f instanceof TFile) void this.add(f);
		});
		metadataCache.on('changed', (f: TFile, _data: string, cache: { headings?: HeadingCache[] }) => this.index.setHeadings(f.path, headingsOf(cache.headings)));
		// Locked notes are not recorded (their names stay out of usage.json).
		workspace.on('file-open', (f: TFile | null) => { if (f && !this.app.isEncrypted(f)) this.usage.record('note', f.path); });
		this.app.on('command-run', (id: string) => this.usage.record('command', id));
	}

	/** Ranking context: use, and the unit and folder of the open note. */
	rankContext(): RankContext {
		const active = this.app.workspace.getActiveFile();
		const parts = active ? active.path.split('/').slice(0, -1) : [];
		const now = Date.now();
		return { usage: (p) => this.usage.score('note', p, now), unit: parts[0], folder: parts.join('/') || undefined };
	}
}
