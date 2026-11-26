/**
 * Hover preview: resting the mouse on a link to a note (in the editor or in reading view) shows the note, or the
 * section or block the link points to, in a popup beside it. With Ctrl/Cmd held it shows at once; otherwise
 * after a short pause, or only with Ctrl/Cmd, or never (the "Hover preview" setting). The popup stays while the
 * mouse is over it, so it can be scrolled and its links followed; it goes when the mouse leaves both, on Escape,
 * or on a click elsewhere.
 *
 * Plugins hear about it through the workspace's "hover-link" event, as in Obsidian.
 */
import type { App } from './app';
import { Component } from './component';
import { MarkdownRenderer } from './markdown-render';

/** Links that can be previewed: live preview's links, source mode's [[links]], reading view's internal links. */
const LINKS = '.cm-lp-wikilink, .cm-lp-link[data-kind="wiki"], .cm-wikilink, .markdown-rendered a.internal-link, [data-hover-link]';
const DELAY = 450;
const GRACE = 300;

export type HoverMode = 'hover' | 'mod' | 'off';

/** The note path a link element points to: its data-href, or the [[text]] it shows (source mode). */
export function linktextOf(el: HTMLElement): string | null {
	const href = el.dataset.hoverLink ?? el.dataset.href;
	if (href) return href.trim();
	const m = /^!?\[\[([^\]|]+)/.exec(el.textContent ?? '');
	return m ? m[1]!.trim() : null;
}

export class HoverPreview {
	private popover: HTMLElement | null = null;
	private component: Component | null = null;
	private showTimer = 0;
	private hideTimer = 0;
	private over: { el: HTMLElement; linktext: string } | null = null;
	private shownFor: HTMLElement | null = null;

	constructor(private app: App, private mode: () => HoverMode) {}

	/** Listen on the whole window; returns the function that stops. */
	install(): () => void {
		const over = (e: MouseEvent) => this.onOver(e);
		const out = (e: MouseEvent) => this.onOut(e);
		const key = (e: KeyboardEvent) => this.onKey(e);
		const down = (e: MouseEvent) => { if (this.popover && !this.popover.contains(e.target as Node)) this.hide(); };
		document.addEventListener('mouseover', over);
		document.addEventListener('mouseout', out);
		window.addEventListener('keydown', key, true);
		document.addEventListener('mousedown', down, true);
		return () => {
			document.removeEventListener('mouseover', over);
			document.removeEventListener('mouseout', out);
			window.removeEventListener('keydown', key, true);
			document.removeEventListener('mousedown', down, true);
			this.hide();
		};
	}

	get isShown(): boolean { return !!this.popover; }

	private onOver(e: MouseEvent) {
		const target = e.target as HTMLElement | null;
		if (!target?.closest) return;
		if (this.popover?.contains(target)) { window.clearTimeout(this.hideTimer); return; }
		const el = target.closest<HTMLElement>(LINKS);
		if (!el) return;
		if (el === this.shownFor) { window.clearTimeout(this.hideTimer); return; }
		const linktext = linktextOf(el);
		if (!linktext) return;
		this.over = { el, linktext };
		const mode = this.mode();
		if (mode === 'off') return;
		window.clearTimeout(this.showTimer);
		if (e.ctrlKey || e.metaKey) void this.show(el, linktext, e);
		else if (mode === 'hover') this.showTimer = window.setTimeout(() => { if (this.over?.el === el) void this.show(el, linktext, e); }, DELAY);
	}

	private onOut(e: MouseEvent) {
		const to = e.relatedTarget as Node | null;
		const from = e.target as HTMLElement;
		const leftLink = this.over && from.closest?.(LINKS) === this.over.el && !(to && this.over.el.contains(to));
		if (leftLink) { window.clearTimeout(this.showTimer); this.over = null; }
		if (!this.popover) return;
		const intoPopover = to && this.popover.contains(to);
		const intoLink = to && this.shownFor?.contains(to);
		if (!intoPopover && !intoLink) {
			window.clearTimeout(this.hideTimer);
			this.hideTimer = window.setTimeout(() => this.hide(), GRACE);
		}
	}

	private onKey(e: KeyboardEvent) {
		if (e.key === 'Escape' && this.popover) { this.hide(); return; }
		// Ctrl/Cmd pressed while resting on a link: show it now.
		if ((e.key === 'Control' || e.key === 'Meta') && this.over && this.mode() !== 'off' && this.shownFor !== this.over.el) {
			void this.show(this.over.el, this.over.linktext, null);
		}
	}

	/** The note the hovered link is in, for resolving it (the pane it is in, or the active note). */
	private sourcePathOf(el: HTMLElement): string {
		let path = this.app.workspace.getActiveFile()?.path ?? '';
		this.app.workspace.iterateAllLeaves((leaf) => {
			const view = leaf.view as { containerEl?: HTMLElement; file?: { path: string } | null };
			if (view.containerEl?.contains(el) && view.file) path = view.file.path;
		});
		return path;
	}

	async show(el: HTMLElement, linktext: string, event: MouseEvent | null): Promise<void> {
		this.hide();
		const sourcePath = this.sourcePathOf(el);
		const bare = linktext.replace(/[#^].*$/, '');
		const dest = bare ? this.app.metadataCache.getFirstLinkpathDest(bare, sourcePath) : this.app.vault.getFileByPath(sourcePath);
		this.app.workspace.trigger('hover-link', { event, source: 'editor', hoverParent: this, targetEl: el, linktext, sourcePath });
		const pop = document.body.createDiv({ cls: 'hover-popover popover', attr: { role: 'tooltip' } });
		const inner = pop.createDiv({ cls: 'markdown-preview-view markdown-rendered' });
		this.popover = pop;
		this.shownFor = el;
		this.component = new Component();
		this.component.load();
		if (!dest) {
			inner.createDiv({ cls: 'hover-popover-empty', text: `No note called "${bare}" yet. Click the link to make it.` });
		} else {
			// A note (or one of its sections or blocks), a picture or a recording: drawn as its embed would be.
			const subpath = linktext.slice(bare.length);
			const target = `${this.app.metadataCache.fileToLinktext(dest, sourcePath, true)}${subpath}`;
			await MarkdownRenderer.render(this.app, `![[${target}]]`, inner, sourcePath, this.component);
			if (this.popover !== pop) return;
		}
		this.position(pop, el);
		pop.addEventListener('mouseleave', (e) => {
			if (e.relatedTarget && this.shownFor?.contains(e.relatedTarget as Node)) return;
			window.clearTimeout(this.hideTimer);
			this.hideTimer = window.setTimeout(() => this.hide(), GRACE);
		});
		pop.addEventListener('mouseenter', () => window.clearTimeout(this.hideTimer));
		// A link in the popup opens its note, like one in the text.
		pop.addEventListener('click', (e) => {
			const a = (e.target as HTMLElement).closest<HTMLElement>('a.internal-link');
			if (!a) return;
			e.preventDefault();
			void this.app.workspace.openLinkText(a.dataset.href ?? '', dest?.path ?? sourcePath, e.ctrlKey || e.metaKey ? 'tab' : false);
			this.hide();
		});
	}

	/** Below the link, or above it when there is no room; inside the window. */
	private position(pop: HTMLElement, el: HTMLElement) {
		const r = el.getBoundingClientRect();
		const p = pop.getBoundingClientRect();
		const gap = 6;
		let top = r.bottom + gap;
		if (top + p.height > window.innerHeight - 8 && r.top - gap - p.height > 8) top = r.top - gap - p.height;
		const left = Math.max(8, Math.min(r.left, window.innerWidth - p.width - 8));
		pop.setCssStyles({ top: `${Math.max(8, top)}px`, left: `${left}px` });
	}

	hide(): void {
		window.clearTimeout(this.hideTimer);
		window.clearTimeout(this.showTimer);
		this.popover?.remove();
		this.popover = null;
		this.shownFor = null;
		this.component?.unload();
		this.component = null;
	}
}
