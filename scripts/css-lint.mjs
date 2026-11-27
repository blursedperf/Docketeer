#!/usr/bin/env node
/*
 * Design-token lint for the app stylesheet and the built-in plugins' (docs/design/polish-plan.md §3.1):
 * spacing (padding, margin, gap) must use --space-* tokens (or values worked out from them and the density
 * tokens), and font sizes --text-* tokens or em. Tokens are what the Density setting changes, so a raw value
 * would not follow it. Small values that are
 * part of a shape, not spacing (0, 1–3px nudges), are allowed; anything else needs an entry in ALLOW.
 *
 *   node scripts/css-lint.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
/** The stylesheets checked: the app's, and each built-in plugin's that is written on the tokens. */
const FILES = ['packages/app/src/renderer/app.css', 'plugins/pomodoro-flashcards/styles.css'];
/** Selector fragments allowed a raw value, with why. */
const ALLOW = [
	['body.is-frameless', 'padding', 'room for the window buttons: sized by the system (env) or the macOS traffic lights'],
	['.welcome h1', 'font-size', 'display heading, one-off'],
	['.nav-file-tag', 'font-size', 'badge text below the UI scale'],
	['.cm-panel.cm-search [name=close]', 'font-size', 'CodeMirror close glyph'],
	['.markdown-rendered .task-list-item-checkbox', 'margin', 'aligns the checkbox to the text baseline'],
	['.prompt-input-container::before', 'padding', 'key-cap shape'],
	['.suggestion-hotkey', 'padding', 'key-cap shape'],
	['.cm-inline-code', 'padding', 'inline code shape'],
	['.markdown-rendered code', 'padding', 'inline code shape'],
	['input.color-picker', 'padding', 'native colour swatch inset'],
	['.app-container', 'padding', 'iPhone and iPad: clear of the home indicator and rounded corners, sized by the system (env)'],
	['.is-compact .compact-docket-button', 'padding', 'clear of the home indicator, sized by the system (env)'],
	['.is-compact .docket.is-peek', 'padding', 'clear of the home indicator unless the keyboard covers it (env)'],
	['.is-compact .modal.mod-settings', 'padding', 'clear of the Dynamic Island, sized by the system (env)'],
	['.is-compact .pomo-fc-view-root', 'padding', 'Pomodoro Flashcards on a phone: clear of the home indicator (env)'],
	['.mod-mobile .pomo-fc-modal-dialog .pomo-fc-modal-header', 'padding', 'Pomodoro Flashcards on a phone: clear of the Dynamic Island (env)'],
	['.is-compact .vertical-tab-content-container', 'padding', 'clear of the home indicator, sized by the system (env)'],
];

const problems = [];
for (const file of FILES) {
	const css = readFileSync(join(ROOT, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '));
	const ok = (v) => /^(?:0|auto|inherit|0 auto|-?[0-3]px)$/.test(v) || !/\d(?:px|rem)\b/.test(v.replace(/var\([^)]*\)/g, '').replace(/calc\([^)]*\)/g, (c) => (/--space-|--status-h|--header-band|--control-h/.test(c) ? '' : c)));
	for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
		const selector = m[1].trim().replace(/\s+/g, ' ');
		if (/^body(?:\.density-\w+|\.theme-\w+(?:, body\.theme-\w+)?)?$/.test(selector) || selector.startsWith('@keyframes') || /^(from|to)$/.test(selector)) continue;
		for (const decl of m[2].split(';')) {
			const d = /^\s*([a-z-]+)\s*:\s*(.+?)\s*$/s.exec(decl);
			if (!d) continue;
			const [, prop, value] = d;
			const kind = /^(?:padding|margin|gap|row-gap|column-gap)(?:-|$)/.test(prop) ? 'spacing' : prop === 'font-size' ? 'font-size' : null;
			if (!kind) continue;
			const fine = kind === 'font-size' ? /var\(--text-|var\(--h[1-6]-size\)|em\b|inherit|var\(--font-text-size\)/.test(value) : value.split(/\s+(?![^(]*\))/).every(ok);
			if (fine) continue;
			if (ALLOW.some(([sel, p]) => selector.includes(sel) && prop.startsWith(p))) continue;
			const line = css.slice(0, m.index).split('\n').length;
			problems.push(`${file}:${line} ${selector} { ${prop}: ${value} }`);
		}
	}
}
if (problems.length) {
	console.error(`Design-token lint: ${problems.length} raw value(s); use --space-* / --text-* tokens or add to ALLOW:`);
	for (const p of problems) console.error(`  ${p}`);
	process.exit(1);
}
console.log(`Design-token lint passed: spacing and font sizes use tokens (${FILES.length} stylesheets).`);
