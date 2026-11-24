import { ItemView, TFile, type WorkspaceLeaf, debounce, parseLinktext } from '@quire/api';
import { groupHeader, openAt } from './common';

export const OUTGOING_VIEW = 'outgoing-link';

/** Where the active note links to: notes that exist, and links to notes not written yet. */
export class OutgoingLinksView extends ItemView {
	private file: TFile | null = null;
	private bodyEl!: HTMLElement;
	private readonly refresh = debounce(() => this.render(), 300, true);

	constructor(leaf: WorkspaceLeaf) {
		super(leaf);
		this.icon = 'arrow-up-right';
	}

	getViewType(): string { return OUTGOING_VIEW; }
	getDisplayText(): string { return this.file ? `Outgoing: ${this.file.basename}` : 'Outgoing links'; }

	override async onOpen(): Promise<void> {
		this.contentEl.addClass('outgoing-pane');
		this.bodyEl = this.contentEl.createDiv({ cls: 'pane-results' });
		this.registerEvent(this.app.workspace.on('file-open', () => this.follow()));
		this.registerEvent(this.app.metadataCache.on('resolved', () => this.refresh()));
		this.follow();
	}

	private follow() {
		const f = this.app.workspace.getActiveFile();
		const file = f && f.extension === 'md' ? f : null;
		if (file !== this.file) { this.file = file; this.leaf.updateHeader(); }
		this.render();
	}

	private render(): void {
		const file = this.file;
		this.bodyEl.empty();
		if (!file) { this.bodyEl.createDiv({ cls: 'pane-empty', text: 'Open a note to see its links.' }); return; }
		const cache = this.app.metadataCache.getFileCache(file);
		const resolved = new Map<TFile, number>();
		const unresolved = new Map<string, number>();
		for (const l of [...(cache?.links ?? []), ...(cache?.embeds ?? [])]) {
			const { path } = parseLinktext(l.link);
			const dest = this.app.metadataCache.getFirstLinkpathDest(path, file.path);
			if (dest) resolved.set(dest, (resolved.get(dest) ?? 0) + 1);
			else unresolved.set(path, (unresolved.get(path) ?? 0) + 1);
		}
		const section = (title: string, count: number, fill: (body: HTMLElement) => void) => {
			const body = createDiv({ cls: 'pane-group-body' });
			groupHeader(this.bodyEl, title, count, true, (o) => body.toggle(o)).addClass('pane-section');
			this.bodyEl.appendChild(body);
			fill(body);
		};
		section('Links', resolved.size, (body) => {
			if (resolved.size === 0) body.createDiv({ cls: 'pane-empty', text: 'No links to other notes.' });
			for (const [dest, n] of [...resolved].sort((a, b) => a[0].basename.localeCompare(b[0].basename))) {
				const row = body.createDiv({ cls: 'pane-file', attr: { title: dest.path } });
				row.createSpan({ text: dest.extension === 'md' ? dest.basename : dest.name });
				if (n > 1) row.createSpan({ cls: 'tree-item-flair', text: String(n) });
				row.addEventListener('click', (e) => openAt(this.app, dest, {}, e));
			}
		});
		section('Not created yet', unresolved.size, (body) => {
			if (unresolved.size === 0) body.createDiv({ cls: 'pane-empty', text: 'Every link goes to a note.' });
			for (const [name, n] of [...unresolved].sort((a, b) => a[0].localeCompare(b[0]))) {
				const row = body.createDiv({ cls: 'pane-file is-unresolved', attr: { title: 'Click to create this note' } });
				row.createSpan({ text: name });
				if (n > 1) row.createSpan({ cls: 'tree-item-flair', text: String(n) });
				row.addEventListener('click', () => { void this.app.workspace.openLinkText(name, file.path, false); });
			}
		});
	}
}
