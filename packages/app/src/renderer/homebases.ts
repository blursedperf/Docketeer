/**
 * Switching homebases: one list in the Docket (Mod+Shift+O, or the homebase's name in the status bar) of the
 * recent homebases, then opening a folder, creating one, and the example homebase. A homebase whose folder
 * has gone is marked as missing; "Remove a homebase from this list" takes entries off without touching folders.
 *
 * Templates: "Save this homebase's panels as a template…" keeps its Docket panels (`.quire/panels.json`) by name in the
 * app's settings; creating a homebase then offers them after Legal and Generic.
 */
import { type App, type HostBridge, Notice, type SearchResult, formatHotkey, setIcon } from '@quire/api';
import type { Docket } from './docket/docket';
import { ConfirmModal, NameModal } from './dialogs';
import { type HomebaseTemplate, MAX_TEMPLATES, describeTemplate, parsePanelsConfig, parseTemplates, templateFolders, withTemplate } from './docket/panels-model';

type Recent = Awaited<ReturnType<App['host']['app']['recentVaults']>>[number];

const docketOf = (app: App) => (app as unknown as { docketUI?: Docket }).docketUI ?? null;

/** "~/Documents/Torts" for a path in the home folder, as written otherwise. */
export function shortPath(p: string, home: string | null): string {
	return home && (p === home || p.startsWith(`${home}/`) || p.startsWith(`${home}\\`)) ? `~${p.slice(home.length)}` : p;
}

function homeOf(recents: Recent[], current: string | null): string | null {
	const m = /^(\/home\/[^/]+|\/Users\/[^/]+|[A-Za-z]:\\Users\\[^\\]+)/.exec(current ?? recents[0]?.path ?? '');
	return m ? m[1]! : null;
}

/** Open the homebase at `path`, saying so if its folder has gone (and taking it off the list). */
export async function openHomebase(app: App, r: Pick<Recent, 'path' | 'name'>): Promise<void> {
	if (await app.host.app.openVault(r.path)) return;
	new Notice(`The folder for “${r.name}” is not there any more (${r.path}). It has been taken off the list.`);
	await app.host.app.forgetVault?.(r.path);
}

/** The items of the switcher: recent homebases (this one first), then the other ways to open one. */
export async function switcherItems(app: App): Promise<SearchResult[]> {
	const recents = await app.host.app.recentVaults();
	const current = app.host.vault?.path ?? null;
	const home = homeOf(recents, current);
	const items: SearchResult[] = [];
	const others = recents.filter((r) => r.path !== current);
	for (const r of others) {
		items.push({
			id: `homebase:${r.path}`, type: 'Recent homebases', icon: r.missing ? 'folder-x' : 'house',
			title: r.name, detail: r.missing ? `Not found · ${shortPath(r.path, home)}` : shortPath(r.path, home),
			open: () => { void openHomebase(app, r); },
		});
	}
	if (current) {
		items.push({
			id: 'homebase:current', type: 'Recent homebases', icon: 'check', title: app.host.vault!.name,
			detail: `This homebase · ${shortPath(current, home)}`, open: () => new Notice('This homebase is open already.'),
		});
	}
	const action = (id: string, title: string, icon: string, detail: string, run: () => unknown): SearchResult => ({ id, type: 'Open', icon, title, detail, open: () => { void run(); } });
	items.push(action('homebase:open-folder', 'Open a folder as a homebase…', 'folder-open', 'Any folder; its Markdown files become notes', () => app.host.app.chooseVault(false)));
	items.push(action('homebase:create', 'Create a new homebase…', 'folder-plus', 'Legal or generic panels, then a folder', () => createHomebase(app)));
	if (app.host.app.openExample) items.push(action('homebase:example', 'Open the example homebase', 'graduation-cap', 'Sample law notes in “Caselore example” in your Documents', () => openExample(app)));
	if (others.length) items.push(action('homebase:forget', 'Remove a homebase from this list…', 'list-x', 'The folder and its notes stay where they are', () => showForget(app)));
	return items;
}

/** The two layouts a new homebase can start with, in words. */
export const LAYOUTS = [
	{ id: 'legal' as const, title: 'Legal', icon: 'scale', detail: 'Subjects, Authorities, Outline, Cite, Homebase and Layout panels: law notes with AGLC4 citations (as Caselore comes)' },
	{ id: 'generic' as const, title: 'Generic', icon: 'folder-tree', detail: 'Three panels: Files and Folders, Homebase and Layout; the others can be shown later' },
];

