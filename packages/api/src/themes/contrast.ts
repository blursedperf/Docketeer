/**
 * Contrast guard. Every text colour the stylesheet puts on a surface is listed here with the WCAG
 * minimum it must meet (4.5:1 for text, 7:1 for body text, 3:1 for icons). When a palette — built in,
 * from a plugin, or with a custom accent — falls short, the text colour is moved toward black or white
 * until it passes. Keep this list in step with app.css when a new pairing is added.
 */

/** [text token, surface token, minimum ratio, where it is used]. */
export const CONTRAST_PAIRS: [string, string, number, string][] = [
	['doom-fg', 'doom-bg', 7, 'note text'],
	['doom-fg', 'doom-bg-alt', 7, 'file tree, popups'],
	['doom-fg', 'doom-base1', 7, 'buttons'],
	['doom-text-muted', 'doom-bg-alt', 4.5, 'header line, descriptions'],
	['doom-text-muted', 'doom-base0', 4.5, 'settings navigation'],
	['doom-text-faint', 'doom-base0', 4.5, 'inactive tabs, prompt instructions'],
	['doom-text-faint', 'doom-bg-alt', 4.5, 'suggestion notes, command prefixes'],
	['doom-blue-text', 'doom-bg', 4.5, 'active tab, links'],
	['doom-blue-text', 'doom-bg-alt', 4.5, 'folders, selected rows'],
	['doom-blue-text', 'doom-base0', 4.5, 'prompt label, key hints'],
	['doom-magenta-text', 'doom-bg-alt', 4.5, 'homebase title'],
	['doom-magenta-text', 'doom-base0', 4.5, 'settings group titles'],
	['doom-magenta-text', 'doom-base1', 4.5, 'property keys'],
	['doom-comment', 'doom-bg', 4.5, '%% comments'],
	['doom-comment', 'doom-base1', 4.5, 'frontmatter'],
	['doom-teal-text', 'doom-base1', 4.5, 'inline code'],
	['doom-yellow-text', 'doom-base2', 4.5, 'hotkeys, file-type tags'],
	['doom-orange-text', 'doom-bg', 4.5, 'bold'],
	['doom-green-text', 'doom-bg', 4.5, 'italic'],
	['doom-violet-text', 'doom-bg', 4.5, 'footnotes'],
	['doom-modeline-fg', 'doom-modeline-bg', 4.5, 'modeline'],
	['doom-modeline-badge-fg', 'doom-modeline-badge-bg', 4.5, 'modeline badge'],
	['doom-on-accent', 'doom-blue-fill', 4.5, 'primary buttons'],
];

type RGB = [number, number, number];

export function parseHex(hex: string): RGB | null {
	const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
	if (!m) return null;
	let h = m[1]!;
	if (h.length === 3) h = h.split('').map((c) => c + c).join('');
	return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function toHex(c: RGB): string {
	return `#${c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')}`;
}

export function luminance([r, g, b]: RGB): number {
	const lin = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
	return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrastRatio(a: RGB, b: RGB): number {
	const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p) as [number, number];
	return (x + 0.05) / (y + 0.05);
}

/** Follow `var(--x)` references to a colour, within one palette's tokens. */
export function resolveToken(vars: Record<string, string>, token: string): string | null {
	let v = vars[token];
	for (let i = 0; v !== undefined && i < 6; i++) {
		const m = /^var\(--([a-z0-9-]+)(?:,[^)]*)?\)$/i.exec(v.trim());
		if (!m) return v;
		v = vars[m[1]!];
	}
	return v ?? null;
}

/** `fg` moved toward black or white (whichever the surface contrasts with) until it meets `min`. */
export function meetContrast(fg: RGB, bg: RGB, min: number): RGB {
	if (contrastRatio(fg, bg) >= min) return fg;
	const target: RGB = luminance(bg) > 0.18 ? [0, 0, 0] : [255, 255, 255];
	for (let t = 0.05; t <= 1.0001; t += 0.05) {
		const c = fg.map((v, i) => v + (target[i]! - v) * t) as RGB;
		if (contrastRatio(c, bg) >= min) return c;
	}
	return target;
}

/**
 * Overrides that make a palette meet every pair. Returns only the tokens that changed, so palettes that
 * already pass are left exactly as designed.
 */
export function contrastFixes(vars: Record<string, string>): Record<string, string> {
	const fixed: Record<string, string> = {};
	const current = (t: string) => fixed[t] ?? resolveToken(vars, t);
	for (const [text, surface, min] of CONTRAST_PAIRS) {
		const fg = parseHex(current(text) ?? '');
		const bg = parseHex(current(surface) ?? '');
		if (!fg || !bg) continue;
		const better = meetContrast(fg, bg, min);
		if (better !== fg) fixed[text] = toHex(better);
	}
	return fixed;
}
