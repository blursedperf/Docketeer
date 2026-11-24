import { ItemView, type WorkspaceLeaf, debounce, getAllTags, setIcon } from '@quire/api';

export const TAG_VIEW = 'tag';

interface TagNode { name: string; full: string; count: number; children: Map<string, TagNode>; }

/** Every tag in the homebase with how many notes use it, nested by "/". Click to search for it. */
export class TagsView extends ItemView {
	private bodyEl!: HTMLElement;
	private sortBy: 'name' | 'count' = 'count';
	private collapsed = new Set<string>();
	private readonly refresh = debounce(() => this.render(), 300, true);

	constructor(leaf: WorkspaceLeaf, private onTag: (tag: string) => void) {
		super(leaf);
		this.icon = 'tags';
	}

	getViewType(): string { return TAG_VIEW; }
	getDisplayText(): string { return 'Tags'; }

	override getState(): Record<string, unknown> { return { sortBy: this.sortBy }; }
	override async setState(state: unknown): Promise<void> {
		const s = state as { sortBy?: string } | null;
		if (s?.sortBy === 'name' || s?.sortBy === 'count') { this.sortBy = s.sortBy; this.render(); }
	}

	override async onOpen(): Promise<void> {
		this.contentEl.addClass('tags-pane');
		this.addAction('arrow-down-wide-narrow', 'Sort by name or count', () => {
			this.sortBy = this.sortBy === 'count' ? 'name' : 'count';
			this.render();
			this.app.workspace.requestSaveLayout();
		});
		this.bodyEl = this.contentEl.createDiv({ cls: 'pane-results nav-files-container' });
		this.registerEvent(this.app.metadataCache.on('resolved', () => this.refresh()));
		this.render();
	}

	private tree(): TagNode {
		const root: TagNode = { name: '', full: '', count: 0, children: new Map() };
		for (const f of this.app.vault.getMarkdownFiles()) {
			const cache = this.app.metadataCache.getFileCache(f);
			const tags = new Set((cache ? getAllTags(cache) ?? [] : []).map((t) => t.replace(/^#/, '')));
			const counted = new Set<string>();
			for (const t of tags) {
				let node = root;
				let full = '';
				for (const part of t.split('/')) {
					full = full ? `${full}/${part}` : part;
					let child = node.children.get(part.toLowerCase());
					if (!child) { child = { name: part, full, count: 0, children: new Map() }; node.children.set(part.toLowerCase(), child); }
					if (!counted.has(full.toLowerCase())) { child.count++; counted.add(full.toLowerCase()); }
					node = child;
				}
			}
		}
		return root;
	}

	private render(): void {
		if (!this.bodyEl) return;
		this.bodyEl.empty();
		const root = this.tree();
		if (root.children.size === 0) { this.bodyEl.createDiv({ cls: 'pane-empty', text: 'No tags yet. Add #tags to notes, or tags: in their properties.' }); return; }
		this.renderNodes(root, this.bodyEl, 0);
	}

	private renderNodes(node: TagNode, parent: HTMLElement, depth: number) {
		const kids = [...node.children.values()].sort((a, b) => (this.sortBy === 'count' ? b.count - a.count : 0) || a.name.localeCompare(b.name));
		for (const t of kids) {
			const item = parent.createDiv({ cls: 'tree-item' });
			const self = item.createDiv({ cls: 'tree-item-self tag-pane-tag' });
			self.style.paddingLeft = `${4 + depth * 16}px`;
			const chevron = self.createDiv({ cls: 'tree-item-icon collapse-icon' });
			const open = !this.collapsed.has(t.full);
			if (t.children.size) setIcon(chevron, open ? 'chevron-down' : 'chevron-right');
			self.createDiv({ cls: 'tree-item-inner', text: `#${t.name}` });
			self.createDiv({ cls: 'tree-item-flair', text: String(t.count) });
			chevron.addEventListener('click', (e) => {
				e.stopPropagation();
				if (open) this.collapsed.add(t.full); else this.collapsed.delete(t.full);
				this.render();
			});
			self.addEventListener('click', () => this.onTag(`#${t.full}`));
			if (t.children.size && open) {
				const kidsEl = item.createDiv({ cls: 'tree-item-children' });
				kidsEl.style.setProperty('--guide-left', `${4 + depth * 16 + 7}px`);
				this.renderNodes(t, kidsEl, depth + 1);
			}
		}
	}
}
