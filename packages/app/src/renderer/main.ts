/**
 * Renderer entry. Publishes the app's single copy of the API and CodeMirror for plugins (their bare
 * imports resolve through the page's import map to shims that read `__quireModules`), then starts the app
 * or, with no vault open, the welcome screen.
 */
import * as api from '@quire/api';
import * as cmState from '@codemirror/state';
import * as cmView from '@codemirror/view';
import * as cmLanguage from '@codemirror/language';
import * as cmCommands from '@codemirror/commands';
import * as cmSearch from '@codemirror/search';
import * as cmAutocomplete from '@codemirror/autocomplete';
import * as cmMarkdown from '@codemirror/lang-markdown';
import * as lezerCommon from '@lezer/common';
import * as lezerHighlight from '@lezer/highlight';
import * as lezerMarkdown from '@lezer/markdown';
import { App, applyHostPlatform, getHost, setIcon, setIconPack } from '@quire/api';
import { watchLayout } from './layout-mode';
import { registerCore } from './core';
import { registerBundledIconPacks } from './icon-packs';
import { runBench, runShots, runSmoke } from './smoke';
import { LAYOUTS, createFromTemplate, loadTemplates } from './homebases';
import { describeTemplate } from './docket/panels-model';

(globalThis as Record<string, unknown>).__quireModules = {
	'@quire/api': api,
	'@codemirror/state': cmState,
	'@codemirror/view': cmView,
	'@codemirror/language': cmLanguage,
	'@codemirror/commands': cmCommands,
	'@codemirror/search': cmSearch,
	'@codemirror/autocomplete': cmAutocomplete,
	'@codemirror/lang-markdown': cmMarkdown,
	'@lezer/common': lezerCommon,
	'@lezer/highlight': lezerHighlight,
	'@lezer/markdown': lezerMarkdown,
};

registerBundledIconPacks();
setIconPack('phosphor');

