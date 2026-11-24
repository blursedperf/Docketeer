/**
 * Smoke test, run by `npm run smoke` (Electron offscreen, on a throwaway vault). Exercises the core app
 * and the AGLC4 plugin end to end, and checks that network access is refused. Not part of the normal
 * app flow: it only runs when the main process was started with --smoke.
 */
import { EditorView } from '@codemirror/view';
import { Vim, getCM } from '@replit/codemirror-vim';
import { type App, MarkdownView, type TFile, saveAttachment, topModal } from '@quire/api';

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

	// Attachments and embeds (Phase 3).
	await check('pasting an image saves it and shows it in the editor', async () => {
		await workspace.getLeaf(false).openFile(vault.getFileByPath('Welcome.md')!);
		const view = workspace.getActiveViewOfType(MarkdownView)!;
		const canvas = document.createElement('canvas');
		canvas.width = 40; canvas.height = 20;
		const g = canvas.getContext('2d')!;
		g.fillStyle = '#60a5fa'; g.fillRect(0, 0, 40, 20);
		const blob = await new Promise<Blob>((r) => canvas.toBlob((b) => r(b!), 'image/png'));
		const dt = new DataTransfer();
		dt.items.add(new File([blob], 'image.png', { type: 'image/png' }));
		view.editor.setCursor({ line: view.editor.lastLine(), ch: view.editor.getLine(view.editor.lastLine()).length });
		view.editor.cm.contentDOM.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
		const saved = await until(() => vault.getFiles().some((f) => /^attachments\/Pasted image \d{14}\.png$/.test(f.path)), 3000);
		const inserted = /!\[\[Pasted image \d{14}\.png\]\]/.test(view.editor.getValue());
		const img = await until(() => { const i = document.querySelector<HTMLImageElement>('.cm-image-embed img'); return !!i && i.complete && i.naturalWidth === 40; }, 3000);
		return (saved && inserted && img) || `saved=${saved} inserted=${inserted} imageLoaded=${img}`;
	});
	await check('dropping a file attaches and links it', async () => {
		const view = workspace.getActiveViewOfType(MarkdownView)!;
		const dt = new DataTransfer();
		dt.items.add(new File([new Uint8Array([37, 80, 68, 70])], 'Lease terms.pdf', { type: 'application/pdf' }));
		const r = view.editor.cm.contentDOM.getBoundingClientRect();
		view.editor.cm.contentDOM.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true, clientX: r.left + 5, clientY: r.top + 5 }));
		const saved = await until(() => !!vault.getFileByPath('attachments/Lease terms.pdf'), 3000);
		const linked = view.editor.getValue().includes('[[Lease terms.pdf]]');
		return (saved && linked) || `saved=${saved} linked=${linked}`;
	});
	await check('reading view embeds notes, sections and pictures', async () => {
		const pic = vault.getFiles().find((f) => f.path.startsWith('attachments/Pasted image'))!;
		const file = await vault.create('Embeds.md', `# Embeds\n\n![[Welcome]]\n\n![[Renamed note#Second]]\n\n![[${pic.name}|120]]\n\n![[Embeds]]\n`);
		await workspace.getLeaf(false).openFile(file);
		const view = workspace.getActiveViewOfType(MarkdownView)!;
		await view.setMode('preview');
		const boxes = view.previewEl.querySelectorAll('.markdown-embed');
		const welcome = boxes[0]?.textContent?.includes('A note with a') ?? false;
		const section = boxes[1]?.textContent?.includes('Back to') ?? false;
		const self = boxes[2]?.textContent?.includes('cannot embed itself') ?? false;
		// The note's own picture (Welcome, embedded above, has the earlier one without a width).
		const img = [...view.previewEl.querySelectorAll<HTMLImageElement>('img.image-embed')].find((i) => !i.closest('.markdown-embed'));
		const sized = img?.style.width === '120px';
		await view.setMode('source');
		return (boxes.length === 3 && welcome && section && self && sized) || `boxes=${boxes.length} welcome=${welcome} section=${section} self=${self} sized=${sized} img=${img?.outerHTML.slice(0, 160)} links=${[...view.previewEl.querySelectorAll('a.internal-link')].map((x) => x.outerHTML).join(' ').slice(0, 300)}`;
	});

	// Spellcheck (Phase 3).
	await check('spellcheck marks misspellings offline, skips citations, code and links', async () => {
		const sp = app.spellchecker;
		const ready = await until(() => sp.ready, 10000);
		const file = await vault.create('Spell.md', 'This sentense has a mispelled word.\n\nColour and organise are fine here.\n\nSee the case.[^1]\n\n`codde` and [[Welcom]] and https://exmaple.com/xx\n\n[^1]: Mabo v Queensland (No 2) (1992) 175 CLR 1 teh.\n\n');
		await workspace.getLeaf(false).openFile(file);
		const view = workspace.getActiveViewOfType(MarkdownView)!;
		const cm = view.editor.cm;
		cm.dispatch({ selection: { anchor: cm.state.doc.length } });
		await sleep(100);
		const marked = () => [...document.querySelectorAll('.cm-misspelled')].map((e) => e.textContent);
		const au = marked().join(',');
		await app.setConfig('spellcheckLanguage', 'en-US');
		await until(() => sp.language === 'en-US', 10000);
		await sleep(100);
		const us = marked();
		await app.setConfig('spellcheckLanguage', 'en-AU');
		await until(() => sp.language === 'en-AU', 10000);
		await sleep(100);
		await app.setConfig('spellcheckFootnotes', true);
		await sleep(100);
		const withNotes = marked();
		await app.setConfig('spellcheckFootnotes', false);
		await sleep(100);
		const ok = ready && au === 'sentense,mispelled' && us.includes('Colour') && us.includes('organise') && withNotes.includes('teh');
		return ok || `ready=${ready} au=${au} us=${us.join(',')} footnotes=${withNotes.join(',')}`;
	});
	await check('right-click: suggestions replace the word; add to dictionary is saved', async () => {
		const cm = workspace.getActiveViewOfType(MarkdownView)!.editor.cm;
		const rightClick = (el: Element) => { const r = el.getBoundingClientRect(); el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 3, clientY: r.top + r.height / 2 })); };
		const first = [...document.querySelectorAll('.cm-misspelled')].find((e) => e.textContent === 'sentense');
		if (!first) return 'no mark';
		rightClick(first);
		const items = [...document.querySelectorAll<HTMLElement>('.menu .menu-item')];
		const fix = items.find((i) => i.textContent === 'sentence');
		fix?.click();
		await sleep(50);
		const fixed = cm.state.doc.line(1).text === 'This sentence has a mispelled word.';
		const second = [...document.querySelectorAll('.cm-misspelled')].find((e) => e.textContent === 'mispelled');
		if (!second) return `fixed=${fixed}; second mark missing`;
		rightClick(second);
		[...document.querySelectorAll<HTMLElement>('.menu .menu-item')].find((i) => i.textContent?.startsWith('Add "mispelled"'))?.click();
		await sleep(150);
		const gone = ![...document.querySelectorAll('.cm-misspelled')].some((e) => e.textContent === 'mispelled');
		const saved = (await vault.adapter.read('.quire/dictionary.txt')).includes('mispelled');
		const notices = await app.host.app.notices();
		const licences = notices.includes('SCOWL') && notices.includes('nspell');
		return (fixed && gone && saved && licences) || `menu=${items.map((i) => i.textContent).join('|')} fixed=${fixed} gone=${gone} saved=${saved} licences=${licences}`;
	});

	// Live preview (Phase 3).
	await check('live preview formats away from the cursor, raw on its line', async () => {
		const file = await vault.create('Live.md', '# Heading\n\nSome **bold** and *em* and `code` and ==hi==.\n\nA [link](Welcome.md) and [[Welcome|home]].\n\n- bullet\n- [ ] task\n\n> quote\n\n---\n\nEnd');
		await workspace.getLeaf(false).openFile(file);
		const view = workspace.getActiveViewOfType(MarkdownView)!;
		const cm = view.editor.cm;
		// Find each line's element from its end: its start may be inside hidden marks ("# ").
		const lineText = (n: number) => { const d = cm.domAtPos(cm.state.doc.line(n).to).node; return (d instanceof HTMLElement ? d : d.parentElement)?.closest('.cm-line')?.textContent ?? ''; };
		cm.dispatch({ selection: { anchor: cm.state.doc.length } });
		await sleep(50);
		const heading = lineText(1);
		const inline = lineText(3);
		const links = lineText(5);
		const bullets = document.querySelectorAll('.cm-lp-bullet').length;
		const box = document.querySelector<HTMLInputElement>('.cm-lp-task');
		const quote = document.querySelector('.cm-line.cm-lp-quote')?.textContent;
		const rule = !!document.querySelector('.cm-lp-hr');
		const formatted = heading === 'Heading' && inline === 'Some bold and em and code and hi.' && links === 'A link and home.' && bullets === 1 && !!box && quote === 'quote' && rule;
		box?.click();
		await sleep(30);
		const ticked = cm.state.doc.line(8).text === '- [x] task';
		cm.dispatch({ selection: { anchor: cm.state.doc.line(3).from + 2 } });
		await sleep(30);
		const raw = lineText(3) === 'Some **bold** and *em* and `code` and ==hi==.';
		cm.dispatch({ selection: { anchor: cm.state.doc.length } });
		await sleep(30);
		const link = [...document.querySelectorAll<HTMLElement>('.cm-lp-wikilink')].find((e) => e.textContent === 'home');
		link?.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true, cancelable: true }));
		const opened = await until(() => workspace.getActiveFile()?.path === 'Welcome.md', 2000);
		await workspace.getLeaf(false).openFile(file);
		await app.setConfig('livePreview', false);
		await sleep(50);
		const v2 = workspace.getActiveViewOfType(MarkdownView)!.editor.cm;
		const sourceLine = v2.domAtPos(v2.state.doc.line(3).from).node.parentElement?.closest('.cm-line')?.textContent;
		await app.setConfig('livePreview', true);
		const source = sourceLine === 'Some **bold** and *em* and `code` and ==hi==.';
		const ok = formatted && ticked && raw && opened && source;
		return ok || `formatted=${formatted} [h=${JSON.stringify(heading)} i=${JSON.stringify(inline)} l=${JSON.stringify(links)} bullets=${bullets} box=${!!box} q=${quote} hr=${rule}] ticked=${ticked} raw=${raw} opened=${opened} source=${source}`;
	});

	// Vim mode and hotkeys (Phase 3).
	await check('vim mode: modes in the modeline, :w saves, off again', async () => {
		await workspace.getLeaf(false).openFile(vault.getFileByPath('Welcome.md')!);
		const view = workspace.getActiveViewOfType(MarkdownView)!;
		await app.setConfig('vimMode', true);
		await sleep(50);
		const badge = () => document.querySelector('.status-bar-badge')?.textContent;
		const normal = badge();
		const cm = getCM(view.editor.cm)!;
		Vim.handleKey(cm, 'G', 'user');
		Vim.handleKey(cm, 'o', 'user');
		await sleep(30);
		const insert = badge();
		view.editor.replaceSelection('Typed in vim insert mode.');
		Vim.handleKey(cm, '<Esc>', 'user');
		await sleep(30);
		const back = badge();
		Vim.handleEx(cm as Parameters<typeof Vim.handleEx>[0], 'w');
		await sleep(200);
		const disk = await vault.adapter.read('Welcome.md');
		await app.setConfig('vimMode', false);
		await sleep(50);
		const off = badge();
		const ok = normal === 'normal' && insert === 'insert' && back === 'normal' && disk.includes('Typed in vim insert mode.') && off === 'edit';
		return ok || `normal=${normal} insert=${insert} back=${back} saved=${disk.includes('Typed in vim')} off=${off}`;
	});
	await check('hotkeys: record, run, conflicts, reset, saved', async () => {
		const cmds = app.commands;
		await cmds.setHotkeys('app:toggle-left-sidebar', [{ modifiers: ['Mod', 'Alt'], key: 'l' }]);
		const before = workspace.leftSplit.collapsed;
		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'l', ctrlKey: true, altKey: true, bubbles: true }));
		const toggled = workspace.leftSplit.collapsed !== before;
		if (toggled) workspace.leftSplit.toggle();
		const clash = cmds.conflicts({ modifiers: ['Mod'], key: 'p' }).map((c) => c.id).includes('app:command-palette');
		const saved = (await vault.adapter.read('.quire/hotkeys.json')).includes('app:toggle-left-sidebar');
		await cmds.setHotkeys('app:toggle-left-sidebar', null);
		const reset = !cmds.isCustomised('app:toggle-left-sidebar');
		app.setting.openTabById('hotkeys');
		await sleep(50);
		const rows = document.querySelectorAll('.hotkey-list .setting-item').length;
		app.setting.close();
		return (toggled && clash && saved && reset && rows > 30) || `ran=${toggled} clash=${clash} saved=${saved} reset=${reset} rows=${rows}`;
	});

	// Navigation panes (Phase 3).
	const paneText = (type: string) => (workspace.getLeavesOfType(type)[0]?.view.containerEl.textContent ?? '');
	await check('sidebar panes are added', () => {
		const missing = ['file-explorer', 'search', 'tag', 'backlink', 'outgoing-link', 'outline'].filter((t) => workspace.getLeavesOfType(t).length !== 1);
		return missing.length === 0 || `missing: ${missing.join(', ')}`;
	});
	await check('search finds text in notes', async () => {
		commands.executeCommandById('app:search');
		await sleep(100);
		const view = workspace.getLeavesOfType('search')[0]!.view as unknown as { setQuery(q: string): void };
		view.setQuery('footnote');
		const ok = await until(() => /Welcome/.test(paneText('search')) && /match/.test(paneText('search')), 3000);
		view.setQuery('tag:#test');
		const tag = await until(() => /Renamed note/.test(paneText('search')), 3000);
		view.setQuery('"no such phrase anywhere"');
		const none = await until(() => /No matches/.test(paneText('search')), 3000);
		return (ok && tag && none) || `words=${ok} tag=${tag} none=${none}: ${paneText('search').slice(0, 200)}`;
	});
	await check('backlinks, outgoing links and outline follow the note', async () => {
		await workspace.getLeaf(false).openFile(vault.getFileByPath('Renamed note.md')!);
		const back = await until(() => /Linkedmentions[1-9]/.test(paneText('backlink').replace(/\s+/g, '')) && /Welcome/.test(paneText('backlink')), 3000);
		const outline = await until(() => /Second/.test(paneText('outline')), 3000);
		await workspace.getLeaf(false).openFile(vault.getFileByPath('Welcome.md')!);
		const out = await until(() => /Renamed note/.test(paneText('outgoing-link')), 3000);
		return (back && outline && out) || `backlinks=${back} outline=${outline} outgoing=${out} | backlinks pane: ${JSON.stringify(paneText('backlink').slice(0, 300))}`;
	});
	await check('tags pane counts tags', () => /#test\s*1/.test(paneText('tag')) || paneText('tag'));
	await check('[[ completes links', async () => {
		const view = workspace.getActiveViewOfType(MarkdownView)!;
		const cm = view.editor.cm;
		cm.focus();
		const end = cm.state.doc.length;
		cm.dispatch({ changes: { from: end, insert: '\nSee [[Ren' }, selection: { anchor: end + 10 }, userEvent: 'input.type' });
		const open = await until(() => document.querySelectorAll('.suggestion-container .suggestion-item').length > 0, 2000);
		const first = document.querySelector('.suggestion-container .suggestion-item.is-selected')?.textContent ?? '';
		cm.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
		await sleep(50);
		const text = view.editor.getValue();
		const ok = open && text.endsWith('See [[Renamed note]]');
		view.editor.setValue(text.replace(/\nSee \[\[Renamed note\]\]$/, ''));
		await view.save();
		return ok || `open=${open} first=${first} tail=${JSON.stringify(text.slice(-40))}`;
	});

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
	// Navigation panes.
	commands.executeCommandById('app:search');
	await sleep(100);
	(workspace.getLeavesOfType('search')[0]?.view as unknown as { setQuery(q: string): void }).setQuery('native title');
	await sleep(600);
	await shot('14-search');
	workspace.leftSplit.tabs.selectTab(workspace.getLeavesOfType('file-explorer')[0]!);
	commands.executeCommandById('app:show-outline');
	await sleep(400);
	await shot('15-outline');
	await workspace.getLeaf(false).openFile(app.vault.getFileByPath('Second note.md')!);
	commands.executeCommandById('app:show-backlinks');
	await sleep(600);
	await shot('16-backlinks');
	commands.executeCommandById('app:show-tags');
	await sleep(400);
	await shot('17-tags');
	app.setting.openTabById('hotkeys');
	await shot('18-settings-hotkeys');
	app.setting.close();
	await app.setConfig('vimMode', true);
	await sleep(200);
	await shot('19-vim-normal');
	await app.setConfig('vimMode', false);
	// Attachments and embeds: a picture (drawn here, so the same every run) and embedded notes.
	const canvas = document.createElement('canvas');
	canvas.width = 480; canvas.height = 160;
	const g = canvas.getContext('2d')!;
	const grad = g.createLinearGradient(0, 0, 480, 0);
	grad.addColorStop(0, '#60a5fa'); grad.addColorStop(1, '#f472b6');
	g.fillStyle = grad; g.fillRect(0, 0, 480, 160);
	const blob = await new Promise<Blob>((r) => canvas.toBlob((b) => r(b!), 'image/png'));
	const pic = await saveAttachment(app, await blob.arrayBuffer(), 'Diagram.png', 'Embeds.md');
	const note = await app.vault.create('Embeds.md', `# Embeds\n\nA picture pasted or dropped in:\n\n![[${pic.name}|360]]\n\nA section of another note:\n\n![[AGLC4 example essay#Introduction]]\n\nA whole note:\n\n![[Welcome]]\n`);
	await workspace.getLeaf(false).openFile(note);
	await sleep(600);
	await shot('20-embeds-editor');
	const ev = workspace.getActiveViewOfType(MarkdownView);
	if (ev) { await ev.setMode('preview'); await sleep(600); await shot('21-embeds-reading'); await ev.setMode('source'); }
	// Spelling: a marked word and its menu.
	await until(() => app.spellchecker.ready, 10000);
	const sfile = await app.vault.create('Spelling.md', '# Spelling\n\nThe tribunal recieved the submisions on Tuesday.\n\nColour, organise and judgement are Australian spellings.\n\nCited in a footnote.[^1]\n\n[^1]: Mabo v Queensland (No 2) (1992) 175 CLR 1.\n\n');
	await workspace.getLeaf(false).openFile(sfile);
	const scm = workspace.getActiveViewOfType(MarkdownView)!.editor.cm;
	scm.dispatch({ selection: { anchor: scm.state.doc.length } });
	await sleep(300);
	const mark = [...document.querySelectorAll('.cm-misspelled')].find((e) => e.textContent === 'recieved');
	if (mark) { const r = mark.getBoundingClientRect(); mark.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 4, clientY: r.bottom })); }
	await shot('22-spelling');
	document.querySelector('.menu')?.detach();
	app.host.app.smokeReport?.({ ok: true, checks: [], notices: [] });
}