// -------------------------------------------------------------------------------------------------
// Templates

/** The saved templates (the app's `homebaseTemplates` setting). */
export async function loadTemplates(host: Pick<HostBridge, 'app'>): Promise<HomebaseTemplate[]> {
	return parseTemplates((await host.app.getConfig()).homebaseTemplates);
}

/** Create a homebase from a template: the folder, then its panels and the folders they show. */
export function createFromTemplate(host: Pick<HostBridge, 'app'>, t: HomebaseTemplate): Promise<boolean> {
	return host.app.chooseVault(true, { panels: JSON.stringify(t.panels), folders: templateFolders(t.panels) });
}

/** This homebase's panels, as its panels file has them (the built-in panels when it has none). */
async function currentPanels(app: App) {
	const path = `${app.vault.configDir}/panels.json`;
	return parsePanelsConfig((await app.vault.adapter.exists(path)) ? await app.vault.adapter.read(path) : '{}');
}

/** Keep this homebase's panels as the template `name`, replacing one of that name. */
export async function saveTemplate(app: App, name: string): Promise<HomebaseTemplate> {
	const t: HomebaseTemplate = { name: name.trim(), panels: await currentPanels(app) };
	await app.host.app.setConfig({ homebaseTemplates: withTemplate(await loadTemplates(app.host), t) });
	return t;
}

export async function removeTemplate(app: App, name: string): Promise<void> {
	const left = (await loadTemplates(app.host)).filter((t) => t.name.toLowerCase() !== name.toLowerCase());
	await app.host.app.setConfig({ homebaseTemplates: left });
}

/** Ask for a name, then save (asking first before replacing a template of that name). */
export function promptSaveTemplate(app: App): void {
	new NameModal(app, "Save this homebase's panels as a template", app.host.vault?.name ?? 'My template', 'Save', (name) => {
		if (!name) return;
		void (async () => {
			const list = await loadTemplates(app.host);
			const same = list.find((t) => t.name.toLowerCase() === name.toLowerCase());
			const save = async () => {
				const t = await saveTemplate(app, name);
				new Notice(`Saved the template “${t.name}”. Choose it when you create a new homebase.`);
			};
			if (same) new ConfirmModal(app, 'Replace the template?', `There is a template called “${same.name}” already. Replace it with this homebase's panels?`, 'Replace', () => { void save(); }).open();
			else if (list.length >= MAX_TEMPLATES) new Notice(`There are ${MAX_TEMPLATES} templates already: remove one first.`);
			else await save();
		})();
	}).open();
}

async function showRemoveTemplate(app: App): Promise<void> {
	const docket = docketOf(app);
	const list = await loadTemplates(app.host);
	if (!list.length) { new Notice("There are no templates yet. Save one with “Save this homebase's panels as a template…”."); return; }
	if (!docket) return;
	docket.showList('Remove a homebase template', list.map((t) => ({
		id: `template-remove:${t.name}`, type: 'Your templates', icon: 'trash-2', title: t.name, detail: `${describeTemplate(t)} · homebases made from it keep their panels`,
		open: () => { void removeTemplate(app, t.name).then(() => { new Notice(`Removed the template “${t.name}”.`); void showRemoveTemplate(app); }); },
	})));
}

/** Create a homebase: first which layout (a list in the Docket: Legal, Generic, then templates), then the folder. */
export function createHomebase(app: App): void {
	const docket = docketOf(app);
	if (!docket) { void app.host.app.chooseVault(true, 'legal'); return; }
	void loadTemplates(app.host).then((templates) => {
		const items: SearchResult[] = LAYOUTS.map((l) => ({
			id: `layout:${l.id}`, type: 'Layout', icon: l.icon, title: l.title, detail: l.detail,
			open: () => { void app.host.app.chooseVault(true, l.id); },
		}));
		for (const t of templates) {
			items.push({ id: `template:${t.name}`, type: 'Your templates', icon: 'layout-list', title: t.name, detail: describeTemplate(t), open: () => { void createFromTemplate(app.host, t); } });
		}
		if (templates.length) items.push({ id: 'template:remove', type: 'Change', icon: 'trash-2', title: 'Remove a template…', detail: 'Homebases made from it keep their panels', open: () => { void showRemoveTemplate(app); } });
		else items.push({ id: 'template:save', type: 'Change', icon: 'layout-list', title: "Save this homebase's panels as a template…", detail: 'Then it is offered here', open: () => promptSaveTemplate(app) });
		docket.showList('New homebase: which panels should it start with?', items);
	});
}

