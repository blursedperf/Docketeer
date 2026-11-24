import MarkdownIt from 'markdown-it';
import type { StateInline, Token } from 'markdown-it';
type MarkdownItInstance = ReturnType<typeof MarkdownIt>;
import footnote from 'markdown-it-footnote';
import type { App } from './app';
import type { Component } from './component';
import { TFile } from './files';
import { splitFrontMatter, parseFrontMatter, parseMetadata } from './metadata';
import { isImage } from './attachments';
import { createPlayer, isMedia, timeFromSubpath } from './media';

export interface MarkdownPostProcessorContext {
	sourcePath: string;
	frontmatter: Record<string, unknown> | undefined;
	docId: string;
	addChild(child: Component): void;
}

export type MarkdownPostProcessor = (el: HTMLElement, ctx: MarkdownPostProcessorContext) => Promise<unknown> | void;

const postProcessors: MarkdownPostProcessor[] = [];

export function registerPostProcessor(p: MarkdownPostProcessor): () => void {
	postProcessors.push(p);
	return () => {
		const i = postProcessors.indexOf(p);
		if (i !== -1) postProcessors.splice(i, 1);
	};
}

/** [[target|alias]] and ![[embed]] as inline tokens. */
function wikilinks(md: MarkdownItInstance) {
	md.inline.ruler.before('link', 'wikilink', (state: StateInline, silent: boolean) => {
		const src = state.src;
		let pos = state.pos;
		const embed = src.charCodeAt(pos) === 0x21; /* ! */
		if (embed) pos++;
		if (src.charCodeAt(pos) !== 0x5b || src.charCodeAt(pos + 1) !== 0x5b) return false;
		const end = src.indexOf(']]', pos + 2);
		if (end === -1) return false;
		const inner = src.slice(pos + 2, end);
		if (!inner || inner.includes('\n') || inner.includes('[')) return false;
		if (!silent) {
			const bar = inner.indexOf('|');
			const target = (bar === -1 ? inner : inner.slice(0, bar)).trim();
			const alias = bar === -1 ? null : inner.slice(bar + 1);
			const token = state.push('wikilink', '', 0);
			token.meta = { target, alias, embed };
		}
		state.pos = end + 2;
		return true;
	});
	md.renderer.rules.wikilink = (tokens: Token[], idx: number) => {
		const { target, alias, embed } = tokens[idx]!.meta as { target: string; alias: string | null; embed: boolean };
		const esc = md.utils.escapeHtml;
		const text = alias ?? target.replace(/#\^?/, ' › ');
		const aliasAttr = alias !== null ? ` data-alias="${esc(alias)}"` : '';
		return `<a class="internal-link${embed ? ' is-embed' : ''}" data-href="${esc(target)}"${aliasAttr} href="${esc(target)}">${esc(text)}</a>`;
	};
}

let parser: MarkdownItInstance | null = null;

function getParser(): MarkdownItInstance {
	if (!parser) {
		parser = new MarkdownIt({ html: false, linkify: false, typographer: false, breaks: false });
		parser.use(footnote);
		parser.use(wikilinks);
		parser.enable(['table', 'strikethrough']);
		// Highlight ==text==.
		parser.inline.ruler.before('emphasis', 'mark', (state: StateInline, silent: boolean) => {
			const src = state.src;
			if (src.charCodeAt(state.pos) !== 0x3d || src.charCodeAt(state.pos + 1) !== 0x3d) return false;
			const end = src.indexOf('==', state.pos + 2);
			if (end === -1 || end === state.pos + 2) return false;
			if (!silent) {
				state.push('mark_open', 'mark', 1);
				const t = state.push('text', '', 0);
				t.content = src.slice(state.pos + 2, end);
				state.push('mark_close', 'mark', -1);
			}
			state.pos = end + 2;
			return true;
		});
	}
	return parser;
}

const ALLOWED_TAGS = new Set([
	'a', 'p', 'br', 'hr', 'em', 'strong', 'del', 's', 'mark', 'code', 'pre', 'blockquote', 'ul', 'ol', 'li', 'sup', 'sub',
	'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'section', 'span', 'div', 'input', 'img',
]);
const ALLOWED_ATTRS = new Set(['href', 'class', 'id', 'data-href', 'data-alias', 'title', 'start', 'colspan', 'rowspan', 'align', 'type', 'checked', 'disabled', 'aria-label', 'alt', 'src']);

/** Copy only safe elements and attributes from parsed HTML into `target`. */
function sanitizeInto(source: Node, target: Node) {
	for (const child of Array.from(source.childNodes)) {
		if (child.nodeType === Node.TEXT_NODE) {
			target.appendChild(document.createTextNode(child.textContent ?? ''));
			continue;
		}
		if (!(child instanceof Element)) continue;
		const tag = child.tagName.toLowerCase();
		if (!ALLOWED_TAGS.has(tag)) {
			sanitizeInto(child, target);
			continue;
		}
		const el = document.createElement(tag);
		for (const attr of Array.from(child.attributes)) {
			const name = attr.name.toLowerCase();
			if (!ALLOWED_ATTRS.has(name)) continue;
			const value = attr.value;
			if ((name === 'href' || name === 'src') && /^\s*(?:javascript|vbscript|data):/i.test(value)) continue;
			if (name === 'src' && /^\s*[a-z][a-z0-9+.-]*:/i.test(value) && !value.startsWith('quire:')) continue;
			el.setAttribute(name, value);
		}
		sanitizeInto(child, el);
		target.appendChild(el);
	}
}

/** Turn task list items "[ ] x" into checkboxes. */
function taskLists(el: HTMLElement) {
	for (const li of Array.from(el.querySelectorAll('li'))) {
		const first = li.firstChild?.nodeType === Node.TEXT_NODE ? li.firstChild : li.firstElementChild?.tagName === 'P' ? li.firstElementChild.firstChild : null;
		if (!first || first.nodeType !== Node.TEXT_NODE) continue;
		const m = /^\[( |x|X)\]\s/.exec(first.textContent ?? '');
		if (!m) continue;
		first.textContent = (first.textContent ?? '').slice(m[0].length);
		const box = document.createElement('input');
		box.type = 'checkbox';
		box.className = 'task-list-item-checkbox';
		box.checked = m[1] !== ' ';
		box.disabled = true;
		first.parentNode?.insertBefore(box, first);
		li.classList.add('task-list-item');
		if (box.checked) li.classList.add('is-checked');
	}
}

export class MarkdownRenderer {
	/** Render `markdown` into `el` (sanitised), then run post-processors. */
	static async render(app: App, markdown: string, el: HTMLElement, sourcePath: string, component: Component, depth = 0): Promise<void> {
		const { yaml, body } = splitFrontMatter(markdown);
		const frontmatter = yaml !== null ? parseFrontMatter(markdown) : undefined;
		if (frontmatter && Object.keys(frontmatter).length) {
			const props = el.createDiv({ cls: 'metadata-container' });
			for (const [k, v] of Object.entries(frontmatter)) {
				const row = props.createDiv({ cls: 'metadata-property' });
				row.createDiv({ cls: 'metadata-property-key', text: k });
				row.createDiv({ cls: 'metadata-property-value', text: Array.isArray(v) ? v.join(', ') : typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v) });
			}
		}
		// %% comments %% are not shown when reading.
		const html = getParser().render(body.replace(/%%[\s\S]*?(?:%%|$)/g, ''));
		const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
		const wrap = el.createDiv({ cls: 'markdown-rendered-body' });
		sanitizeInto(doc.body, wrap);
		taskLists(wrap);
		for (const a of Array.from(wrap.querySelectorAll<HTMLAnchorElement>('a.internal-link'))) {
			const target = a.dataset.href ?? '';
			const dest = app.metadataCache.getFirstLinkpathDest(target.replace(/[#^].*$/, ''), sourcePath);
			if (!dest) a.addClass('is-unresolved');
			if (a.hasClass('is-embed') && dest instanceof TFile) await renderEmbed(app, a, dest, target, sourcePath, component, depth);
		}
		// ![alt](relative/path.png): pictures from the homebase, by the app's own route; nothing else.
		for (const img of Array.from(wrap.querySelectorAll<HTMLImageElement>('img'))) {
			const src = img.getAttribute('src') ?? '';
			if (src.startsWith('quire:')) continue;
			let rel = src;
			try { rel = decodeURIComponent(src); } catch { /* as written */ }
			const bare = isMedia(rel) ? rel.replace(/#.*$/, '') : rel;
			const f = app.vault.getFileByPath(resolveFrom(sourcePath, bare)) ?? app.metadataCache.getFirstLinkpathDest(bare, sourcePath);
			if (f && isImage(f.name)) img.src = app.vault.getResourcePath(f);
			else if (f && isMedia(f.name)) {
				const { el, dispose } = createPlayer(app, f, { start: timeFromSubpath(/#.*$/.exec(rel)?.[0] ?? '') });
				component.register(dispose);
				img.replaceWith(el);
			} else img.replaceWith(document.createTextNode(img.alt || src));
		}
		for (const a of Array.from(wrap.querySelectorAll<HTMLAnchorElement>('a:not(.internal-link)'))) {
			const href = a.getAttribute('href') ?? '';
			if (href.startsWith('#')) continue;
			if (/^[a-z][a-z0-9+.-]*:/i.test(href)) a.addClass('external-link');
			else { a.addClass('internal-link'); a.dataset.href = decodeURIComponent(href); }
		}
		const ctx: MarkdownPostProcessorContext = { sourcePath, frontmatter, docId: String(Math.random()), addChild: (c) => component.addChild(c) };
		for (const p of postProcessors) {
			try { await p(wrap, ctx); } catch (e) { console.error('Markdown post-processor failed', e); }
		}
	}

	/** Render to a fresh element (for previews and popovers). */
	static async renderMarkdown(markdown: string, el: HTMLElement, sourcePath: string, component: Component & { app?: App }): Promise<void> {
		const app = (component as { app?: App }).app ?? (globalThis as { app?: App }).app!;
		await MarkdownRenderer.render(app, markdown, el, sourcePath, component);
	}
}

/** A path relative to the note at `source`, as a homebase path. */
function resolveFrom(source: string, target: string): string {
	if (target.startsWith('/')) return target.slice(1);
	const parts = source.includes('/') ? source.slice(0, source.lastIndexOf('/')).split('/') : [];
	for (const seg of target.split('/')) {
		if (seg === '..') parts.pop();
		else if (seg !== '.' && seg !== '') parts.push(seg);
	}
	return parts.join('/');
}

/** The part of a note under "#Heading", up to the next heading of the same or a higher level. */
export function sectionOf(markdown: string, heading: string): string | null {
	const want = heading.trim().toLowerCase();
	const hs = parseMetadata(markdown).headings ?? [];
	const i = hs.findIndex((h) => h.heading.trim().toLowerCase() === want);
	if (i === -1) return null;
	const h = hs[i]!;
	const next = hs.slice(i + 1).find((x) => x.level <= h.level);
	return markdown.slice(h.position.start.offset, next ? next.position.start.offset : markdown.length);
}

/** Replace an ![[embed]] link with the picture, the note (or section), or a card for other files. */
async function renderEmbed(app: App, a: HTMLAnchorElement, dest: TFile, target: string, sourcePath: string, component: Component, depth: number): Promise<void> {
	const alias = a.dataset.alias ?? '';
	if (isImage(dest.name)) {
		const img = document.createElement('img');
		img.src = app.vault.getResourcePath(dest);
		const size = /^(\d+)(?:x(\d+))?$/.exec(alias.trim());
		img.alt = size ? dest.name : alias || dest.name;
		if (size) img.style.width = `${size[1]}px`;
		img.className = 'image-embed';
		a.replaceWith(img);
		return;
	}
	if (isMedia(dest.name)) {
		const size = /^(\d+)(?:x\d+)?$/.exec(alias.trim());
		const { el, dispose } = createPlayer(app, dest, { start: timeFromSubpath(target.slice(target.search(/[#^]|$/))), width: size ? Number(size[1]) : null });
		component.register(dispose);
		a.replaceWith(el);
		return;
	}
	const box = document.createElement('div');
	box.className = 'markdown-embed';
	const title = box.createDiv({ cls: 'markdown-embed-title' });
	const link = title.createEl('a', { cls: 'internal-link', text: target.replace(/#\^?/, ' › '), attr: { 'data-href': target, href: target } });
	void link;
	a.replaceWith(box);
	if (dest.extension !== 'md') {
		box.addClass('mod-file');
		box.createDiv({ cls: 'markdown-embed-file', text: `${dest.extension.toUpperCase()} · ${(dest.stat.size / 1024).toFixed(0)} KB` });
		return;
	}
	if (depth >= 3 || dest.path === sourcePath) {
		box.createDiv({ cls: 'markdown-embed-content u-muted', text: depth >= 3 ? 'Embedded too deeply to show here.' : 'A note cannot embed itself.' });
		return;
	}
	// A locked note shows as locked, never its text (not even its headings).
	if (app.isLocked(dest)) {
		box.addClass('mod-locked');
		box.createDiv({ cls: 'markdown-embed-content u-muted', text: `${dest.basename} is locked.` });
		return;
	}
	let text = await app.vault.cachedRead(dest);
	const hash = target.indexOf('#');
	if (hash !== -1 && target[hash + 1] !== '^') {
		const section = sectionOf(text, target.slice(hash + 1));
		if (section === null) { box.createDiv({ cls: 'markdown-embed-content u-muted', text: `No heading "${target.slice(hash + 1)}" in ${dest.basename}.` }); return; }
		text = section;
	}
	const content = box.createDiv({ cls: 'markdown-embed-content' });
	await MarkdownRenderer.render(app, text, content, dest.path, component, depth + 1);
}
