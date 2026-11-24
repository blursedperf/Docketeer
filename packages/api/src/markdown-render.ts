import MarkdownIt from 'markdown-it';
import type { StateInline, Token } from 'markdown-it';
type MarkdownItInstance = ReturnType<typeof MarkdownIt>;
import footnote from 'markdown-it-footnote';
import type { App } from './app';
import type { Component } from './component';
import { TFile } from './files';
import { splitFrontMatter, parseFrontMatter } from './metadata';

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
		return `<a class="internal-link${embed ? ' is-embed' : ''}" data-href="${esc(target)}" href="${esc(target)}">${esc(text)}</a>`;
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
const ALLOWED_ATTRS = new Set(['href', 'class', 'id', 'data-href', 'title', 'start', 'colspan', 'rowspan', 'align', 'type', 'checked', 'disabled', 'aria-label', 'alt', 'src']);

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
	static async render(app: App, markdown: string, el: HTMLElement, sourcePath: string, component: Component): Promise<void> {
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
			if (a.hasClass('is-embed') && dest instanceof TFile && /^(png|jpe?g|gif|webp|svg|bmp|avif)$/.test(dest.extension)) {
				const img = document.createElement('img');
				img.src = app.vault.getResourcePath(dest);
				img.alt = dest.name;
				a.replaceWith(img);
			}
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