export async function openExample(app: App): Promise<void> {
	try {
		await app.host.app.openExample?.();
	} catch (e) {
		new Notice(`Could not open the example homebase: ${e instanceof Error ? e.message : String(e)}`);
	}
}

async function showForget(app: App): Promise<void> {
	const docket = docketOf(app);
	if (!docket) return;
	const current = app.host.vault?.path ?? null;
	const recents = (await app.host.app.recentVaults()).filter((r) => r.path !== current);
	const home = homeOf(recents, current);
	docket.showList('Remove a homebase from the list', recents.map((r) => ({
		id: `forget:${r.path}`, type: 'Recent homebases', icon: 'list-x', title: r.name,
		detail: `${r.missing ? 'Not found · ' : ''}${shortPath(r.path, home)}`,
		open: () => {
			void app.host.app.forgetVault?.(r.path).then(() => {
				new Notice(`“${r.name}” is off the list. Its folder was not touched.`);
				void showForget(app);
			});
		},
	})));
}

export async function showSwitcher(app: App): Promise<void> {
	const docket = docketOf(app);
	if (!docket) { void app.host.app.chooseVault(false); return; }
	docket.showList('Switch homebase', await switcherItems(app));
}

export function registerHomebases(app: App): void {
	const add = (c: Parameters<App['commands']['addCommand']>[0]) => app.commands.addCommand({ section: 'Homebase', ...c });
	add({
		id: 'app:switch-homebase', name: 'Switch homebase…', icon: 'house', hotkeys: [{ modifiers: ['Mod', 'Shift'], key: 'o' }],
		aliases: ['Recent homebases', 'Open vault', 'Change homebase'], run: () => { void showSwitcher(app); },
	});
	add({ id: 'app:create-homebase', name: 'Create a new homebase…', icon: 'folder-plus', aliases: ['New homebase', 'New vault', 'Generic homebase', 'Legal homebase'], run: () => createHomebase(app) });
	add({ id: 'app:open-example-homebase', name: 'Open the example homebase', icon: 'graduation-cap', aliases: ['Sample notes', 'Demo', 'Tutorial'], when: () => !!app.host.app.openExample, run: () => { void openExample(app); } });
	add({ id: 'app:forget-homebase', name: 'Remove a homebase from the recent list…', icon: 'list-x', run: () => { void showForget(app); } });
	add({ id: 'app:save-homebase-template', name: "Save this homebase's panels as a template…", icon: 'layout-list', aliases: ['Homebase template', 'Save panels', 'Save layout as template'], run: () => promptSaveTemplate(app) });
	add({ id: 'app:remove-homebase-template', name: 'Remove a homebase template…', icon: 'trash-2', aliases: ['Delete template'], run: () => { void showRemoveTemplate(app); } });

	// The homebase's name at the left of the status bar, after the mode badge: click to switch.
	const el = createDiv({ cls: 'status-bar-item mod-clickable mod-homebase', attr: { 'aria-label': 'Switch homebase', role: 'button', tabindex: '0' } });
	const badge = app.statusBarEl.querySelector('.status-bar-badge');
	if (badge) badge.after(el);
	else app.statusBarEl.prepend(el);
	setIcon(el.createSpan({ cls: 'status-bar-item-icon' }), 'house');
	el.createSpan({ text: app.host.vault?.name ?? '' });
	el.addEventListener('click', () => { void showSwitcher(app); });
	el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); void showSwitcher(app); } });

	// Settings, beside the homebase's name: a gear that opens them (as Mod+, does).
	const cmd = app.commands.findCommand('app:open-settings');
	const key = cmd ? app.commands.hotkeysFor(cmd)[0] : undefined;
	const label = key ? `Settings (${formatHotkey(key)})` : 'Settings';
	const gear = createDiv({ cls: 'status-bar-item mod-clickable mod-settings', attr: { 'aria-label': label, title: label, role: 'button', tabindex: '0' } });
	el.after(gear);
	setIcon(gear.createSpan({ cls: 'status-bar-item-icon' }), 'settings');
	const open = () => app.setting.open();
	gear.addEventListener('click', open);
	gear.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
}