async function welcome() {
	const host = getHost();
	document.title = 'Caselore';
	const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
	document.body.addClass(dark ? 'theme-dark' : 'theme-light');
	const root = document.body.createDiv({ cls: 'welcome' });
	const box = root.createDiv({ cls: 'welcome-box' });
	const logo = box.createDiv({ cls: 'welcome-logo' });
	setIcon(logo, 'notebook-pen');
	box.createEl('h1', { text: 'Caselore' });
	box.createEl('p', { cls: 'welcome-tagline', text: 'Notes in plain Markdown files, on your computer. Nothing goes online.' });
	const actions = box.createDiv({ cls: 'welcome-actions' });
	const b1 = actions.createEl('button', { cls: 'mod-cta', text: 'Open a folder as a homebase' });
	b1.addEventListener('click', () => { void host.app.chooseVault(false); });
	const b2 = actions.createEl('button', { text: 'Create a new homebase' });
	// Creating: first which panels it starts with, Legal (as Caselore comes) or Generic.
	const layouts = box.createDiv({ cls: 'welcome-layouts', attr: { hidden: '', role: 'group', 'aria-label': 'Panels for the new homebase' } });
	layouts.createEl('p', { cls: 'welcome-layouts-title', text: 'Which panels should it start with?' });
	const layoutCard = (attr: Record<string, string>, icon: string, name: string, detail: string, run: () => unknown) => {
		const card = layouts.createEl('button', { cls: 'welcome-layout', attr: { type: 'button', ...attr } });
		setIcon(card.createDiv({ cls: 'welcome-layout-icon' }), icon);
		const text = card.createDiv({ cls: 'welcome-layout-text' });
		text.createDiv({ cls: 'welcome-layout-name', text: name });
		text.createDiv({ cls: 'welcome-layout-detail', text: detail });
		card.addEventListener('click', () => { void run(); });
	};
	for (const l of LAYOUTS) layoutCard({ 'data-layout': l.id }, l.icon, l.title, l.detail, () => host.app.chooseVault(true, l.id));
	// Templates saved from a homebase ("Save this homebase's panels as a template…").
	void loadTemplates(host).then((templates) => {
		for (const t of templates) layoutCard({ 'data-template': t.name }, 'layout-list', t.name, describeTemplate(t), () => createFromTemplate(host, t));
	}).catch((e: unknown) => console.error('Could not read the homebase templates', e));
	b2.addEventListener('click', () => {
		layouts.toggleAttribute('hidden');
		if (!layouts.hasAttribute('hidden')) layouts.querySelector<HTMLElement>('.welcome-layout')?.focus();
	});
	if (host.app.openExample) {
		const b3 = actions.createEl('button', { text: 'Try the example homebase' });
		b3.setAttr('title', 'Sample law notes, copied into “Caselore example” in your Documents');
		b3.addEventListener('click', () => { void host.app.openExample!().catch((e: unknown) => { status.setText(`Could not open the example homebase: ${e instanceof Error ? e.message : String(e)}`); }); });
	}
	const status = box.createEl('p', { cls: 'welcome-status', attr: { role: 'status' } });
	const recentBox = box.createDiv();
	const renderRecent = async () => {
		recentBox.empty();
		const recent = await host.app.recentVaults();
		if (!recent.length) return;
		recentBox.createEl('h2', { text: 'Recent homebases' });
		const list = recentBox.createDiv({ cls: 'welcome-recent' });
		for (const r of recent) {
			const item = list.createDiv({ cls: `welcome-recent-item${r.missing ? ' is-missing' : ''}`, attr: { role: 'button', tabindex: '0' } });
			const text = item.createDiv({ cls: 'welcome-recent-text' });
			text.createDiv({ cls: 'welcome-recent-name', text: r.name });
			text.createDiv({ cls: 'welcome-recent-path', text: r.missing ? `Not found · ${r.path}` : r.path });
			const open = async () => {
				if (await host.app.openVault(r.path)) return;
				status.setText(`The folder for “${r.name}” is not there any more. Remove it from the list with ×.`);
			};
			item.addEventListener('click', () => { void open(); });
			item.addEventListener('keydown', (e) => { if (e.key === 'Enter') void open(); });
			if (host.app.forgetVault) {
				const x = item.createEl('button', { cls: 'clickable-icon welcome-recent-remove', attr: { 'aria-label': `Remove ${r.name} from the list (the folder stays)`, title: 'Remove from the list (the folder stays)' } });
				setIcon(x, 'x');
				x.addEventListener('click', (e) => { e.stopPropagation(); void host.app.forgetVault!(r.path).then(renderRecent); });
			}
		}
	};
	await renderRecent();
}

/** With the title bar hidden: mark the page (the top bar moves the window), and colour the window buttons to match. */
function frameless(host: ReturnType<typeof getHost>, app?: App): void {
	if (!host.app.frameless) return;
	document.body.addClass('is-frameless', `is-${host.platform}`);
	const color = () => {
		const s = getComputedStyle(document.body);
		const bg = s.getPropertyValue('--doom-base0').trim() || '#121418';
		const fg = s.getPropertyValue('--doom-text-muted').trim() || '#c9d0d9';
		void host.app.setTitleBarColors?.(bg, fg);
	};
	color();
	if (app) app.customCss.on('css-change', color);
}

async function start() {
	const host = getHost();
	// iPhone and iPad: the device flags come from the host, before anything reads them.
	applyHostPlatform(host);
	watchLayout(document.body);
	frameless(host);
	if (!host.vault) {
		await welcome();
		return;
	}
	document.title = `${host.vault.name} - Caselore`;
	const app = new App(host, document.body);
	(globalThis as Record<string, unknown>).app = app;
	const core = registerCore(app);
	await app.start();
	frameless(host, app);
	core.reveal();
	if (host.app.isShots) {
		// Screenshots for comparison: no caret, no animations.
		document.body.addClass('is-shots');
		await runShots(app);
	}
	else if (host.app.isBench) await runBench(app);
	else if (host.app.isSmoke) await runSmoke(app);
}

start().catch((e: unknown) => {
	console.error('Caselore failed to start', e);
	const el = document.body.createDiv({ cls: 'fatal-error' });
	el.createEl('h2', { text: 'Caselore failed to start' });
	el.createEl('pre', { text: e instanceof Error ? `${e.message}\n\n${e.stack ?? ''}` : String(e) });
	if (getHost().app.isSmoke) getHost().app.smokeReport?.({ ok: false, error: String(e) });
});
