import { type Editor, ItemView, MarkdownView, type WorkspaceLeaf, debounce, parseMetadata } from '@quire/api';

export const OUTLINE_VIEW = 'outline';

/** The headings of the active note, indented by level; the one the cursor is under is marked. */
export class OutlineView extends ItemView {
	private bodyEl!: HTMLElement;
	private view: MarkdownView | null = null;
	private headings: { heading: string; level: number; line: number; offset: number }[] = [];
	private rows: HTMLElement[] = [];
	private readonly refresh = debounce(() => this.render(), 250, true);

	constructor(leaf: WorkspaceLeaf) {
		super(leaf);
		this.icon = 'list-tree';
	}

	getViewType(): string { return OUTLINE_VIEW; }
	getDisplayText(): string { return this.view?.file ? `Outline: ${this.view.file.basename}` : 'Outline'; }

	override async onOpen(): Promise<void> {
		this.contentEl.addClass('outline-pane');
		this.bodyEl = this.contentEl.createDiv({ cls: 'pane-results nav-files-container' });
		this.registerEvent(this.app.workspace.on('active-leaf-change', () => this.follow()));
		this.registerEvent(this.app.workspace.on('file-open', () => this.follow()));
		this.registerEvent(this.app.workspace.on('editor-change', (_e: Editor, info: MarkdownView) => { if (info === this.view) this.refresh(); }));
		this.registerEvent(this.app.workspace.on('editor-cursor', (_e: Editor, info: MarkdownView) => { if (info === this.view) this.markCurrent(); }));
		this.follow();
	}

	private follow() {
		const v = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (v && v !== this.view) { this.view = v; this.leaf.updateHeader(); }
		if (!v && !this.view) this.leaf.updateHeader();
		this.render();
	}

	private render(): void {
		if (!this.bodyEl) return;
		this.bodyEl.empty();
		this.rows = [];
		const v = this.view;
		if (!v?.file || !v.leaf.parent) { this.view = null; this.bodyEl.createDiv({ cls: 'pane-empty', text: 'Open a note to see its headings.' }); return; }
		const text = v.editor.getValue();
		this.headings = (parseMetadata(text).headings ?? []).map((h) => ({ heading: h.heading, level: h.level, line: h.position.start.line, offset: h.position.start.offset }));
		if (this.headings.length === 0) { this.bodyEl.createDiv({ cls: 'pane-empty', text: 'This note has no headings.' }); return; }
		const top = Math.min(...this.headings.map((h) => h.level));
		for (const h of this.headings) {
			const row = this.bodyEl.createDiv({ cls: `tree-item-self outline-heading mod-level-${h.level}` });
			row.style.paddingLeft = `${8 + (h.level - top) * 16}px`;
			row.createDiv({ cls: 'tree-item-inner', text: h.heading.replace(/[*_`]/g, '') });
			row.addEventListener('click', () => {
				this.app.workspace.setActiveLeaf(v.leaf, { focus: true });
				v.setEphemeralState({ line: h.line });
			});
			this.rows.push(row);
		}
		this.markCurrent();
	}

	private markCurrent() {
		const v = this.view;
		if (!v || this.rows.length === 0) return;
		const at = v.editor.posToOffset(v.editor.getCursor());
		let current = -1;
		this.headings.forEach((h, i) => { if (h.offset <= at) current = i; });
		this.rows.forEach((r, i) => r.toggleClass('is-active', i === current));
	}
}
