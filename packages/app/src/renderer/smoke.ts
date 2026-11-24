/**
 * Smoke test, run by `npm run smoke` (Electron offscreen, on a throwaway vault). Exercises the core app
 * and the AGLC4 plugin end to end, and checks that network access is refused. Not part of the normal
 * app flow: it only runs when the main process was started with --smoke.
 */
import { EditorView } from '@codemirror/view';
import { type App, MarkdownView, type TFile, topModal } from '@quire/api';

interface Check { name: string; ok: boolean; detail?: string; }

const sleep = (ms: number) => new Promise((r) => window.setTimeout(r, ms));

async function until(cond: () => boolean | Promise<boolean>, ms = 5000): Promise<boolean> {
	const end = Date.now() + ms;
	while (Date.now() < end) {
		if (await cond()) return true;
		await sleep(50);
	}
	return false;
}

export async function runSmoke(app: App): Promise<void> {
	const checks: Check[] = [];
	const notices: string[] = [];
	(globalThis as { __quireNotices?: string[] }).__quireNotices = notices;
	const check = async (name: string, fn: () => Promise<boolean | string> | boolean | string) => {
		try {
			const r = await fn();
			checks.push({ name, ok: r === true, detail: typeof r === 'string' ? r : undefined });
		} catch (e) {
			checks.push({ name, ok: false, detail: e instanceof Error ? `${e.message}\n${e.stack}` : String(e) });
		}
	};
	const { vault, workspace, metadataCache, commands } = app;

	await check('vault indexed', () => vault.getMarkdownFiles().length === 3 || `found ${vault.getMarkdownFiles().map((f) => f.path).join(', ')}`);
	await check('frontmatter parsed', () => {
		const f = vault.getFileByPath('Second note.md');
		return JSON.stringify(metadataCache.getFileCache(f)?.frontmatter) === '{"tags":["test"]}' || JSON.stringify(metadataCache.getFileCache(f));
	});
	await check('links resolved', () => metadataCache.resolvedLinks['Welcome.md']?.['Second note.md'] === 1 || JSON.stringify(metadataCache.resolvedLinks));
	await check('file explorer shown', () => workspace.getLeavesOfType('file-explorer').length === 1);

	await check('open, edit and save a note', async () => {
		const f = vault.getFileByPath('Welcome.md')!;
		await workspace.getLeaf(false).openFile(f);
		const view = workspace.getActiveViewOfType(MarkdownView);
		if (!view) return 'no markdown view';
		view.editor.replaceRange('Typed in the smoke test. ', { line: 2, ch: 0 });
		await view.save();
		const disk = await vault.adapter.read('Welcome.md');
		return disk.includes('Typed in the smoke test.') || disk;
	});
	await check('reading view renders links and footnotes', async () => {
		const view = workspace.getActiveViewOfType(MarkdownView)!;
		await view.setMode('preview');
		const ok = !!view.previewEl.querySelector('a.internal-link[data-href="Second note"]') && !!view.previewEl.querySelector('.footnotes, section.footnotes, hr.footnotes-sep');
		const html = view.previewEl.textContent ?? '';
		await view.setMode('source');
		return ok || html;
	});
	await check('rename updates links', async () => {
		const f = vault.getFileByPath('Second note.md')!;
		await app.fileManager.renameFile(f, 'Renamed note.md');
		await workspace.saveAll();
		const text = await vault.read(vault.getFileByPath('Welcome.md')!);
		return text.includes('[[Renamed note]]') || text;
	});
	await check('command palette lists commands', () => commands.listCommands().length > 20);

	// The AGLC4 plugin.
	const id = 'aglc-citations';
	await check('AGLC4 plugin loaded', () => !!app.plugins.getPlugin(id) || `errors: ${app.plugins.loadError(id)}; manifests: ${Object.keys(app.plugins.manifests).join(', ')}`);
	await check('AGLC4: create example essay', async () => {
		commands.executeCommandById(`${id}:create-example-essay`);
		return until(() => workspace.getActiveFile()?.basename === 'AGLC4 example essay', 8000);
	});
	await check('AGLC4: status bar shows the problems', async () => {
		const ok = await until(() => /AGLC4 \d+✕/.test(app.statusBarEl.textContent ?? ''), 5000);
		return ok || app.statusBarEl.textContent || 'empty';
	});
	await check('AGLC4: underlines problems in the editor', async () => {
		// The mistakes are in the footnotes at the end; the editor only draws what is on screen.
		const cm = workspace.getActiveViewOfType(MarkdownView)!.editor.cm;
		cm.dispatch({ effects: EditorView.scrollIntoView(cm.state.doc.length, { y: 'end' }) });
		const ok = await until(() => document.querySelectorAll('.cm-editor .aglc-issue').length > 0, 5000);
		cm.dispatch({ effects: EditorView.scrollIntoView(0, { y: 'start' }) });
		return ok || `status: ${app.statusBarEl.textContent}`;
	});
	await check('AGLC4: list problems', async () => {
		commands.executeCommandById(`${id}:show-issues`);
		const ok = await until(() => document.querySelectorAll('.modal-container .suggestion-item').length > 0, 3000);
		topModal()?.close();
		return ok;
	});
	await check('AGLC4: fix all', async () => {
		const before = workspace.getActiveViewOfType(MarkdownView)!.editor.getValue();
		commands.executeCommandById(`${id}:fix-all`);
		await sleep(100);
		const after = workspace.getActiveViewOfType(MarkdownView)!.editor.getValue();
		return after !== before || notices.slice(-1)[0] || 'no change';
	});
	await check('AGLC4: export to Word', async () => {
		commands.executeCommandById(`${id}:export-docx`);
		const ok = await until(() => vault.getFiles().some((f) => f.extension === 'docx' && f.stat.size > 1000), 15000);
		return ok || notices.join(' | ');
	});
	await check('AGLC4: export to HTML', async () => {
		commands.executeCommandById(`${id}:export-html`);
		return until(() => vault.getFiles().some((f) => f.extension === 'html'), 8000);
	});
	await check('AGLC4: version history saved', async () => {
		return until(async () => (await vault.adapter.list('.aglc-history').catch(() => ({ files: [], folders: [] }))).folders.length + (await vault.adapter.list('.aglc-history').catch(() => ({ files: [], folders: [] }))).files.length > 0, 8000);
	});
	await check('AGLC4: insert footnote opens the footnote pane', async () => {
		const view = workspace.getActiveViewOfType(MarkdownView)!;
		const ed = view.editor;
		const line = ed.getValue().split('\n').findIndex((l) => /^[A-Z][^#\n]{40,}\.$/.test(l));
		if (line < 0) return 'no paragraph found';
		ed.setCursor({ line, ch: ed.getLine(line).length });
		const leavesBefore = workspace.getLeavesOfType('markdown').length;
		commands.executeCommandById(`${id}:insert-footnote`);
		const ok = await until(() => workspace.getLeavesOfType('markdown').length === leavesBefore + 1, 5000);
		return ok || `markdown leaves: ${workspace.getLeavesOfType('markdown').length}`;
	});
	await check('AGLC4: cite a kind of source', async () => {
		commands.executeCommandById(`${id}:cite-kind-of-source`);
		const ok = await until(() => document.querySelectorAll('.modal-container .suggestion-item').length > 10, 3000);
		const input = document.querySelector<HTMLInputElement>('.modal-container .prompt-input');
		if (input) { input.value = 'case reported'; input.dispatchEvent(new Event('input')); }
		await sleep(100);
		document.querySelector<HTMLElement>('.modal-container .suggestion-item.is-selected')?.click();
		await sleep(200);
		const text = workspace.getActiveViewOfType(MarkdownView)?.editor.getValue() ?? '';
		return ok && /\[\^\d+\]: .*\(/.test(text) ? true : `palette: ${ok}; footnote text: ${text.split('\n').filter((l) => l.startsWith('[^')).slice(-1)[0]}`;
	});
	await check('AGLC4: page preview lays out pages', async () => {
		// Back to the essay's main pane, close the footnote pane, and open the preview.
		const panes = workspace.getLeavesOfType('markdown');
		const main = panes.find((l) => (l.view as MarkdownView).file?.basename === 'AGLC4 example essay');
		for (const l of panes) if (l !== main) l.detach();
		if (main) workspace.setActiveLeaf(main, { focus: true });
		await sleep(200);
		commands.executeCommandById(`${id}:page-preview`);
		const ok = await until(() => document.querySelectorAll('.aglc-pv-page').length > 1, 15000);
		return ok || document.querySelector('.aglc-pv-info')?.textContent || 'no preview';
	});
	await check('AGLC4: settings page renders', async () => {
		app.setting.openTabById(id);
		const ok = await until(() => document.querySelectorAll('.modal.mod-settings .setting-item').length > 20, 2000);
		app.setting.close();
		return ok;
	});

	// Alignment (polish plan): bands line up across the three columns, in every density.
	const visible = (root: Element | null, sel: string) => [...(root?.querySelectorAll<HTMLElement>(sel) ?? [])].find((e) => e.offsetParent !== null) ?? null;
	const columns = () => [workspace.leftSplit.containerEl, workspace.rootSplit.containerEl, workspace.rightSplit.containerEl];
	for (const density of ['compact', 'comfortable', 'spacious'] as const) {
		await app.setConfig('density', density);
		await sleep(50);
		await check(`header bands line up across columns (${density})`, () => {
			const tabs = columns().map((c) => visible(c, '.workspace-tab-header-container')?.getBoundingClientRect().bottom);
			const heads = columns().map((c) => visible(c, '.view-header')?.getBoundingClientRect().bottom);
			const same = (xs: (number | undefined)[]) => xs.every((x) => x !== undefined && Math.abs(x - xs[0]!) < 0.5);
			return (same(tabs) && same(heads)) || `tab strips ${tabs.join('/')} · header lines ${heads.join('/')}`;
		});
	}
	await app.setConfig('density', 'comfortable');
	await check('file and folder names share a column', () => {
		const folder = document.querySelector('.nav-folder-title .tree-item-inner')?.getBoundingClientRect().left;
		const file = document.querySelector('.nav-file-title .tree-item-inner')?.getBoundingClientRect().left;
		return (folder !== undefined && folder === file) || `folder ${folder} file ${file}`;
	});
	await check('settings controls share one column', async () => {
		app.setting.openTabById('appearance');
		await sleep(50);
		const widths = [...document.querySelectorAll<HTMLElement>('.vertical-tab-content .setting-item:not(.setting-item-heading):not(.mod-buttons) .setting-item-control')].filter((e) => !e.querySelector(':scope > button, :scope > select + select')).map((e) => Math.round(e.getBoundingClientRect().width));
		app.setting.close();
		return (widths.length > 5 && widths.every((w) => w === widths[0])) || widths.join(',');
	});
	await check('settings search finds settings on every page', async () => {
		app.setting.open();
		app.setting.search('accent');
		const appearance = [...document.querySelectorAll('.settings-search-results .setting-item-name')].map((e) => e.textContent);
		app.setting.search('footnote pane');
		const plugin = document.querySelectorAll('.settings-search-results .setting-item:not(.setting-item-heading)').length;
		app.setting.search('zzzz-nothing');
		const none = !!document.querySelector('.settings-search-empty');
		app.setting.close();
		return (appearance.includes('Accent colour') && plugin > 0 && none) || `appearance=${appearance.join('|')} plugin=${plugin} none=${none}`;
	});
	await check('an empty tab is reused for "open in new tab"', async () => {
		const blank = workspace.getLeaf('tab');
		if (blank.view.getViewType() !== 'empty') return 'no blank tab';
		workspace.setActiveLeaf(blank, { focus: false });
		const again = workspace.getLeaf('tab');
		const ok = again === blank;
		await blank.openFile(vault.getFileByPath('Welcome.md')!);
		const badge = document.querySelector('.status-bar-badge')?.textContent;
		blank.detach();
		if (ok && badge !== 'edit') return `reused, but listeners missed the new view (badge ${badge})`;
		await sleep(50);
		return ok || 'a second tab was opened';
	});
	await check('modeline badge shows the mode', async () => {
		const leaf = workspace.getLeavesOfType('markdown')[0];
		if (!leaf) return 'no note open';
		workspace.setActiveLeaf(leaf, { focus: true });
		await sleep(50);
		const edit = document.querySelector('.status-bar-badge')?.textContent;
		await (leaf.view as MarkdownView).setMode('preview');
		const read = document.querySelector('.status-bar-badge')?.textContent;
		await (leaf.view as MarkdownView).setMode('source');
		return (edit === 'edit' && read === 'read') || `edit=${edit} read=${read} active=${workspace.activeLeaf?.view.getViewType()}`;
	});

	// Theming.
	const cssVar = (name: string) => getComputedStyle(document.body).getPropertyValue(name).trim();
	await check('homebase is the vault', () => app.homebase === app.vault);
	await check('icons drawn from Phosphor by default', () => {
		const svg = document.querySelector('.workspace-ribbon .svg-icon');
		return svg?.getAttribute('viewBox') === '0 0 256 256' || `${svg?.getAttribute('class')} ${svg?.getAttribute('viewBox')}`;
	});
	await check('icon set switch redraws icons on screen', async () => {
		await app.setConfig('iconSet', 'lucide');
		const lucide = document.querySelector('.workspace-ribbon .svg-icon')?.getAttribute('viewBox');
		await app.setConfig('iconWeight', 'bold');
		await app.setConfig('iconSet', 'phosphor');
		const back = document.querySelector('.workspace-ribbon .svg-icon')?.getAttribute('viewBox');
		await app.setConfig('iconWeight', 'regular');
		return (lucide === '0 0 24 24' && back === '0 0 256 256') || `${lucide} / ${back}`;
	});
	await check('palettes: 16 built in, switching applies', async () => {
		if (app.customCss.getPalettes().length !== 16) return `${app.customCss.getPalettes().length} palettes`;
		await app.setConfig('theme', 'dark');
		await app.setConfig('darkPalette', 'dracula');
		const bg = cssVar('--doom-bg');
		const primary = cssVar('--background-primary');
		await app.setConfig('darkPalette', 'crisp-dark');
		return (bg === '#282a36' && primary === '#282a36') || `${bg} ${primary}`;
	});
	await check('light mode uses the light palette', async () => {
		await app.setConfig('theme', 'light');
		await app.setConfig('lightPalette', 'solarized-light');
		const ok = document.body.hasClass('theme-light') && cssVar('--doom-bg') === '#fdf6e3';
		await app.setConfig('lightPalette', 'crisp-light');
		await app.setConfig('theme', 'dark');
		return ok || cssVar('--doom-bg');
	});
	await check('accent colour override', async () => {
		await app.setConfig('accentColor', '#ff8800');
		const ok = cssVar('--doom-blue') === '#ff8800' && cssVar('--interactive-accent') === '#ff8800';
		await app.setConfig('accentColor', '');
		return ok || `${cssVar('--doom-blue')} ${cssVar('--interactive-accent')}`;
	});
	await check('CSS snippet applies; one that loads from the web is refused', async () => {
		const css = app.customCss;
		await vault.adapter.write(`${css.snippetsFolder}/wide.css`, 'body { --smoke-snippet: 1; }');
		await vault.adapter.write(`${css.snippetsFolder}/remote.css`, 'body { background: url(https://example.com/x.png); }');
		await css.load();
		await css.setSnippetEnabled('wide', true);
		await css.setSnippetEnabled('remote', true);
		const applied = cssVar('--smoke-snippet') === '1';
		const refused = css.refusal('snippet', 'remote')?.join(', ') ?? 'not refused';
		const loaded = !!document.querySelector('style[data-snippet="remote"]');
		await css.setSnippetEnabled('wide', false);
		await css.setSnippetEnabled('remote', false);
		return (applied && !loaded && refused.includes('url(https')) || `applied=${applied} loaded=${loaded} refused=${refused}`;
	});
	await check('CSS theme from a starter template', async () => {
		const css = app.customCss;
		const name = await css.createThemeTemplate();
		await vault.adapter.write(`${css.themesFolder}/${name}/theme.css`, 'body.theme-dark { --doom-bg: #010203; }');
		await css.load();
		await css.setTheme(name);
		const ok = cssVar('--doom-bg') === '#010203';
		await css.setTheme('');
		return ok || cssVar('--doom-bg');
	});
	await check('density changes spacing', async () => {
		await app.setConfig('density', 'compact');
		const compact = cssVar('--row-h');
		await app.setConfig('density', 'comfortable');
		return compact === '22px' || compact;
	});

	// Offline: the page itself must not be able to reach the network.
	await check('network blocked in the page', async () => {
		try {
			await fetch('https://example.com/');
			return 'request succeeded';
		} catch {
			return true;
		}
	});
	await check('no new files outside the vault', () => vault.getFiles().every((f: TFile) => !f.path.startsWith('..')));

	await sleep(800);
	const ok = checks.every((c) => c.ok);
	app.host.app.smokeReport?.({ ok, checks, notices });
}

/**
 * Screenshot tour (npm run shots): the main surfaces in several palettes, densities and icon sets,
 * for design review. Files go to QUIRE_SMOKE_OUT.
 */
export async function runShots(app: App): Promise<void> {
	const shot = async (name: string) => { await sleep(350); await app.host.app.capture?.(name); };
	const { workspace, commands } = app;
	commands.executeCommandById('aglc-citations:create-example-essay');
	await until(() => workspace.getActiveFile()?.basename === 'AGLC4 example essay', 8000);
	commands.executeCommandById('aglc-citations:page-preview');
	await until(() => document.querySelectorAll('.aglc-pv-page').length > 1, 15000);
	await sleep(1200);
	document.querySelectorAll('.notice').forEach((n) => n.detach());
	await app.setConfig('theme', 'dark');
	await shot('01-main-crisp-dark');
	for (const p of ['doom-one', 'dracula', 'tokyo-night', 'gruvbox', 'retro-terminal', 'cyberpunk']) {
		await app.setConfig('darkPalette', p.replace(/^doom-/, ''));
		await shot(`02-palette-${p}`);
	}
	await app.setConfig('darkPalette', 'crisp-dark');
	await app.setConfig('theme', 'light');
	for (const p of ['crisp-light', 'solarized-light', 'nord-light', 'gruvbox-light']) {
		await app.setConfig('lightPalette', p);
		await shot(`03-palette-${p}`);
	}
	await app.setConfig('lightPalette', 'crisp-light');
	await app.setConfig('theme', 'dark');
	for (const d of ['compact', 'spacious'] as const) {
		await app.setConfig('density', d);
		await shot(`04-density-${d}`);
	}
	await app.setConfig('density', 'comfortable');
	await app.setConfig('iconSet', 'lucide');
	await shot('05-icons-lucide');
	await app.setConfig('iconSet', 'phosphor');
	await app.setConfig('iconWeight', 'light');
	await shot('05-icons-phosphor-light');
	await app.setConfig('iconWeight', 'regular');
	const view = workspace.getActiveViewOfType(MarkdownView);
	if (view) { await view.setMode('preview'); await shot('06-reading-view'); await view.setMode('source'); }
	commands.executeCommandById('app:command-palette');
	await shot('07-command-palette');
	topModal()?.close();
	commands.executeCommandById('app:quick-switcher');
	await shot('08-quick-switcher');
	topModal()?.close();
	const item = document.querySelector<HTMLElement>('.nav-file-title');
	item?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 160, clientY: 220 }));
	await shot('09-context-menu');
	document.querySelector('.menu')?.detach();
	app.setting.openTabById('appearance');
	await shot('10-settings-appearance');
	const scroller = document.querySelector('.vertical-tab-content-container');
	if (scroller) { scroller.scrollTop = scroller.scrollHeight; await shot('11-settings-appearance-end'); }
	app.setting.openTabById('aglc-citations');
	await shot('12-settings-plugin');
	app.setting.search('footnote');
	await shot('13-settings-search');
	app.setting.close();
	app.host.app.smokeReport?.({ ok: true, checks: [], notices: [] });
}
