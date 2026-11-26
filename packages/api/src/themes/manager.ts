import { errorSummary } from '../util';
import type { App } from '../app';
import { Events, type EventRef } from '../events';
import { getActiveIconPack, setIconPack } from '../icons';
import { Notice } from '../ui';
import { BUILTIN_PALETTES, type Palette } from './palettes';
import { contrastFixes } from './contrast';

export type { Palette };

/** What a CSS theme or snippet may not contain: everything that could load something from elsewhere. */
export function cssProblems(css: string): string[] {
	const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
	const problems: string[] = [];
	if (/@import\b/i.test(text)) problems.push('@import');
	for (const m of text.matchAll(/url\(\s*(['"]?)([^'")\s]*)/gi)) {
		const target = m[2] ?? '';
		if (!/^(?:data:|#)/i.test(target)) problems.push(`url(${target})`);
	}
	if (/\b(?:https?|wss?|ftp):\/\//i.test(text.replace(/url\([^)]*\)/gi, ''))) problems.push('a web address');
	if (/expression\s*\(|behavior\s*:|-moz-binding/i.test(text)) problems.push('script in CSS');
	return [...new Set(problems)];
}

function hexToRgb(hex: string): [number, number, number] | null {
	const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
	if (!m) return null;
	let h = m[1]!;
	if (h.length === 3) h = h.split('').map((c) => c + c).join('');
	return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function rgbToHsl([r, g, b]: [number, number, number]): [number, number, number] {
	const [rr, gg, bb] = [r / 255, g / 255, b / 255];
	const max = Math.max(rr, gg, bb);
	const min = Math.min(rr, gg, bb);
	const l = (max + min) / 2;
	if (max === min) return [0, 0, l * 100];
	const d = max - min;
	const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
	const h = max === rr ? (gg - bb) / d + (gg < bb ? 6 : 0) : max === gg ? (bb - rr) / d + 2 : (rr - gg) / d + 4;
	return [h * 60, s * 100, l * 100];
}

/** Relative luminance (WCAG). */
function luminance([r, g, b]: [number, number, number]): number {
	const c = [r, g, b].map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
	return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
}

/** Tokens that follow the accent colour, for an accent chosen in Appearance. */
export function accentVars(hex: string): Record<string, string> | null {
	const rgb = hexToRgb(hex);
	if (!rgb) return null;
	const [h, s, l] = rgbToHsl(rgb);
	const onAccent = luminance(rgb) > 0.45 ? '#0b1018' : '#ffffff';
	const c = `#${rgb.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
	return {
		'doom-blue': c, 'doom-blue-rgb': rgb.join(', '), 'doom-blue-text': c, 'doom-blue-fill': c,
		'doom-accent-h': h.toFixed(1), 'doom-accent-s': `${s.toFixed(1)}%`, 'doom-accent-l': `${l.toFixed(1)}%`,
		'doom-on-accent': onAccent, 'doom-modeline-bar': c, 'doom-modeline-badge-bg': c, 'doom-modeline-badge-fg': onAccent,
		'doom-table-header-text': c,
	};
}

function block(selector: string, vars: Record<string, string>): string {
	const body = Object.entries(vars).map(([k, v]) => `\t--${k}: ${v};`).join('\n');
	return `${selector} {\n${body}\n}\n`;
}

/**
 * The app's appearance: light or dark, the palette for each, accent colour, fonts, icon set, an
 * installed CSS theme and CSS snippets. Settings are kept in the homebase's app.json; themes and
 * snippets are files in `.quire/themes/<name>/theme.css` and `.quire/snippets/<name>.css`.
 */
/** CSS generic families, used as they are ("system-ui" is the system's font, not a font named so). */
const GENERIC_FONTS = new Set(['system-ui', 'ui-sans-serif', 'ui-serif', 'ui-monospace', 'sans-serif', 'serif', 'monospace']);

/** The font-family value for a font setting: the family named (quoted), then a fallback; '' for none. */
export function fontStack(name: string, mono: boolean): string {
	const n = name.trim().replace(/"/g, '');
	if (!n) return '';
	const fallback = mono ? 'monospace' : 'sans-serif';
	return GENERIC_FONTS.has(n) ? `${n}, ${fallback}` : `"${n}", ${fallback}`;
}

export class CustomCss extends Events {
	/** Installed CSS themes (folder names) and snippets (file names without .css). */
	themes: string[] = [];
	snippets: string[] = [];
	private extraPalettes: Palette[] = [];
	private paletteEl: HTMLStyleElement | null = null;
	private themeEl: HTMLStyleElement | null = null;
	private snippetEls = new Map<string, HTMLStyleElement>();
	private refused = new Map<string, string[]>();

	constructor(private app: App) {
		super();
	}

	get themesFolder(): string { return `${this.app.vault.configDir}/themes`; }
	get snippetsFolder(): string { return `${this.app.vault.configDir}/snippets`; }

	// ---------------------------------------------------------------------------------------------
	// Palettes

	getPalettes(mode?: 'dark' | 'light'): Palette[] {
		const all = [...BUILTIN_PALETTES, ...this.extraPalettes];
		return mode ? all.filter((p) => p.mode === mode) : all;
	}

	getPalette(id: string): Palette | null {
		return this.getPalettes().find((p) => p.id === id) ?? null;
	}

	/** Add a palette (from a plugin); returns a function that removes it. */
	registerPalette(p: Palette): () => void {
		this.extraPalettes.push(p);
		this.apply();
		return () => {
			this.extraPalettes = this.extraPalettes.filter((x) => x !== p);
			this.apply();
		};
	}

	isDark(): boolean {
		const scheme = this.app.config.theme;
		return scheme === 'dark' || (scheme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
	}

	/** Apply everything: mode, palettes, accent, fonts, icons. */
	apply(): void {
		const c = this.app.config;
		const body = document.body;
		const dark = this.isDark();
		body.toggleClass('theme-dark', dark);
		body.toggleClass('theme-light', !dark);

		const darkP = this.getPalette(String(c.darkPalette)) ?? this.getPalette('crisp-dark')!;
		const lightP = this.getPalette(String(c.lightPalette)) ?? this.getPalette('crisp-light')!;
		const accent = c.accentColor ? accentVars(String(c.accentColor)) : null;
		// Each mode's tokens, with the accent, then nudged where a pairing would fall short of WCAG AA.
		const finish = (vars: Record<string, string>) => { const v = { ...vars, ...(accent ?? {}) }; return { ...v, ...contrastFixes(v) }; };
		const css = block('body.theme-dark', finish(darkP.vars)) + block('body.theme-light', finish(lightP.vars));
		if (!this.paletteEl) this.paletteEl = document.head.createEl('style', { attr: { id: 'quire-palette' } });
		this.paletteEl.textContent = css;
		body.dataset.paletteDark = darkP.id;
		body.dataset.paletteLight = lightP.id;

		const font = (prop: string, value: unknown) => {
			const stack = typeof value === 'string' ? fontStack(value, prop === '--font-monospace') : '';
			if (stack) body.style.setProperty(prop, stack);
			else body.style.removeProperty(prop);
		};
		font('--font-interface', c.interfaceFont);
		font('--font-text-override', c.textFont);
		font('--font-monospace', c.monospaceFont);
		body.style.setProperty('--font-text-size', `${c.fontSize}px`);
		body.toggleClass('is-readable-line-width', !!c.readableLineLength);
		for (const d of ['compact', 'comfortable', 'spacious']) body.toggleClass(`density-${d}`, c.density === d);

		const before = getActiveIconPack();
		setIconPack(String(c.iconSet || 'phosphor'), String(c.iconWeight || 'regular'));
		const after = getActiveIconPack();
		body.dataset.iconSet = after.id;
		void before;

		this.app.workspace?.trigger('css-change');
		this.trigger('css-change');
	}

	// ---------------------------------------------------------------------------------------------
	// CSS themes and snippets (files in the homebase)

	/** Find installed themes and snippets, and load the chosen ones. */
	async load(): Promise<void> {
		const { adapter } = this.app.vault;
		this.themes = [];
		this.snippets = [];
		if (await adapter.exists(this.themesFolder)) {
			for (const folder of (await adapter.list(this.themesFolder)).folders) {
				if (await adapter.exists(`${folder}/theme.css`)) this.themes.push(folder.slice(folder.lastIndexOf('/') + 1));
			}
		}
		if (await adapter.exists(this.snippetsFolder)) {
			this.snippets = (await adapter.list(this.snippetsFolder)).files.filter((f) => f.endsWith('.css')).map((f) => f.slice(f.lastIndexOf('/') + 1, -4));
		}
		this.themes.sort((a, b) => a.localeCompare(b));
		this.snippets.sort((a, b) => a.localeCompare(b));
		await this.loadTheme();
		await this.loadSnippets();
		this.trigger('css-change');
	}

	/** Why a theme or snippet was not loaded, if it was refused. */
	refusal(kind: 'theme' | 'snippet', name: string): string[] | null {
		return this.refused.get(`${kind}:${name}`) ?? null;
	}

	private async readChecked(kind: 'theme' | 'snippet', name: string, path: string): Promise<string | null> {
		let css: string;
		try {
			css = await this.app.vault.adapter.read(path);
		} catch (e) {
			console.error(`Could not read a ${kind}:`, errorSummary(e));
			return null;
		}
		const problems = cssProblems(css);
		this.refused.delete(`${kind}:${name}`);
		if (problems.length) {
			this.refused.set(`${kind}:${name}`, problems);
			new Notice(`The ${kind} "${name}" was not loaded: it refers to something outside the app (${problems.join(', ')}), which Docketeer does not allow.`, 10000);
			return null;
		}
		return css;
	}

	private async loadTheme(): Promise<void> {
		const name = String(this.app.config.cssTheme ?? '');
		this.themeEl?.detach();
		this.themeEl = null;
		document.body.toggleClass('has-css-theme', false);
		if (!name || !this.themes.includes(name)) return;
		const css = await this.readChecked('theme', name, `${this.themesFolder}/${name}/theme.css`);
		if (css === null) return;
		this.themeEl = document.head.createEl('style', { attr: { 'data-theme': name } });
		this.themeEl.textContent = css;
		document.body.toggleClass('has-css-theme', true);
	}

	private async loadSnippets(): Promise<void> {
		for (const el of this.snippetEls.values()) el.detach();
		this.snippetEls.clear();
		for (const name of this.enabledSnippets()) {
			if (!this.snippets.includes(name)) continue;
			const css = await this.readChecked('snippet', name, `${this.snippetsFolder}/${name}.css`);
			if (css === null) continue;
			const el = document.head.createEl('style', { attr: { 'data-snippet': name } });
			el.textContent = css;
			this.snippetEls.set(name, el);
		}
	}

	enabledSnippets(): string[] {
		const v = this.app.config.enabledSnippets;
		return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
	}

	async setTheme(name: string): Promise<void> {
		await this.app.setConfig('cssTheme', name);
		await this.loadTheme();
		this.trigger('css-change');
	}

	async setSnippetEnabled(name: string, enabled: boolean): Promise<void> {
		const set = new Set(this.enabledSnippets());
		if (enabled) set.add(name); else set.delete(name);
		await this.app.setConfig('enabledSnippets', [...set]);
		await this.loadSnippets();
		this.trigger('css-change');
	}

	/** Write a starter theme to edit, and return its folder name. */
	async createThemeTemplate(): Promise<string> {
		const { adapter } = this.app.vault;
		let name = 'my-theme';
		for (let n = 2; await adapter.exists(`${this.themesFolder}/${name}`); n++) name = `my-theme-${n}`;
		await adapter.write(`${this.themesFolder}/${name}/theme.css`, THEME_TEMPLATE);
		await adapter.write(`${this.themesFolder}/${name}/manifest.json`, JSON.stringify({ name, version: '0.1.0', author: '' }, null, '\t'));
		await this.load();
		return name;
	}

	override on(name: 'css-change', callback: () => unknown, ctx?: unknown): EventRef;
	override on(name: string, callback: (...data: any[]) => unknown, ctx?: unknown): EventRef;
	override on(name: string, callback: (...data: any[]) => unknown, ctx?: unknown): EventRef {
		return super.on(name, callback, ctx);
	}
}

const THEME_TEMPLATE = `/*
 * A Docketeer theme. It is loaded after the app's stylesheet, so anything here wins.
 *
 * Quickest change: override the palette tokens for dark and/or light mode. Every colour in the app
 * comes from these (see packages/api/src/themes/palettes.ts for the full list):
 *   --doom-bg, --doom-bg-alt, --doom-base0 … --doom-base8   surfaces, darkest to lightest (dark mode)
 *   --doom-fg, --doom-text-muted, --doom-text-faint          text
 *   --doom-blue (accent), --doom-red, --doom-orange, --doom-yellow, --doom-green,
 *   --doom-teal, --doom-cyan, --doom-violet, --doom-magenta  and their *-rgb and *-text forms
 *   --doom-hairline, --doom-border-subtle, --doom-border-strong
 *   --h1-color … --h6-color                                  heading colours
 *
 * Themes cannot load anything from outside the app: @import and url() other than data: are refused.
 */

body.theme-dark {
	/* --doom-bg: #101010; */
}

body.theme-light {
	/* --doom-bg: #fffdf7; */
}
`;
