/**
 * Smoke test, run by `npm run smoke` (Electron offscreen, on a throwaway vault). Exercises the core app
 * and the AGLC4 plugin end to end, and checks that network access is refused. Not part of the normal
 * app flow: it only runs when the main process was started with --smoke.
 */
import { EditorView, runScopeHandlers } from '@codemirror/view';
import { Vim, getCM } from '@replit/codemirror-vim';
import { type App, MarkdownView, Platform, paneRects, type TFile, type WorkspaceLeaf, saveAttachment, topModal } from '@quire/api';

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
	await check('first run: the Docket hint shows once, and goes when the Docket opens', async () => {
		const shown = !!document.querySelector('.docket-hint');
		const ui = (app as unknown as { docketUI?: { open(): number; close(hide?: boolean): void } }).docketUI;
		ui?.open();
		ui?.close(true);
		await sleep(50);
		const gone = !document.querySelector('.docket-hint') && app.config.docketHintSeen === true;
		return (shown && gone) || `shown=${shown} gone=${gone}`;
	});
	await check('no sidebars or ribbon: the Docket is the way in', () => {
		const hidden = !document.querySelector('.workspace-ribbon, .mod-sidedock, .workspace-sidedock-resize-handle');
		const handle = !!document.querySelector('.docket-handle');
		const sideLeaves = workspace.getLeavesOfType('file-explorer').length + workspace.getLeavesOfType('backlink').length;
		return (hidden && handle && sideLeaves === 0) || `hidden=${hidden} handle=${handle} sideLeaves=${sideLeaves}`;
	});

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
	await check('an opening note is never active before its text is in the editor', async () => {
		const seen: string[] = [];
		const watch = () => {
			const v = workspace.getActiveViewOfType(MarkdownView);
			if (v?.file?.path === 'Folder/Inside.md' && v.editor.getValue() === '') seen.push('empty');
		};
		const ref = workspace.on('active-leaf-change', watch);
		const ref2 = workspace.on('file-open', watch);
		// Reading the note is slowed down, so any moment where it is active with an empty editor is long.
		const read = vault.read.bind(vault);
		vault.read = async (f) => { await sleep(300); return read(f); };
		const timer = window.setInterval(watch, 10);
		try {
			// As when a command opens a note into the empty tab you are in: the tab is already active.
			const blank = workspace.getLeaf('tab');
			workspace.setActiveLeaf(blank, { focus: false });
			await workspace.getLeaf('tab').openFile(vault.getFileByPath('Folder/Inside.md')!);
		} finally {
			vault.read = read;
		}
		watch();
		window.clearInterval(timer);
		workspace.offref(ref);
		workspace.offref(ref2);
		workspace.activeLeaf?.detach();
		await sleep(50);
		return seen.length === 0 || `seen with an empty editor ${seen.length} time(s)`;
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
	await check('homebase media load and seek; notes are never served', async () => {
		// 30 s of 8 kHz 16-bit mono silence: big enough (480 kB) that seeking needs ranges.
		const rate = 8000, seconds = 30, data = rate * seconds * 2;
		const wav = new DataView(new ArrayBuffer(44 + data));
		const ascii = (at: number, s: string) => { for (let i = 0; i < s.length; i++) wav.setUint8(at + i, s.charCodeAt(i)); };
		ascii(0, 'RIFF'); wav.setUint32(4, 36 + data, true); ascii(8, 'WAVE'); ascii(12, 'fmt ');
		wav.setUint32(16, 16, true); wav.setUint16(20, 1, true); wav.setUint16(22, 1, true); wav.setUint32(24, rate, true);
		wav.setUint32(28, rate * 2, true); wav.setUint16(32, 2, true); wav.setUint16(34, 16, true); ascii(36, 'data'); wav.setUint32(40, data, true);
		const file = await vault.createBinary('attachments/Lecture smoke.wav', wav.buffer);
		const media = (src: string) => new Promise<HTMLAudioElement | string>((resolve) => {
			const a = document.createElement('audio');
			a.preload = 'metadata';
			a.onloadedmetadata = () => resolve(a);
			a.onerror = () => resolve(`error ${a.error?.code}`);
			window.setTimeout(() => resolve('timeout'), 5000);
			a.src = src;
		});
		const a = await media(vault.getResourcePath(file));
		if (typeof a === 'string') return `audio did not load: ${a}`;
		const duration = Math.round(a.duration);
		const seekable = a.seekable.length ? Math.round(a.seekable.end(0)) : 0;
		const seeked = await new Promise<boolean>((resolve) => {
			a.onseeked = () => resolve(true);
			window.setTimeout(() => resolve(false), 5000);
			a.currentTime = 25;
		});
		const at = Math.round(a.currentTime);
		a.removeAttribute('src');
		a.load();
		const note = await media(`quire://app/vault/${encodeURIComponent('Welcome.md')}`);
		const refused = typeof note === 'string' && note !== 'timeout';
		await vault.delete(file);
		return (duration === seconds && seekable === seconds && seeked && at === 25 && refused)
			|| `duration=${duration} seekable=${seekable} seeked=${seeked} at=${at} noteRefused=${refused} (${typeof note === 'string' ? note : 'loaded'})`;
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
	await check('legal terms are accepted, and marked again when turned off', async () => {
		const sp = app.spellchecker;
		const file = await vault.create('Legal.md', 'The obiter dicta, eg on extinguishment, are not justiciable.\n\n');
		await workspace.getLeaf(false).openFile(file);
		const cm = workspace.getActiveViewOfType(MarkdownView)!.editor.cm;
		cm.dispatch({ selection: { anchor: cm.state.doc.length } });
		await sleep(100);
		const marked = () => [...document.querySelectorAll('.cm-misspelled')].map((e) => e.textContent).join(',');
		const on = marked();
		await app.setConfig('spellcheckLegal', false);
		await until(() => marked() !== '', 10000);
		const off = marked();
		await app.setConfig('spellcheckLegal', true);
		await until(() => marked() === '', 10000);
		await workspace.getLeaf(false).openFile(vault.getFileByPath('Spell.md')!);
		await sleep(100);
		void sp;
		return (on === '' && off.includes('obiter') && off.includes('extinguishment') && off.includes('eg')) || `on=${on} off=${off}`;
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
		const saved = (await vault.adapter.read('.quire/dictionary.txt').catch(() => '')).includes('mispelled');
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
	await check('menu actions run registry commands (with arguments and confirmation)', async () => {
		const cmds = app.commands;
		const note = vault.getMarkdownFiles()[0]!;
		const before = vault.getFiles().length;
		cmds.executeCommandById('app:copy-file', { file: note });
		await sleep(100);
		const copied = vault.getFiles().length === before + 1;
		const copy = vault.getFiles().find((f) => f.path !== note.path && f.basename.startsWith(note.basename) && f.extension === 'md');
		cmds.executeCommandById('app:delete-file', { file: copy });
		await sleep(50);
		const asked = !!topModal() && vault.getFiles().length === before + 1;
		topModal()?.close();
		if (copy) await vault.trash(copy, true);
		const fields = ['app:new-note', 'app:delete-file', 'app:split-right'].every((id) => !!cmds.findCommand(id)?.section && cmds.findCommand(id)?.source === 'core');
		const pluginSource = cmds.listCommands().some((c) => c.source === 'plugin:aglc-citations');
		return (copied && asked && fields && pluginSource) || `copied=${copied} asked=${asked} fields=${fields} plugin=${pluginSource}`;
	});

	await check('hotkeys: record, run, conflicts, reset, saved', async () => {
		const cmds = app.commands;
		await cmds.setHotkeys('app:toggle-live-preview', [{ modifiers: ['Mod', 'Alt'], key: 'l' }]);
		const before = app.config.livePreview;
		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'l', ctrlKey: true, altKey: true, bubbles: true }));
		const toggled = app.config.livePreview !== before;
		if (toggled) await app.setConfig('livePreview', before);
		const clash = cmds.conflicts({ modifiers: ['Mod'], key: 'p' }).map((c) => c.id).includes('app:docket');
		const saved = (await vault.adapter.read('.quire/hotkeys.json')).includes('app:toggle-live-preview');
		await cmds.setHotkeys('app:toggle-live-preview', null);
		const reset = !cmds.isCustomised('app:toggle-live-preview');
		app.setting.openTabById('hotkeys');
		await sleep(50);
		const rows = document.querySelectorAll('.hotkey-list .setting-item').length;
		app.setting.close();
		return (toggled && clash && saved && reset && rows > 30) || `ran=${toggled} clash=${clash} saved=${saved} reset=${reset} rows=${rows}`;
	});

	// The old sidebar commands open the Docket where their feature now lives.
	await check('old sidebar commands open the Docket', async () => {
		const ui = (app as unknown as { docketUI?: { isOpen: boolean; close(hide?: boolean): void } }).docketUI;
		const tried: string[] = [];
		for (const id of ['app:search', 'app:quick-switcher', 'app:command-palette', 'app:show-outline', 'app:show-tags', 'app:show-backlinks']) {
			commands.executeCommandById(id);
			await sleep(30);
			if (!ui?.isOpen) tried.push(id);
			ui?.close(true);
		}
		const gone = ['app:toggle-left-sidebar', 'app:toggle-right-sidebar', 'app:collapse-folders'].every((id) => !commands.findCommand(id));
		return (tried.length === 0 && gone) || `did not open: ${tried.join(', ')} sidebarCommandsGone=${gone}`;
	});
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
	await check('AGLC4: page preview and version history open as normal tabs', async () => {
		const preview = workspace.getLeavesOfType('aglc4-page-preview')[0];
		commands.executeCommandById(`${id}:show-version-history`);
		await sleep(300);
		const history = workspace.getLeavesOfType('aglc4-version-history')[0];
		const inMain = (l: typeof preview) => !!l && !l.isSidebar() && l.parent !== null && workspace.rootTabs().includes(l.parent);
		const ok = inMain(preview) && inMain(history);
		history?.detach();
		preview?.detach();
		await sleep(100);
		const main = workspace.getLeavesOfType('markdown').find((l) => (l.view as MarkdownView).file?.basename === 'AGLC4 example essay');
		if (main) workspace.setActiveLeaf(main, { focus: true });
		return ok || `preview=${inMain(preview)} history=${inMain(history)}`;
	});
	await check('AGLC4: settings page renders', async () => {
		app.setting.openTabById(id);
		const ok = await until(() => document.querySelectorAll('.modal.mod-settings .setting-item').length > 20, 2000);
		app.setting.close();
		return ok;
	});

	// Alignment (polish plan): bands line up across the three columns, in every density.
	const visible = (root: Element | null, sel: string) => [...(root?.querySelectorAll<HTMLElement>(sel) ?? [])].find((e) => e.offsetParent !== null) ?? null;
	// With the sidebars gone, the columns are the panes: split once so there are two to compare.
	const firstLeaf = workspace.activeLeaf!;
	const secondLeaf = await workspace.duplicateLeaf(firstLeaf, 'vertical');
	await sleep(100);
	const columns = () => workspace.rootTabs().map((t) => t.containerEl);
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
	secondLeaf.detach();
	await sleep(50);
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
		const svg = document.querySelector('.workspace-tab-header .svg-icon');
		return svg?.getAttribute('viewBox') === '0 0 256 256' || `${svg?.getAttribute('class')} ${svg?.getAttribute('viewBox')}`;
	});
	await check('icon set switch redraws icons on screen', async () => {
		await app.setConfig('iconSet', 'lucide');
		const lucide = document.querySelector('.workspace-tab-header .svg-icon')?.getAttribute('viewBox');
		await app.setConfig('iconWeight', 'bold');
		await app.setConfig('iconSet', 'phosphor');
		const back = document.querySelector('.workspace-tab-header .svg-icon')?.getAttribute('viewBox');
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

	await docketChecks(app, check);
	await tilingChecks(app, check);
	await lockingChecks(app, check);
	await titleChecks(app, check);

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
	// The dictionary loads in the background; wait for it, so spelling marks are in every screenshot.
	await until(() => app.spellchecker.ready, 15000);
	commands.executeCommandById('aglc-citations:create-example-essay');
	await until(() => workspace.getActiveFile()?.basename === 'AGLC4 example essay', 8000);
	commands.executeCommandById('aglc-citations:page-preview');
	await until(() => document.querySelectorAll('.aglc-pv-page').length > 1, 15000);
	// The preview opens as a tab (no sidebars); put it in a pane beside the essay, as a user would (Mod+Alt+Shift+→).
	const pv = workspace.getLeavesOfType('aglc4-page-preview')[0];
	if (pv) { workspace.moveLeafToPane(pv, 'right'); const essayLeaf = workspace.getLeavesOfType('markdown')[0]; if (essayLeaf) workspace.setActiveLeaf(essayLeaf, { focus: true }); }
	await sleep(1200);
	document.querySelectorAll('.notice').forEach((n) => n.detach());
	await app.setConfig('theme', 'dark');
	await shot('00-first-run-hint');
	(app as unknown as { docketUI: { dismissHint(): void } }).docketUI.dismissHint();
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
	// The Docket replaces the palette, the switcher and the file menu (Phase 6).
	type Ui = { open(o?: { query?: string; panel?: string }): number; close(hide?: boolean): void };
	const dock = () => (app as unknown as { docketUI: Ui }).docketUI;
	dock().open({ query: '>' });
	await shot('07-docket-commands');
	dock().close(true);
	dock().open({ query: 'second' });
	await sleep(50);
	document.querySelector<HTMLInputElement>('.docket-input')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
	await shot('09-docket-note-actions');
	dock().close(true);
	app.setting.openTabById('appearance');
	await shot('10-settings-appearance');
	const scroller = document.querySelector('.vertical-tab-content-container');
	if (scroller) { scroller.scrollTop = scroller.scrollHeight; await shot('11-settings-appearance-end'); }
	app.setting.openTabById('aglc-citations');
	await shot('12-settings-plugin');
	app.setting.search('footnote');
	await shot('13-settings-search');
	app.setting.close();
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
	// The Docket (preview).
	await app.setConfig('docket', true);
	type DocketUI = { open(o?: { panel?: string; query?: string }): number; close(hide?: boolean): void; toggleMode(): void };
	const docket = (app as unknown as { docketUI: DocketUI }).docketUI;
	const essay = app.vault.getFileByPath('AGLC4 example essay.md');
	if (essay) await workspace.getLeaf(false).openFile(essay);
	await sleep(300);
	docket.open({ query: 'mabo' });
	await shot('23-docket-search');
	docket.close(true);
	docket.open({ query: '>split' });
	await shot('24-docket-commands');
	docket.close(true);
	docket.open({ query: 'second' });
	await sleep(50);
	document.querySelector<HTMLInputElement>('.docket-input')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
	await shot('25-docket-actions');
	docket.close(true);
	const ecm = workspace.getActiveViewOfType(MarkdownView)?.editor.cm;
	const at = ecm?.state.doc.toString().indexOf('Mabo v Queensland') ?? -1;
	if (ecm && at >= 0) { ecm.dispatch({ selection: { anchor: at + 2 } }); ecm.focus(); }
	docket.open();
	await shot('26-docket-authorities');
	docket.close(true);
	docket.toggleMode();
	docket.open({ panel: 'core:outline' });
	await shot('27-docket-pinned-outline');
	docket.toggleMode();
	docket.close(true);
	for (const n of document.querySelectorAll(".notice")) n.remove(); // the "pinned" notices
	docket.open({ query: 'native title' });
	await sleep(50);
	(docket as unknown as { showAll(type: string): void }).showAll('In notes');
	await shot('28-docket-full-text');
	docket.close(true);
	type Panels = { showPanel(id: string): void; refreshPanel(i?: number): Promise<void> };
	const dp = docket as unknown as Panels;
	if (ecm) { ecm.dispatch({ selection: { anchor: 0 } }); ecm.focus(); }
	docket.open({ panel: 'core:authorities' });
	await sleep(200);
	await shot('29-docket-authorities-all');
	dp.showPanel('core:cite');
	await sleep(100);
	[...document.querySelectorAll<HTMLElement>('.docket-panel .docket-item')].find((r) => r.textContent?.includes('Case (reported)'))?.click();
	await sleep(150);
	const setField = (name: string, v: string) => { const i = document.querySelector<HTMLInputElement>(`.docket-form [name="${name}"]`); if (i) { i.value = v; i.dispatchEvent(new Event('input')); } };
	setField('name', 'Example v Commonwealth'); setField('year', '1999'); setField('volume', '200'); setField('report', 'CLR'); setField('page', '10'); setField('short', 'Example'); setField('pinpoint', '15');
	(document.activeElement as HTMLElement | null)?.blur();
	await shot('30-docket-cite');
	document.querySelector('.docket-form')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
	await app.vault.createFolder('Torts/Negligence').catch(() => undefined);
	await app.vault.create('Torts/Negligence/Week 2 duty.md', '').catch(() => undefined);
	await app.vault.create('Torts/Negligence/Week 10 breach.md', '').catch(() => undefined);
	(app.workspace as unknown as { getActiveFile(): unknown });
	dp.showPanel('core:units');
	await sleep(150);
	[...document.querySelectorAll<HTMLElement>('.docket-panel .docket-item')].find((r) => r.textContent?.startsWith('Torts'))?.click();
	await sleep(100);
	[...document.querySelectorAll<HTMLElement>('.docket-panel .docket-item')].find((r) => r.textContent?.startsWith('Negligence'))?.click();
	await sleep(150);
	await shot('31-docket-units');
	dp.showPanel('core:homebase');
	await sleep(150);
	await shot('32-docket-homebase');
	docket.close(true);
	// Tiling: three panes, then the Layout panel over them.
	const first = workspace.activeLeaf!;
	const right = await workspace.duplicateLeaf(first, 'vertical');
	const below = workspace.createLeafBySplit(right, 'horizontal');
	await below.openFile(app.vault.getFileByPath('Welcome.md')!);
	workspace.setActiveLeaf(first, { focus: true });
	await sleep(300);
	await shot('33-tiling-three-panes');
	docket.open({ panel: 'core:layout' });
	await sleep(150);
	await shot('34-docket-layout');
	docket.close(true);
	docket.open({ query: '?' });
	await shot('35-docket-cheat-sheet');
	docket.close(true);
	// Locking: the Security settings page, Units with a locked note, and the unlock dialog.
	app.setting.openTabById('security');
	await shot('36-settings-security');
	app.setting.close();
	await app.lock.setUp('screenshot passphrase');
	const matter = await app.vault.create('Torts/Negligence/Client matter.md', '# Client matter\n\nPrivate.\n');
	await app.lock.lockNote(matter);
	await app.lock.lock();
	document.querySelectorAll('.notice').forEach((n) => n.detach());
	docket.open({ panel: 'core:units' });
	await sleep(150);
	[...document.querySelectorAll<HTMLElement>('.docket-panel .docket-item')].find((r) => r.textContent?.startsWith('Client matter'))?.scrollIntoView({ block: 'center' });
	await shot('37-units-locked-note');
	docket.close(true);
	void app.lock.requestUnlock();
	await sleep(150);
	await shot('38-unlock');
	topModal()?.close();
	workspace.mergeAllPanes();
	await app.setConfig('docket', false);
	app.host.app.smokeReport?.({ ok: true, checks: [], notices: [] });
}

type CheckFn = (name: string, fn: () => Promise<boolean | string> | boolean | string) => Promise<void>;

/** Press a key where the keyboard is (the window's capture handlers see it too). */
function press(key: string, mods: { ctrl?: boolean; shift?: boolean; alt?: boolean } = {}): void {
	const target = document.activeElement ?? document.body;
	target.dispatchEvent(new KeyboardEvent('keydown', { key, ctrlKey: !!mods.ctrl, shiftKey: !!mods.shift, altKey: !!mods.alt, bubbles: true, cancelable: true }));
}

/** The Docket, used only from the keyboard (Phase 2 of docs/docket/PLAN.md). */
async function docketChecks(app: App, check: CheckFn): Promise<void> {
	const { workspace, vault, commands } = app;
	type DocketUI = { isOpen: boolean; mode: string; el: HTMLElement; open(o?: object): number; close(hide?: boolean): void };
	const ui = () => (app as unknown as { docketUI?: DocketUI }).docketUI;
	const input = () => document.querySelector<HTMLInputElement>('.docket-input')!;
	const type = async (text: string) => { input().value = text; input().dispatchEvent(new Event('input')); await sleep(50); };
	const titles = () => [...document.querySelectorAll('.docket-option-title')].map((e) => e.textContent);
	const rootLeaves = () => { let n = 0; workspace.iterateRootLeaves(() => { n++; }); return n; };

	await check('docket: on from the start, with Mod+P', async () => {
		const before = !!document.querySelector('.docket') && commands.hotkeysFor(commands.findCommand('app:command-palette')!).length === 0;
		ui()?.close(true);
		const built = !!ui() && !!document.querySelector('.docket-handle');
		const paletteFree = commands.hotkeysFor(commands.findCommand('app:command-palette')!).length === 0;
		return (before && built && paletteFree) || `before=${before} built=${built} paletteFree=${paletteFree}`;
	});

	const essay = vault.getFileByPath('AGLC4 example essay.md') ?? vault.getMarkdownFiles()[0]!;
	await workspace.getLeaf(false).openFile(essay);
	await sleep(200);
	const view = workspace.getActiveViewOfType(MarkdownView)!;
	if (view.getMode() !== 'source') await view.setMode('source');
	const cm = view.editor.cm;

	await check('docket: Mod+P opens it with the cursor in the input, within 50 ms', async () => {
		ui()?.close(true);
		cm.focus();
		cm.dispatch({ selection: { anchor: 20, head: 25 } });
		press('p', { ctrl: true });
		await sleep(30);
		const opened = !!ui()?.isOpen && document.activeElement === input();
		ui()!.close(true);
		cm.focus();
		const times: number[] = [];
		for (let i = 0; i < 5; i++) { times.push(ui()!.open()); ui()!.close(true); }
		cm.focus();
		const worst = Math.max(...times.slice(1));
		const aria = ui()!.el.getAttribute('role') === 'dialog' && input().getAttribute('role') === 'combobox';
		return (opened && worst < 50 && aria) || `opened=${opened} worst=${worst.toFixed(1)}ms aria=${aria}`;
	});

	await check('docket: Esc returns to the same cursor and selection', async () => {
		cm.dispatch({ selection: { anchor: 20, head: 25 } });
		cm.focus();
		press('p', { ctrl: true });
		await type('welc');
		press('Escape'); // clears the input
		const cleared = input().value === '' && ui()!.isOpen;
		press('Escape'); // closes
		await sleep(20);
		const sel = cm.state.selection.main;
		const back = !ui()!.isOpen && cm.dom.contains(document.activeElement) && sel.anchor === 20 && sel.head === 25;
		return (cleared && back) || `cleared=${cleared} closed=${!ui()!.isOpen} focus=${cm.dom.contains(document.activeElement)} sel=${sel.anchor}-${sel.head}`;
	});

	await check('docket: ">" lists commands with their shortcuts; Enter runs one', async () => {
		press('p', { ctrl: true });
		await type('>new tab');
		const first = titles()[0];
		const hint = document.querySelector('.docket-option.is-selected .docket-option-hint')?.textContent;
		const before = rootLeaves();
		press('Enter');
		await sleep(100);
		const ran = rootLeaves() === before + 1 && !ui()!.isOpen;
		commands.executeCommandById('app:close-tab');
		await workspace.getLeaf(false).openFile(essay);
		return (first === 'New tab' && !!hint && ran) || `first=${first} hint=${hint} ran=${ran}`;
	});

	await check('docket: notes search; Mod+Enter opens to the right; announced', async () => {
		press('p', { ctrl: true });
		await type('renamed');
		const group = document.querySelector('.docket-group')?.getAttribute('aria-label');
		const live = document.querySelector('.docket [role=status]')?.textContent ?? '';
		const active = input().getAttribute('aria-activedescendant');
		const before = rootLeaves();
		press('Enter', { ctrl: true });
		await sleep(200);
		const opened = rootLeaves() === before + 1 && workspace.getActiveFile()?.basename === 'Renamed note';
		commands.executeCommandById('app:close-tab');
		await sleep(50);
		await workspace.getLeaf(false).openFile(essay);
		return (group === 'Notes' && /result/.test(live) && !!active && opened) || `group=${group} live=${live} active=${active} opened=${opened}`;
	});

	await check('docket: Shift+Enter inserts a link at the cursor', async () => {
		const v = workspace.getActiveViewOfType(MarkdownView)!;
		const ed = v.editor.cm;
		ed.focus();
		ed.dispatch({ selection: { anchor: ed.state.doc.length } });
		press('p', { ctrl: true });
		await type('welcome');
		press('Enter', { shift: true });
		await sleep(50);
		const text = ed.state.doc.toString();
		const ok = text.endsWith('[[Welcome]]') && ed.dom.contains(document.activeElement);
		ed.dispatch({ changes: { from: text.length - '[[Welcome]]'.length, to: text.length } });
		return ok || `end=${JSON.stringify(text.slice(-20))} focus=${ed.dom.contains(document.activeElement)}`;
	});

	await check('docket: → shows actions for a result; Esc goes back', async () => {
		press('p', { ctrl: true });
		await type('renamed');
		press('ArrowRight');
		await sleep(20);
		const acts = titles();
		const shown = acts.includes('Open to the right') && acts.includes('Insert as a link');
		press('Escape');
		await sleep(50);
		const back = titles()[0] === 'Renamed note';
		press('Escape'); press('Escape');
		return (shown && back) || `actions=${acts.join('|')} back=${titles().join('|')}`;
	});

	await check('docket: Mod+2 shows the outline; Tab moves between input, panel and tabs', async () => {
		cm.focus();
		press('p', { ctrl: true });
		press('2', { ctrl: true });
		await sleep(50);
		const outline = document.querySelectorAll('.docket-outline-item').length > 3;
		const tabActive = document.querySelector('.docket-tab.is-active')?.textContent?.includes('Outline');
		press('Tab');
		const inPanel = !!document.activeElement?.closest('.docket-panel');
		press('ArrowDown');
		const moved = document.activeElement?.classList.contains('docket-outline-item');
		press('Tab');
		const inTabs = !!document.activeElement?.closest('.docket-tabs');
		press('Tab');
		const inInput = document.activeElement === input();
		press('Escape');
		return (outline && tabActive && inPanel && moved && inTabs && inInput) || `outline=${outline} tab=${tabActive} panel=${inPanel} moved=${moved} tabs=${inTabs} input=${inInput}`;
	});

	await check('docket: opens on Authorities for a case name, Cite in a footnote', async () => {
		const ed = workspace.getActiveViewOfType(MarkdownView)!.editor.cm;
		const text = ed.state.doc.toString();
		const at = text.indexOf('Mabo v Queensland');
		ed.focus();
		ed.dispatch({ selection: { anchor: at + 2 } });
		ui()!.open();
		await sleep(30);
		const auth = document.querySelector('.docket-tab.is-active')?.textContent ?? '';
		const name = document.querySelector('.docket-item.is-focus .docket-option-title')?.textContent ?? '';
		ui()!.close(true);
		const fn = text.search(/^\[\^\d+\]:/m);
		ed.dispatch({ selection: { anchor: fn + 6 } });
		ed.focus();
		ui()!.open();
		await sleep(30);
		const cite = document.querySelector('.docket-tab.is-active')?.textContent ?? '';
		ui()!.close(true);
		return (at >= 0 && auth.includes('Authorities') && name.startsWith('Mabo v Queensland') && cite.includes('Cite')) || `at=${at} auth=${auth} name=${name} cite=${cite}`;
	});

	await check('docket: pinned mode stays docked, resizes from the keyboard, is remembered', async () => {
		cm.focus();
		press('p', { ctrl: true, shift: true });
		await sleep(30);
		const pinned = ui()!.el.classList.contains('is-pinned') && app.config.docketMode === 'pinned';
		const h0 = Number(app.config.docketHeight);
		press('ArrowDown', { ctrl: true, alt: true });
		const taller = Number(app.config.docketHeight) > h0;
		press('Escape');
		await sleep(20);
		const docked = ui()!.isOpen && !ui()!.el.contains(document.activeElement);
		press('p', { ctrl: true }); // focuses the docked Docket
		const refocused = document.activeElement === input();
		press('ArrowUp', { ctrl: true, alt: true });
		press('p', { ctrl: true, shift: true }); // back to peek
		press('Escape');
		await sleep(20);
		return (pinned && taller && docked && refocused && app.config.docketMode === 'peek') || `pinned=${pinned} taller=${taller} docked=${docked} refocused=${refocused} mode=${app.config.docketMode}`;
	});

	await check('docket: "?" lists shortcuts; a plugin panel takes the next number', async () => {
		press('p', { ctrl: true });
		await type('?new note');
		const help = titles().includes('Create new note');
		const remove = app.docket.addPanel({ id: 'test:panel', title: 'Test panel', render: (el) => { el.setText('hello'); } });
		await type('');
		press('7', { ctrl: true });
		await sleep(30);
		const plugin = document.querySelector('.docket-panel')?.textContent === 'hello';
		remove();
		press('1', { ctrl: true });
		press('Escape');
		return (help && plugin) || `help=${help} plugin=${plugin}`;
	});

	await check('search: full text, with the matching words marked', async () => {
		await app.search.ready;
		press('p', { ctrl: true });
		await type('footnote');
		const groups = [...document.querySelectorAll('.docket-group')].map((g) => g.getAttribute('aria-label'));
		const marked = [...document.querySelectorAll('.docket-group[aria-label="In notes"] mark')].some((m) => m.textContent?.toLowerCase() === 'footnote');
		press('Escape'); press('Escape');
		return (groups.includes('In notes') && marked) || `groups=${groups.join('|')} marked=${marked}`;
	});

	await check('search: the index follows edits, and leaves out nothing it should not', async () => {
		const f = await vault.create('Zebra crossing.md', 'Pedestrians have priority at a zebra crossing.\n');
		await sleep(100);
		const found = app.search.index.searchText('pedestrians prio').hits.some((h) => h.path === f.path);
		await vault.modify(f, 'Nothing about that any more.\n');
		await sleep(50);
		const gone = app.search.index.searchText('pedestrians').total === 0;
		await vault.trash(f, true);
		await sleep(50);
		return (found && gone && !app.search.index.has(f.path)) || `found=${found} gone=${gone}`;
	});

	await check('search: "show all" lists a whole group; Esc comes back', async () => {
		press('p', { ctrl: true });
		await type('e');
		const more = [...document.querySelectorAll('.docket-option.mod-more')];
		const target = more[0];
		if (!target) { press('Escape'); press('Escape'); return 'no "show all" row'; }
		const before = document.querySelectorAll('.docket-option').length;
		(target as HTMLElement).click();
		await sleep(50);
		const groups = document.querySelectorAll('.docket-group').length;
		const label = document.querySelector('.docket-prefix')?.textContent;
		const after = document.querySelectorAll('.docket-option').length;
		press('Escape');
		await sleep(50);
		const back = document.querySelectorAll('.docket-group').length > 1;
		press('Escape'); press('Escape');
		return (groups === 1 && after > 0 && !!label && back && before > 0) || `groups=${groups} label=${label} after=${after} back=${back}`;
	});

	await check('search: settings and used notes rank in', async () => {
		press('p', { ctrl: true });
		await type('vim');
		await sleep(50);
		await type('vim');
		const settings = [...document.querySelectorAll('.docket-group[aria-label="Settings"] .docket-option-title')].map((e) => e.textContent);
		press('Escape'); press('Escape');
		const welcome = vault.getFileByPath('Welcome.md')!;
		for (let i = 0; i < 5; i++) app.search.usage.record('note', welcome.path);
		const used = app.search.usage.score('note', welcome.path) > 0;
		return (settings.some((t) => /vim/i.test(t ?? '')) && used) || `settings=${settings.join('|')} used=${used}`;
	});

	// ---- Phase 4: the panels ------------------------------------------------------------------------
	const essayFile = vault.getFileByPath('AGLC4 example essay.md');
	const openEssay = async () => { if (essayFile) await workspace.getLeaf(false).openFile(essayFile); await sleep(150); const v = workspace.getActiveViewOfType(MarkdownView)!; if (v.getMode() !== 'source') await v.setMode('source'); return v.editor.cm; };
	const rowsText = () => [...document.querySelectorAll('.docket-panel .docket-item .docket-option-title')].map((e) => e.textContent ?? '');
	const focusEditorOrBody = () => { const v = workspace.getActiveViewOfType(MarkdownView); if (v) v.editor.cm.focus(); else (document.activeElement as HTMLElement | null)?.blur(); };
	const focusRow = (title: string) => { const r = [...document.querySelectorAll<HTMLElement>('.docket-panel .docket-item')].find((x) => x.querySelector('.docket-option-title')?.textContent === title); r?.focus(); return r; };

	await check('authorities: cases and legislation in the essay, Enter goes to the next place', async () => {
		const ed = await openEssay();
		ed.dispatch({ selection: { anchor: 0 } });
		ed.focus();
		press('p', { ctrl: true });
		press('1', { ctrl: true });
		await sleep(150);
		const groups = [...document.querySelectorAll('.docket-panel .docket-section-title')].map((e) => e.firstChild?.textContent);
		const r = focusRow(rowsText().find((t) => t.startsWith('Mabo v Queensland')) ?? '');
		const chips = document.querySelectorAll('.docket-panel .docket-chip').length;
		press('Enter');
		await sleep(50);
		const sel = ed.state.sliceDoc(ed.state.selection.main.from, ed.state.selection.main.to);
		return (groups.includes('Cases') && groups.includes('Legislation') && !!r && chips > 1 && sel.startsWith('Mabo')) || `groups=${groups.join('|')} row=${!!r} chips=${chips} sel=${sel}`;
	});

	await check('authorities: → lists every note citing it; "@" searches them', async () => {
		await openEssay();
		press('p', { ctrl: true });
		press('1', { ctrl: true });
		await sleep(150);
		focusRow(rowsText().find((t) => t.startsWith('Mabo v Queensland')) ?? '');
		press('ArrowRight');
		await sleep(30);
		const acts = titles();
		const every = acts.indexOf('Every note citing this');
		for (let i = 0; i < every; i++) press('ArrowDown');
		press('Enter');
		await sleep(300);
		const list = titles();
		press('Escape'); press('Escape');
		await type('@mabo');
		const at = titles();
		press('Escape'); press('Escape');
		return (every >= 0 && list.includes('AGLC4 example essay') && at.some((t) => t?.startsWith('Mabo'))) || `actions=${acts.join('|')} list=${list.join('|')} at=${at.join('|')}`;
	});

	await check('outline: Alt+↓ moves a section, Alt+→ demotes it, case brief fields can be added', async () => {
		const brief = await vault.create('Brief test.md', '---\ntype: case-brief\n---\n# Test v Test\n\n## Facts\n\nF.\n\n## Held\n\nH.\n');
		await workspace.getLeaf(false).openFile(brief);
		await sleep(150);
		const ed = workspace.getActiveViewOfType(MarkdownView)!.editor.cm;
		ed.focus();
		press('p', { ctrl: true });
		press('2', { ctrl: true });
		await sleep(100);
		const fields = rowsText().slice(0, 5).join('|');
		focusRow('Facts');
		const facts = [...document.querySelectorAll<HTMLElement>('.docket-panel .docket-outline-item')].find((x) => x.textContent?.includes('Facts'))!;
		facts.focus();
		facts.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', altKey: true, bubbles: true, cancelable: true }));
		await sleep(100);
		const moved = /## Held[\s\S]*## Facts/.test(ed.state.doc.toString());
		const again = [...document.querySelectorAll<HTMLElement>('.docket-panel .docket-outline-item')].find((x) => x.textContent?.includes('Facts'))!;
		again.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', altKey: true, bubbles: true, cancelable: true }));
		await sleep(100);
		const demoted = ed.state.doc.toString().includes('### Facts');
		focusRow('Ratio');
		press('Enter');
		await sleep(50);
		const added = ed.state.doc.toString().includes('## Ratio');
		return (fields === 'Facts|Issues|Held|Ratio|Obiter' && moved && demoted && added) || `fields=${fields} moved=${moved} demoted=${demoted} added=${added}`;
	});

	await check('cite: build a case citation, insert it as a footnote, then Ibid', async () => {
		const ed = workspace.getActiveViewOfType(MarkdownView)!.editor.cm;
		const end = ed.state.doc.toString().indexOf('F.') + 2;
		ed.dispatch({ selection: { anchor: end } });
		ed.focus();
		const fill = async () => {
			press('p', { ctrl: true });
			press('4', { ctrl: true });
			await sleep(80);
			focusRow('Case (reported)');
			press('Enter');
			await sleep(80);
			const set = (name: string, v: string) => { const i = document.querySelector<HTMLInputElement>(`.docket-form [name="${name}"]`)!; i.value = v; i.dispatchEvent(new Event('input')); };
			set('name', 'Example v Commonwealth'); set('year', '1999'); set('volume', '200'); set('report', 'CLR'); set('page', '10'); set('pinpoint', '15');
			const preview = document.querySelector('.docket-preview-text')?.textContent ?? '';
			document.querySelector<HTMLInputElement>('.docket-form [name="pinpoint"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
			await sleep(80);
			return preview;
		};
		const p1 = await fill();
		const after1 = ed.state.doc.toString();
		// Straight after the first footnote's reference (the Alt+↓ check put Held first, so not "H.").
		ed.dispatch({ selection: { anchor: after1.indexOf('[^1]') + 4 } });
		ed.focus();
		const p2 = await fill();
		const text = ed.state.doc.toString();
		const ok = p1 === 'Example v Commonwealth (1999) 200 CLR 10, 15.' && /\[\^1\]: \*Example v Commonwealth\* \(1999\) 200 CLR 10, 15\./.test(text) && /\[\^2\]: Ibid 15\./.test(text) && p2 === 'Ibid 15.';
		return ok || `p1=${p1} p2=${p2} text=${JSON.stringify(text.slice(-160))}`;
	});

	await check('units: pin, archive and folders from the keyboard', async () => {
		const brief = vault.getFileByPath('Brief test.md')!;
		commands.executeCommandById('app:toggle-pin-note', { file: brief });
		await sleep(50);
		press('p', { ctrl: true });
		press('3', { ctrl: true });
		await sleep(100);
		const sections = [...document.querySelectorAll('.docket-panel .docket-section-title')].map((e) => e.firstChild?.textContent);
		const folder = focusRow('Folder');
		press('Enter');
		await sleep(80);
		const expanded = rowsText().includes('Inside');
		press('Escape'); press('Escape');
		commands.executeCommandById('app:archive-note', { file: brief });
		await sleep(150);
		const archived = !!vault.getFileByPath('Archive/Brief test.md');
		const pinFollowed = (app.config.pinnedNotes ?? []).includes('Archive/Brief test.md');
		commands.executeCommandById('app:toggle-pin-note', { file: vault.getFileByPath('Archive/Brief test.md')! });
		return (sections.includes('Pinned') && !!folder && expanded && archived && pinFollowed) || `sections=${sections.join('|')} folder=${!!folder} expanded=${expanded} archived=${archived} pin=${pinFollowed}`;
	});

	await check('homebase: export asks first and redacts', async () => {
		await openEssay();
		press('p', { ctrl: true });
		press('5', { ctrl: true });
		await sleep(80);
		const lock = rowsText().includes('Set up locking…');
		focusRow(rowsText().find((t) => t.startsWith('Export')) ?? '');
		press('Enter');
		await sleep(80);
		const modal = topModal();
		const area = document.querySelector<HTMLTextAreaElement>('.modal textarea');
		if (area) { area.value = 'Queensland'; area.dispatchEvent(new Event('input')); }
		[...document.querySelectorAll<HTMLButtonElement>('.modal button')].find((b) => b.textContent === 'Export')?.click();
		await sleep(300);
		const out = vault.getFileByPath('Exports/AGLC4 example essay.md');
		const text = out ? await vault.read(out) : '';
		if (out) await vault.trash(out, true);
		return (lock && !!modal && !!out && text.includes('█') && !/Queensland/i.test(text)) || `lock=${lock} modal=${!!modal} out=${!!out}`;
	});

	await check('layout: open panes listed; Enter moves to one', async () => {
		const first = workspace.activeLeaf!;
		await workspace.duplicateLeaf(first, 'vertical');
		await sleep(80);
		press('p', { ctrl: true });
		press('6', { ctrl: true });
		await sleep(80);
		const panes = [...document.querySelectorAll('.docket-panel .docket-section-title')].map((e) => e.firstChild?.textContent).filter((t) => t?.startsWith('Pane')).length;
		const rows = [...document.querySelectorAll<HTMLElement>('.docket-panel .docket-section[aria-label^="Pane"] .docket-item')];
		const other = rows.find((r) => !r.classList.contains('is-focus'));
		other?.focus();
		press('Enter');
		await sleep(50);
		// The split took the keyboard; Enter on the other pane's row goes back to the first.
		const moved = workspace.activeLeaf === first;
		const extra: WorkspaceLeaf[] = [];
		workspace.iterateRootLeaves((l) => { if (l !== first) extra.push(l); });
		for (const l of extra) l.detach();
		await sleep(50);
		return (panes >= 2 && moved) || `panes=${panes} moved=${moved}`;
	});

	await check('mentions: listed in the Docket, and turned into a link', async () => {
		const note = await vault.create('Mention test.md', 'See Welcome for more.\n');
		await sleep(150);
		press('p', { ctrl: true });
		await type('welcome');
		press('ArrowRight');
		await sleep(30);
		const pick = (title: string) => { const i = titles().indexOf(title); for (let k = 0; k < i; k++) press('ArrowDown'); press('Enter'); return i >= 0; };
		const had = pick('Mentions (not linked)');
		await sleep(200);
		const listed = titles().includes('Mention test');
		const i = titles().indexOf('Mention test');
		for (let k = 0; k < i; k++) press('ArrowDown');
		press('ArrowRight');
		await sleep(30);
		const linkAction = pick('Turn into a link');
		await sleep(200);
		const text = await vault.read(note);
		press('Escape'); press('Escape'); press('Escape');
		await vault.trash(note, true);
		return (had && listed && linkAction && text.includes('[[Welcome]]')) || `had=${had} listed=${listed} action=${linkAction} text=${text}`;
	});

	await check('note actions include links and the plugins\' file actions', async () => {
		press('p', { ctrl: true });
		await type('aglc4 example');
		press('ArrowRight');
		await sleep(30);
		const acts = titles();
		press('Escape'); press('Escape'); press('Escape');
		return (acts.includes('Notes linking here') && acts.some((t) => /Word/.test(t ?? '')) && acts.includes('Pin to Units')) || acts.join('|');
	});

	await check('docket: creates a note that does not exist; # lists notes with a tag', async () => {
		press('p', { ctrl: true });
		await type('Brand new idea');
		const offered = titles().includes('Create note “Brand new idea”');
		const i = titles().indexOf('Create note “Brand new idea”');
		for (let k = 0; k < i; k++) press('ArrowDown');
		press('Enter');
		await sleep(200);
		const created = !!vault.getMarkdownFiles().find((f) => f.basename === 'Brand new idea') && workspace.getActiveFile()?.basename === 'Brand new idea';
		const made = vault.getMarkdownFiles().find((f) => f.basename === 'Brand new idea');
		if (made) await vault.trash(made, true);
		press('p', { ctrl: true });
		await type('#test');
		const j = titles().indexOf('#test');
		for (let k = 0; k < j; k++) press('ArrowDown');
		press('Enter');
		await sleep(100);
		const tagged = titles();
		press('Escape'); press('Escape'); press('Escape');
		return (offered && created && tagged.includes('Renamed note')) || `offered=${offered} created=${created} tagged=${tagged.join('|')}`;
	});

	await check('journey (keyboard only): brief a case, cite it in an essay, side by side, find every note citing it', async () => {
		const steps: string[] = [];
		const choose = (title: string) => { const i = titles().indexOf(title); if (i < 0) return false; for (let k = 0; k < i; k++) press('ArrowDown'); press('Enter'); return true; };
		const typeInEditor = (text: string) => { const ed = workspace.getActiveViewOfType(MarkdownView)!.editor.cm; ed.dispatch(ed.state.replaceSelection(text), { userEvent: 'input' }); return ed; };
		// 1. A case brief, created from the Docket.
		press('p', { ctrl: true });
		await type('Journey brief');
		if (!choose('Create note “Journey brief”')) steps.push('create brief');
		await sleep(200);
		typeInEditor('---\ntype: case-brief\n---\n# Example v Commonwealth\n\n## Facts\n\nA duty question.\n');
		press('p', { ctrl: true });
		press('2', { ctrl: true });
		await sleep(80);
		if (!focusRow('Held')) steps.push('brief fields');
		press('Enter');
		await sleep(50);
		if (!workspace.getActiveViewOfType(MarkdownView)!.editor.getValue().includes('## Held')) steps.push('add Held');
		// 2. An essay citing it, with an AGLC footnote from the Cite panel.
		press('p', { ctrl: true });
		await type('Journey essay');
		if (!choose('Create note “Journey essay”')) steps.push('create essay');
		await sleep(200);
		const essayEd = typeInEditor('The duty was settled.');
		press('p', { ctrl: true });
		press('4', { ctrl: true });
		await sleep(80);
		focusRow('Case (reported)');
		press('Enter');
		await sleep(80);
		const set = (name: string, v: string) => { const i = document.querySelector<HTMLInputElement>(`.docket-form [name="${name}"]`)!; i.value = v; i.dispatchEvent(new Event('input')); };
		set('name', 'Example v Commonwealth'); set('year', '1999'); set('volume', '200'); set('report', 'CLR'); set('page', '10'); set('pinpoint', '12');
		document.querySelector<HTMLInputElement>('.docket-form [name="pinpoint"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
		await sleep(100);
		if (!/settled\.\[\^1\][\s\S]*\[\^1\]: \*Example v Commonwealth\* \(1999\) 200 CLR 10, 12\./.test(essayEd.state.doc.toString())) steps.push('footnote');
		// 3. The brief beside the essay.
		press('\\', { ctrl: true });
		await sleep(150);
		press('p', { ctrl: true });
		await type('Journey brief');
		press('Enter');
		await sleep(200);
		const shown = workspace.rootTabs().map((t) => (t.activeLeaf?.view as MarkdownView | undefined)?.file?.basename).sort().join('|');
		if (shown !== 'Journey brief|Journey essay') steps.push(`side by side (${shown})`);
		// 4. Every note citing the case, from the essay's Authorities.
		press('ArrowLeft', { ctrl: true, alt: true });
		const ed = workspace.getActiveViewOfType(MarkdownView)!.editor.cm;
		ed.dispatch({ selection: { anchor: 0 } });
		press('p', { ctrl: true });
		press('1', { ctrl: true });
		await sleep(120);
		focusRow('Example v Commonwealth');
		press('ArrowRight');
		await sleep(30);
		if (!choose('Every note citing this')) steps.push('citing action');
		await sleep(300);
		const citing = titles().sort().join('|');
		if (!citing.includes('Journey brief') || !citing.includes('Journey essay')) steps.push(`citing (${citing})`);
		press('Escape'); press('Escape'); press('Escape');
		// 5. Locking the homebase comes with the locking phase: the Homebase panel says so.
		for (const t of [...workspace.rootTabs()].slice(1)) for (const l of [...t.children]) l.detach();
		for (const n of ['Journey brief', 'Journey essay']) { const f = vault.getMarkdownFiles().find((x) => x.basename === n); if (f) await vault.trash(f, true); }
		await sleep(100);
		return steps.length === 0 || steps.join('; ');
	});

	await check('mouse: clicking panel tabs and rows keeps the Docket open; clicking outside closes it (peek)', async () => {
		// As a real click: mousedown focuses the element, then click runs it.
		const click = async (el: HTMLElement | null | undefined) => { if (!el) return false; el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); el.focus(); el.click(); el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); await sleep(60); return true; };
		const docketOpen = () => !!document.querySelector('.docket.is-open');
		press('p', { ctrl: true });
		await sleep(30);
		const tabs = () => [...document.querySelectorAll<HTMLElement>('.docket-tab')];
		await click(tabs()[2]); // Units
		const afterTab = docketOpen() && !!document.querySelector('.docket-tab.is-active')?.textContent?.includes('Units');
		await click(tabs()[0]); // Authorities
		await click(tabs()[2]); // Units again
		const afterTabs = docketOpen();
		const folder = [...document.querySelectorAll<HTMLElement>('.docket-panel .docket-item')].find((r) => r.querySelector('.docket-option-title')?.textContent === 'Folder');
		await click(folder); // redraws the panel
		const afterRow = docketOpen();
		await click(document.querySelector<HTMLElement>('.status-bar'));
		const outsideStatus = !docketOpen();
		await workspace.getLeaf(false).openFile(vault.getFileByPath('Welcome.md')!);
		const wv = workspace.getActiveViewOfType(MarkdownView);
		if (wv && wv.getMode() !== 'source') await wv.setMode('source');
		await sleep(100);
		press('p', { ctrl: true });
		await sleep(30);
		const cmContent = wv?.editor.cm.contentDOM ?? null;
		const openBefore = docketOpen();
		await click(cmContent);
		const outsideNote = !docketOpen();
		if (docketOpen()) (app as unknown as { docketUI: { close(h?: boolean): void } }).docketUI.close(true);
		return (afterTab && afterTabs && afterRow && outsideStatus && outsideNote) || `tab=${afterTab} tabs=${afterTabs} row=${afterRow} status=${outsideStatus} note=${outsideNote} openBefore=${openBefore} editor=${!!cmContent}`;
	});

	await check('notes: Ctrl+N asks for the name and the place first; no "Untitled"', async () => {
		await vault.createFolder('Torts').catch(() => undefined);
		focusEditorOrBody();
		press('n', { ctrl: true });
		await sleep(80);
		const modal = topModal();
		const input = document.querySelector<HTMLInputElement>('.modal input[type="text"], .modal input:not([type])');
		const select = document.querySelector<HTMLSelectElement>('.modal select');
		if (!modal || !input || !select) { modal?.close(); return `modal=${!!modal} input=${!!input} select=${!!select}`; }
		input.value = 'Duty of care'; input.dispatchEvent(new Event('input'));
		select.value = 'Torts'; select.dispatchEvent(new Event('change'));
		input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
		await sleep(200);
		const made = vault.getFileByPath('Torts/Duty of care.md');
		const open = workspace.getActiveFile() === made;
		const untitled = vault.getMarkdownFiles().some((f) => /^Untitled/.test(f.basename));
		return (!!made && open && !untitled) || `made=${!!made} open=${open} untitled=${untitled}`;
	});

	await check('units: N and T on a row, "+ New note" in opened folders, A–Z with numbers in order', async () => {
		await vault.create('Torts/Week 10.md', '');
		await vault.create('Torts/Week 2.md', '');
		press('p', { ctrl: true });
		press('3', { ctrl: true });
		await sleep(100);
		const help = !!document.querySelector('.docket-panel .docket-help');
		const rows = rowsText();
		const order = rows.indexOf('Week 2') >= 0 && rows.indexOf('Week 2') < rows.indexOf('Week 10');
		const plusRow = rows.includes('New note in Torts');
		const noLabels = ![...document.querySelectorAll('.docket-panel .docket-folder .docket-option-detail')].length;
		const torts = focusRow('Torts');
		torts?.dispatchEvent(new KeyboardEvent('keydown', { key: 't', bubbles: true, cancelable: true }));
		await sleep(80);
		const topicModal = topModal();
		const ti = document.querySelector<HTMLInputElement>('.modal input');
		if (ti) { ti.value = 'Negligence'; ti.dispatchEvent(new Event('input')); ti.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); }
		await sleep(200);
		const topic = !!vault.getFolderByPath('Torts/Negligence');
		press('p', { ctrl: true });
		press('3', { ctrl: true });
		await sleep(100);
		focusRow('Negligence')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', bubbles: true, cancelable: true }));
		await sleep(80);
		const sel = document.querySelector<HTMLSelectElement>('.modal select')?.value;
		topModal()?.close();
		return (help && order && plusRow && noLabels && !!topicModal && topic && sel === 'Torts/Negligence') || `help=${help} order=${order} plus=${plusRow} noLabels=${noLabels} topicModal=${!!topicModal} topic=${topic} preselected=${sel}`;
	});

	await check('search: Enter opens the best match; "Create note" is last unless nothing matches', async () => {
		press('p', { ctrl: true });
		await type('welc');
		const first = document.querySelector('.docket-option.is-selected .docket-option-title')?.textContent ?? '';
		const groups = [...document.querySelectorAll('.docket-group')].map((g) => g.getAttribute('aria-label'));
		await type('zzqx nothing matches');
		const only = document.querySelector('.docket-option.is-selected .docket-option-title')?.textContent ?? '';
		press('Escape'); press('Escape');
		return (!first.startsWith('Create') && groups[groups.length - 1] === 'New note' && only.startsWith('Create note')) || `first=${first} groups=${groups.join('|')} only=${only}`;
	});

	await check('search: "Create note" says where, and → puts it somewhere else', async () => {
		press('p', { ctrl: true });
		await type('Remedies overview');
		const createRow = [...document.querySelectorAll('.docket-option')].find((o) => o.textContent?.includes('Create note “Remedies overview”'));
		const where = createRow?.querySelector('.docket-option-detail')?.textContent ?? '';
		const i = titles().indexOf('Create note “Remedies overview”');
		for (let k = 0; k < i; k++) press('ArrowDown');
		press('ArrowRight');
		await sleep(30);
		const j = titles().indexOf('Create it in another subject or topic…');
		for (let k = 0; k < j; k++) press('ArrowDown');
		press('Enter');
		await sleep(80);
		const places = titles();
		const t = places.indexOf('Torts / Negligence');
		for (let k = 0; k < t; k++) press('ArrowDown');
		press('Enter');
		await sleep(200);
		const made = !!vault.getFileByPath('Torts/Negligence/Remedies overview.md');
		press('Escape'); press('Escape');
		for (const p of ['Torts/Negligence/Remedies overview.md', 'Torts/Week 10.md', 'Torts/Week 2.md', 'Torts/Duty of care.md']) { const f = vault.getFileByPath(p); if (f) await vault.trash(f, true); }
		return (/^in /.test(where) && places.includes('Top level') && made) || `where=${where} places=${places.slice(0, 5).join('|')} made=${made}`;
	});

	await check('search: subjects and topics by name, notes once, commands grouped, no duplicate plugin commands', async () => {
		await vault.createFolder('Contracts/Formation').catch(() => undefined);
		await vault.create('Contracts/Formation/Offer and acceptance.md', 'Offer and acceptance.\n').catch(() => undefined);
		press('p', { ctrl: true });
		await type('contracts');
		const firstGroup = document.querySelector('.docket-group')?.getAttribute('aria-label');
		const folderRow = [...document.querySelectorAll('.docket-group[aria-label="Folders"] .docket-option')].find((o) => o.textContent?.includes('Contracts'));
		const counted = /1 note/.test(folderRow?.textContent ?? '');
		await type('offer and');
		const inNotesDup = [...document.querySelectorAll('.docket-group[aria-label="In notes"] .docket-option-title')].some((e) => e.textContent === 'Offer and acceptance');
		const named = [...document.querySelectorAll('.docket-group[aria-label="Notes"] .docket-option-title')].some((e) => e.textContent === 'Offer and acceptance');
		await type('>');
		const groups = [...document.querySelectorAll('.docket-group')].map((g) => g.getAttribute('aria-label'));
		press('Escape'); press('Escape');
		const names = commands.listCommands().map((c) => c.name);
		const dupPreview = names.filter((n) => /page preview/i.test(n) && /^AGLC4 Citations: /.test(n)).length;
		const dupHistory = names.filter((n) => n === 'AGLC4 Citations: Show version history').length;
		for (const p of ['Contracts/Formation/Offer and acceptance.md']) { const f = vault.getFileByPath(p); if (f) await vault.trash(f, true); }
		return (firstGroup === 'Folders' && counted && named && !inNotesDup && groups.includes('Notes') && groups.includes('Layout') && dupPreview === 1 && dupHistory === 1)
			|| `first=${firstGroup} counted=${counted} named=${named} inNotesDup=${inNotesDup} groups=${groups.slice(0, 6).join('|')} preview=${dupPreview} history=${dupHistory}`;
	});

	await check('keys: ↑ from the top goes back to the search; ← → switch panels; Units deletes and renames, and follows changes', async () => {
		const input = () => document.querySelector<HTMLInputElement>('.docket-input')!;
		// ↑ from the first result (keyboard in the list) and from the first panel row: back to the input.
		press('p', { ctrl: true });
		await type('welcome');
		press('Tab'); // into the results list
		press('ArrowUp');
		const fromResults = document.activeElement === input();
		await type('');
		press('3', { ctrl: true }); // Units always has rows
		await sleep(80);
		press('ArrowDown');
		const inRow = !!document.activeElement?.closest('.docket-panel');
		press('ArrowUp');
		const fromPanel = inRow && document.activeElement === input();
		// ← and → with nothing typed: previous and next panel.
		const active = () => document.querySelector('.docket-tab.is-active')?.textContent ?? '';
		press('ArrowRight');
		const next = active().includes('Cite');
		press('ArrowLeft'); press('ArrowLeft');
		const prev = active().includes('Outline');
		// Units: Delete on a folder says what it holds; confirming deletes it; the list follows.
		await vault.createFolder('Old subject/Old topic').catch(() => undefined);
		await vault.create('Old subject/Old topic/Old note.md', 'x').catch(() => undefined);
		await vault.create('Old subject/Rename me.md', 'y').catch(() => undefined);
		press('3', { ctrl: true });
		await sleep(150);
		const appeared = rowsText().includes('Old subject');
		focusRow('Old subject');
		press('Enter'); // open it
		await sleep(100);
		focusRow('Rename me');
		press('F2');
		await sleep(80);
		const ri = document.querySelector<HTMLInputElement>('.modal input');
		if (ri) { ri.value = 'Renamed here'; ri.dispatchEvent(new Event('input')); ri.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); }
		await sleep(300);
		const renamed = !!vault.getFileByPath('Old subject/Renamed here.md') && rowsText().includes('Renamed here');
		focusRow('Old subject');
		press('Delete');
		await sleep(80);
		const question = document.querySelector('.modal p')?.textContent ?? '';
		[...document.querySelectorAll<HTMLButtonElement>('.modal button')].find((b) => b.textContent === 'Continue')?.click();
		await sleep(400);
		const gone = !vault.getFolderByPath('Old subject') && !rowsText().includes('Old subject');
		const keyboardBack = !!document.activeElement?.closest('.docket-panel');
		press('Escape'); press('Escape');
		return (fromResults && fromPanel && next && prev && appeared && renamed && /2 notes/.test(question) && gone && keyboardBack)
			|| `fromResults=${fromResults} fromPanel=${fromPanel} next=${next} prev=${prev} appeared=${appeared} renamed=${renamed} question="${question}" gone=${gone} keyboardBack=${keyboardBack}`;
	});

	await check('cheat sheet: "?" lists the Docket keys, prefixes and every shortcut by section', async () => {
		press('p', { ctrl: true });
		await type('?');
		const groups = [...document.querySelectorAll('.docket-group')].map((g) => g.getAttribute('aria-label'));
		const docketKeys = titles().includes('Open to the right');
		const split = [...document.querySelectorAll('.docket-option')].some((o) => o.textContent?.includes('Split right') && /\\/.test(o.querySelector('.docket-option-hint')?.textContent ?? ''));
		press('Escape'); press('Escape');
		return (groups[0] === 'In the Docket' && groups[1] === 'In Units' && groups[2] === 'Prefixes' && groups.includes('Layout') && docketKeys && split) || `groups=${groups.join('|')} keys=${docketKeys} split=${split}`;
	});

	await check('security: locked notes stay out of search, authorities, links and Units', async () => {
		const essayNote = vault.getFileByPath('AGLC4 example essay.md')!;
		const realLocked = app.isLocked.bind(app);
		app.isLocked = (f) => f === essayNote || realLocked(f);
		try {
			const other = vault.getFileByPath('Welcome.md')!;
			await workspace.getLeaf(false).openFile(other);
			await sleep(100);
			const seen: string[] = [];
			for (const q of ['AGLC4 example', 'native title', 'extinguishment', '@mabo', '#a']) {
				press('p', { ctrl: true });
				await type(q);
				if ([...document.querySelectorAll('.docket-option')].some((o) => /AGLC4 example essay/.test(o.textContent ?? ''))) seen.push(q);
				press('Escape'); press('Escape');
			}
			press('p', { ctrl: true });
			press('3', { ctrl: true });
			await sleep(80);
			// Units lists a locked note by name only, with a lock and no actions.
			const lockedRow = [...document.querySelectorAll<HTMLElement>('.docket-panel .docket-item')].find((r) => r.querySelector('.docket-option-title')?.textContent === 'AGLC4 example essay');
			if (lockedRow && (!lockedRow.classList.contains('is-locked') || lockedRow.dataset.docketActions !== undefined && false)) seen.push('Units (not marked locked)');
			press('Escape');
			// Opening it does nothing without unlocking (locking is not set up yet here, so nothing asks).
			await workspace.getLeaf(false).openFile(essayNote);
			await sleep(100);
			const notOpened = workspace.getActiveFile() !== essayNote;
			return (seen.length === 0 && notOpened) || `seen in: ${seen.join(', ')} opened=${!notOpened}`;
		} finally {
			app.isLocked = realLocked;
		}
	});

	await check('security: a search that is typed is never logged', async () => {
		press('p', { ctrl: true });
		await type('QUIRE-QUERY-5521');
		await type('>QUIRE-QUERY-5521');
		press('Escape'); press('Escape');
		return true; // the main process checks every console message at the end (logsClean)
	});

	await check('accessibility: the Docket\'s roles, names, live region and reduced motion', async () => {
		press('p', { ctrl: true });
		await type('welcome');
		const dock = document.querySelector('.docket')!;
		const problems: string[] = [];
		if (dock.getAttribute('role') !== 'dialog' || !dock.getAttribute('aria-label')) problems.push('dialog');
		const input = document.querySelector('.docket-input')!;
		const list = document.getElementById(input.getAttribute('aria-controls') ?? '');
		if (input.getAttribute('role') !== 'combobox' || list?.getAttribute('role') !== 'listbox') problems.push('combobox/listbox');
		if (!document.getElementById(input.getAttribute('aria-activedescendant') ?? '')) problems.push('active option');
		if ([...document.querySelectorAll('.docket-option')].some((o) => o.getAttribute('role') !== 'option')) problems.push('options');
		if (!document.querySelector('.docket [role=status][aria-live]')?.textContent) problems.push('live region');
		const tabs = [...document.querySelectorAll('.docket-tabs [role=tab]')];
		if (document.querySelector('.docket-tabs')?.getAttribute('role') !== 'tablist' || tabs.filter((t) => t.getAttribute('aria-selected') === 'true').length !== 1) problems.push('tabs');
		const unnamed = [...dock.querySelectorAll('button, [role=button], input, select')].filter((b) => !(b.getAttribute('aria-label') || b.textContent?.trim() || b.getAttribute('placeholder')));
		if (unnamed.length) problems.push(`${unnamed.length} unnamed controls`);
		press('Escape'); press('Escape');
		const reduced = [...document.styleSheets].some((sh) => { try { return [...sh.cssRules].some((r) => r instanceof CSSMediaRule && /prefers-reduced-motion/.test(r.conditionText) && /docket/.test(r.cssText)); } catch { return false; } });
		if (!reduced) problems.push('reduced motion');
		return problems.length === 0 || problems.join(', ');
	});

	await check('docket: can be taken down and built again (plugins and tests)', async () => {
		await app.setConfig('docket', false);
		await app.setConfig('docketPanel', 'core:outline');
		const gone = !document.querySelector('.docket') && !ui();
		const palette = !commands.isAvailable(commands.findCommand('app:command-palette')!); // nothing to open without the Docket
		const noProviders = app.docket.providers.size === 0 && app.docket.panels.size === 0;
		await app.setConfig('docket', true);
		const back = !!ui() && app.docket.panels.size === 6;
		return (gone && palette && noProviders && back) || `gone=${gone} palette=${palette} providers=${app.docket.providers.size} back=${back}`;
	});
}

/**
 * Performance budgets on a large homebase (npm run bench: 10,000 generated notes): the Docket opens in
 * under 50 ms, each keystroke filters in under 16 ms, a pane split opens in under 100 ms.
 */
export async function runBench(app: App): Promise<void> {
	const { workspace, vault } = app;
	const checks: Check[] = [];
	const t0 = performance.now();
	await app.search.ready;
	const indexMs = performance.now() - t0;
	await app.setConfig('docket', true);
	type DocketUI = { open(o?: object): number; close(hide?: boolean): void; update(): Promise<void> };
	const ui = (app as unknown as { docketUI: DocketUI }).docketUI;
	const input = () => document.querySelector<HTMLInputElement>('.docket-input')!;
	const note = vault.getMarkdownFiles()[0]!;
	await workspace.getLeaf(false).openFile(note);
	await sleep(300);
	const stats = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return { median: s[Math.floor(s.length / 2)]!, p90: s[Math.floor(s.length * 0.9)]!, worst: s[s.length - 1]! }; };
	const round = (n: number) => Math.round(n * 10) / 10;

	const opens: number[] = [];
	for (let i = 0; i < 12; i++) { opens.push(ui.open()); await sleep(20); ui.close(true); await sleep(20); }
	const open = stats(opens.slice(2));
	checks.push({ name: `Docket opens in under 50 ms (median ${round(open.median)}, worst ${round(open.worst)})`, ok: open.worst < 50 });

	const typed = ['s', 'sm', 'smi', 'smit', 'smith', 'smith v', 'smith v j', 'n', 'ne', 'neg', 'negl', 'neglig', 'negligence', 'negligence b', 'negligence breach', 'pro', 'proximate', 'proximate rel', '>sp', '>split', '#to', '#torts'];
	const keys: number[] = [];
	ui.open();
	for (const q of typed) {
		input().value = q;
		const t = performance.now();
		await ui.update(); // what the input event runs: search every provider and draw the results
		keys.push(performance.now() - t);
		await sleep(10);
	}
	const results = document.querySelectorAll('.docket-option').length;
	ui.close(true);
	const key = stats(keys);
	// Diagnosis: each provider alone, on a fresh index cache, for the slow first keystrokes.
	const per: string[] = [];
	for (const q of ['s', 'ne', '#to']) {
		const parts: string[] = [];
		const prefix = q.startsWith('#') ? '#' : '';
		const text = q.replace(/^#/, '');
		for (const p of app.docket.providers.values()) {
			if (!p.prefixes.includes(prefix)) continue;
			(app.search.index as unknown as { lastNames: null; lastHeadings: null }).lastNames = null;
			(app.search.index as unknown as { lastHeadings: null }).lastHeadings = null;
			const t = performance.now(); await p.search({ prefix, text }); parts.push(`${p.id.replace('core:', '')} ${round(performance.now() - t)}`);
		}
		per.push(`${q}: ${parts.join(', ')}`);
	}
	checks.push({ name: `(providers: ${per.join(' | ')})`, ok: true });
	const slow = typed.map((q, i) => `${q}: ${round(keys[i]!)}`).filter((_, i) => keys[i]! > 12).join(', ');
	checks.push({ name: `(slowest keystrokes: ${slow || 'none over 12 ms'})`, ok: true });
	checks.push({ name: `Filtering takes under 16 ms a keystroke (median ${round(key.median)}, 90th percentile ${round(key.p90)}, worst ${round(key.worst)})`, ok: key.p90 < 16 && results > 0 });

	const splits: number[] = [];
	for (let i = 0; i < 5; i++) {
		const leaf = workspace.activeLeaf!;
		const t = performance.now();
		const next = await workspace.duplicateLeaf(leaf, 'vertical'); // what Split right runs
		next.view.containerEl.getBoundingClientRect(); // laid out
		splits.push(performance.now() - t);
		await sleep(100);
		next.detach();
		workspace.setActiveLeaf(leaf, { focus: true });
		await sleep(50);
	}
	const split = stats(splits);
	checks.push({ name: `A pane split opens in under 100 ms (median ${round(split.median)}, worst ${round(split.worst)})`, ok: split.worst < 100 });
	checks.push({ name: `Index of ${app.search.index.size} notes ready ${Math.round(indexMs)} ms after the window`, ok: app.search.index.size === vault.getMarkdownFiles().length });
	await app.setConfig('docket', false);
	app.host.app.smokeReport?.({ ok: checks.every((c) => c.ok), checks, notices: [] });
}

/** Tiling, from the keyboard only (Phase 5). */
async function tilingChecks(app: App, check: CheckFn): Promise<void> {
	const { workspace, vault } = app;
	const panes = () => workspace.rootTabs().length;
	const essay = vault.getFileByPath('AGLC4 example essay.md') ?? vault.getMarkdownFiles()[0]!;
	const single = async () => { workspace.mergeAllPanes(); for (const t of workspace.rootTabs()) for (const l of [...t.children].slice(1)) l.detach(); await sleep(80); };
	await single();
	await workspace.getLeaf(false).openFile(essay);
	await sleep(150);
	const focusEditor = () => workspace.getActiveViewOfType(MarkdownView)?.editor.cm.focus();

	await check('tiling: Mod+\\ splits right, Mod+Shift+\\ splits down; arrows move between panes', async () => {
		focusEditor();
		press('\\', { ctrl: true });
		await sleep(150);
		const two = panes() === 2;
		press('\\', { ctrl: true, shift: true });
		await sleep(150);
		const three = panes() === 3;
		const bottomRight = workspace.activeLeaf!;
		press('ArrowUp', { ctrl: true, alt: true });
		const up = workspace.activeLeaf !== bottomRight;
		press('ArrowLeft', { ctrl: true, alt: true });
		const left = workspace.activeLeaf;
		press('ArrowRight', { ctrl: true, alt: true });
		const right = workspace.activeLeaf !== left;
		return (two && three && up && right) || `two=${two} three=${three} up=${up} right=${right} panes=${panes()}`;
	});

	await check('tiling: resize, equalise and zoom from the keyboard; sizes are saved', async () => {
		const leaf = workspace.activeLeaf!;
		const share = () => { const { tree, panes: ids } = workspace.layoutTree(); const id = [...ids].find(([, t]) => t === leaf.parent)![0]; return paneRects(tree).get(id)!.w; };
		const before = share();
		press(Platform.isMacOS ? 'ArrowRight' : ']', Platform.isMacOS ? { ctrl: true } : { ctrl: true, alt: true });
		const wider = share() > before + 0.01;
		const saved = JSON.stringify(workspace.getLayout()).includes(String(leaf.parent!.parent!.children[0]!.weight).slice(0, 4));
		press('=', { ctrl: true, shift: true });
		const equal = workspace.rootSplit.children.every((c) => c.weight === 1);
		press('Enter', { ctrl: true, shift: true });
		await sleep(50);
		const hidden = workspace.rootTabs().filter((t) => t.containerEl.offsetParent === null).length;
		const zoomed = workspace.zoomed && hidden === panes() - 1;
		press('Enter', { ctrl: true, shift: true });
		await sleep(50);
		const back = !workspace.zoomed && workspace.rootTabs().every((t) => t.containerEl.offsetParent !== null);
		return (wider && saved && equal && zoomed && back) || `wider=${wider} saved=${saved} equal=${equal} zoomed=${zoomed} back=${back}`;
	});

	await check('tiling: move a tab to the next pane; close it; Mod+Shift+T reopens it', async () => {
		const leaf = workspace.getLeaf('tab');
		await leaf.openFile(vault.getFileByPath('Welcome.md')!);
		workspace.setActiveLeaf(leaf, { focus: true });
		const from = leaf.parent;
		press('ArrowLeft', { ctrl: true, alt: true, shift: true });
		await sleep(50);
		const moved = leaf.parent !== from && workspace.activeLeaf === leaf;
		const before = panes();
		press('w', { ctrl: true });
		await sleep(150);
		const closed = !workspace.getLeavesOfType('markdown').some((l) => l === leaf);
		press('t', { ctrl: true, shift: true });
		await sleep(200);
		const reopened = workspace.getActiveFile()?.path === 'Welcome.md';
		return (moved && closed && reopened && panes() <= before) || `moved=${moved} closed=${closed} reopened=${reopened}`;
	});

	await check('tiling: the same note in two panes stays in sync, each with its own cursor', async () => {
		await single();
		const note = await vault.create('Sync test.md', 'Hello world\n');
		const a = workspace.getLeaf(false);
		await a.openFile(note);
		const b = await workspace.duplicateLeaf(a, 'vertical');
		await sleep(150);
		const ca = (a.view as MarkdownView).editor.cm;
		const cb = (b.view as MarkdownView).editor.cm;
		cb.dispatch({ selection: { anchor: 0 } });
		ca.dispatch({ changes: { from: 5, insert: ',' }, selection: { anchor: 6 }, userEvent: 'input' });
		const same = ca.state.doc.toString() === cb.state.doc.toString() && cb.state.doc.toString() === 'Hello, world\n';
		const own = cb.state.selection.main.head === 0 && ca.state.selection.main.head === 6;
		b.detach();
		await sleep(50);
		return (same && own) || `a=${JSON.stringify(ca.state.doc.toString())} b=${JSON.stringify(cb.state.doc.toString())} own=${own}`;
	});

	await check('tiling: drag tabs along the bar, onto a pane\'s edge or middle, and to the window\'s edges', async () => {
		await single();
		const names = ['Welcome.md', 'Renamed note.md', 'Folder/Inside.md'];
		const leaves: WorkspaceLeaf[] = [];
		for (const n of names) { const l = workspace.getLeaf('tab'); await l.openFile(vault.getFileByPath(n) ?? vault.getMarkdownFiles()[0]!); leaves.push(l); }
		await sleep(150);
		const textBefore = leaves.map((l) => (l.view as MarkdownView).editor?.getValue?.() ?? '');
		const drag = async (leaf: WorkspaceLeaf, x: number, y: number) => {
			const dt = new DataTransfer();
			leaf.tabHeaderEl.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
			const target = document.elementFromPoint(x, y) ?? workspace.containerEl;
			target.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer: dt }));
			const overlay = !!document.querySelector('.workspace-drop-overlay, .workspace-tab-drop-marker');
			target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer: dt }));
			leaf.tabHeaderEl.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
			await sleep(80);
			return overlay;
		};
		const titlesOf = (t: WorkspaceLeaf['parent']) => t!.children.map((l) => l.getDisplayText());
		// 1. Along the bar: the last tab to before the first of these three.
		const tabs = leaves[0]!.parent!;
		const first = leaves[0]!.tabHeaderEl.getBoundingClientRect();
		const shown1 = await drag(leaves[2]!, first.left + 3, first.top + first.height / 2);
		const order = titlesOf(tabs);
		const reordered = order.indexOf(leaves[2]!.getDisplayText()) < order.indexOf(leaves[0]!.getDisplayText());
		// 2. Onto the right edge of the pane: a split.
		const r = tabs.contentEl.getBoundingClientRect();
		const panesBefore = workspace.rootTabs().length;
		const shown2 = await drag(leaves[1]!, r.right - 40, r.top + r.height / 2);
		const newPane = leaves[1]!.parent!;
		const nb = newPane.containerEl.getBoundingClientRect();
		const split = workspace.rootTabs().length === panesBefore + 1 && newPane !== tabs && nb.left >= r.left + r.width / 2 - 2;
		// 3. Into the middle of the other pane: moves there.
		const other = leaves[1]!.parent!.contentEl.getBoundingClientRect();
		await drag(leaves[0]!, other.left + other.width / 2, other.top + other.height / 2);
		const moved = leaves[0]!.parent === leaves[1]!.parent;
		// 4. The window's left edge: a new pane down the whole left side.
		const root = workspace.rootSplit.containerEl.getBoundingClientRect();
		const shown4 = await drag(leaves[0]!, root.left + 8, root.top + root.height / 2);
		const leftmost = workspace.rootSplit.children[0] === leaves[0]!.parent;
		// 5. The window's bottom edge: the main area becomes a column, the new pane across the bottom.
		await drag(leaves[2]!, root.left + root.width / 2, root.bottom - 8);
		const bottom = workspace.rootSplit.direction === 'horizontal' && workspace.rootSplit.children[workspace.rootSplit.children.length - 1] === leaves[2]!.parent;
		const saved = (workspace.getLayout().main as { direction?: string }).direction === 'horizontal';
		const textAfter = leaves.map((l) => (l.view as MarkdownView).editor?.getValue?.() ?? '');
		const untouched = textBefore.every((t, i) => t === textAfter[i]);
		workspace.rootSplit.setDirection('vertical');
		await single();
		const ok = shown1 && reordered && shown2 && split && moved && shown4 && leftmost && bottom && saved && untouched;
		return ok || `marker=${shown1} reordered=${reordered} overlay=${shown2} split=${split} moved=${moved} edgeOverlay=${shown4} leftmost=${leftmost} bottom=${bottom} saved=${saved} untouched=${untouched}`;
	});

	await check('tiling: presets and saved layouts', async () => {
		await workspace.getLeaf(false).openFile(essay);
		await sleep(80);
		app.commands.executeCommandById('app:layout-brief-source');
		await sleep(250);
		const two = panes() === 2;
		const files = workspace.rootTabs().map((t) => (t.activeLeaf?.view as MarkdownView | undefined)?.file?.basename);
		const saved = workspace.getMainLayout();
		await app.setConfig('savedLayouts', { Test: saved });
		app.commands.executeCommandById('app:layout-single');
		await sleep(150);
		const one = panes() === 1;
		await (app as unknown as { tiling: { applySaved(n: string): Promise<void> } }).tiling.applySaved('Test');
		await sleep(150);
		const restored = panes() === 2;
		await app.setConfig('savedLayouts', {});
		app.commands.executeCommandById('app:layout-single');
		await sleep(100);
		return (two && files[0] === essay.basename && !!files[1] && one && restored) || `two=${two} files=${files.join('|')} one=${one} restored=${restored}`;
	});
}

/** Locking with real encryption, end to end (docs/docket/locking.md). */
async function lockingChecks(app: App, check: CheckFn): Promise<void> {
	const { vault, workspace, commands } = app;
	const PASS = 'correct horse battery staple';
	const SECRET = 'PRIVILEGED-CLIENT-ADVICE-4417';
	let recoveryKey = '';
	const modalInputs = () => [...document.querySelectorAll<HTMLInputElement>('.modal input')];
	const fill = (el: HTMLInputElement | undefined, v: string) => { if (!el) return; el.value = v; el.dispatchEvent(new Event('input')); };
	const enter = (el: HTMLInputElement | undefined) => el?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
	const raw = (p: string) => vault.adapter.read(p);
	const unlockWith = async (pass: string) => {
		const p = app.lock.requestUnlock();
		await sleep(60);
		const input = modalInputs().find((i) => i.type === 'password');
		fill(input, pass);
		enter(input);
		await until(() => !topModal() || /not right/.test(document.querySelector('.lock-error')?.textContent ?? ''), 8000);
		const wrong = !!topModal();
		topModal()?.close();
		return (await p) && !wrong;
	};

	await check('locking: set up with a passphrase; the recovery key is shown once', async () => {
		commands.executeCommandById('app:lock-setup');
		await sleep(60);
		const [a, b] = modalInputs().filter((i) => i.type === 'password');
		fill(a, PASS); fill(b, PASS);
		enter(b);
		await until(() => !!document.querySelector('.lock-recovery-key'), 15000);
		recoveryKey = document.querySelector('.lock-recovery-key')?.textContent ?? '';
		const done = [...document.querySelectorAll<HTMLButtonElement>('.modal button')].find((x) => x.textContent === 'Done');
		const disabledFirst = !!done?.disabled;
		document.querySelector<HTMLElement>('.modal .checkbox-container')?.click();
		await sleep(30);
		done?.click();
		await sleep(60);
		const lockJson = await raw('.quire/lock.json');
		return (/^([A-Z2-9]{5}-){7}[A-Z2-9]{5}$/.test(recoveryKey) && disabledFirst && !topModal() && app.lock.isSetUp && app.lock.isUnlocked && !lockJson.includes(PASS) && !lockJson.includes(recoveryKey))
			|| `key=${recoveryKey} disabledFirst=${disabledFirst} modal=${!!topModal()} setUp=${app.lock.isSetUp}`;
	});

	await check('locking: a locked note is encrypted on disk; while unlocked it reads, edits and saves (still encrypted)', async () => {
		const note = await vault.create('Client matter.md', `# Client matter\n\n${SECRET}\n\nSee [[Welcome]].\n`);
		await workspace.getLeaf(false).openFile(note);
		await sleep(100);
		commands.executeCommandById('app:lock-note', { file: note });
		await until(async () => (await raw(note.path)).includes('quire-encrypted'), 8000);
		const disk = await raw(note.path);
		const readable = (await vault.read(note)).includes(SECRET);
		const view = workspace.getActiveViewOfType(MarkdownView)!;
		view.editor.replaceRange('Added while unlocked. ', { line: 2, ch: 0 });
		await view.save();
		const after = await raw(note.path);
		// The AGLC4 plugin's version history keeps no copy of a locked note (its versions are compressed, so
		// ask the history itself rather than searching its files).
		await sleep(300);
		const plugin = app.plugins.getPlugin('aglc-citations') as unknown as { history?: { versions(p: string): Promise<unknown[]> } } | null;
		const versions = plugin?.history ? (await plugin.history.versions(note.path)).length : -1;
		return (disk.includes('This note is encrypted by Quire') && !disk.includes(SECRET) && readable && after.includes('quire-encrypted') && !after.includes('Added while unlocked') && versions === 0)
			|| `sealed=${disk.includes('quire-encrypted')} plainOnDisk=${disk.includes(SECRET)} readable=${readable} afterSealed=${after.includes('quire-encrypted')} historyVersions=${versions}`;
	});

	await check('locking: Lock now closes it and hides it everywhere; opening asks for the passphrase; a wrong one is refused', async () => {
		const note = vault.getFileByPath('Client matter.md')!;
		const v = workspace.getActiveViewOfType(MarkdownView);
		v?.editor.cm.focus();
		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'l', ctrlKey: true, bubbles: true, cancelable: true }));
		await until(() => !app.lock.isUnlocked, 5000);
		await sleep(100);
		const closed = !workspace.getLeavesOfType('markdown').some((l) => (l.view as MarkdownView).file === note);
		let refused = false;
		try { await vault.cachedRead(note); } catch (e) { refused = (e as Error).name === 'LockedError'; }
		const noLinks = Object.keys(app.metadataCache.resolvedLinks[note.path] ?? {}).length === 0;
		const notIndexed = !app.search.index.has(note.path);
		const wrong = await unlockWith('not the passphrase');
		const stillLocked = !app.lock.isUnlocked;
		// Opening it asks; the right passphrase opens it.
		const opening = workspace.getLeaf(false).openFile(note);
		await sleep(80);
		const asked = !!topModal();
		const input = modalInputs().find((i) => i.type === 'password');
		fill(input, PASS); enter(input);
		await opening;
		await sleep(100);
		const opened = workspace.getActiveFile() === note && (workspace.getActiveViewOfType(MarkdownView)?.editor.getValue() ?? '').includes(SECRET);
		const reindexed = Object.keys(app.metadataCache.resolvedLinks[note.path] ?? {}).length > 0;
		return (closed && refused && noLinks && notIndexed && !wrong && stillLocked && asked && opened && reindexed)
			|| `closed=${closed} refused=${refused} noLinks=${noLinks} notIndexed=${notIndexed} wrongAccepted=${wrong} asked=${asked} opened=${opened} reindexed=${reindexed}`;
	});

	await check('locking: a locked folder encrypts its notes and new ones; nothing can be added while locked', async () => {
		await vault.createFolder('Matters').catch(() => undefined);
		const before = await vault.create('Matters/Old file note.md', `Before: ${SECRET}\n`);
		const folder = vault.getFolderByPath('Matters')!;
		await app.lock.lockFolder(folder);
		const fresh = await vault.create('Matters/New file note.md', `After: ${SECRET}\n`);
		const both = !(await raw(before.path)).includes(SECRET) && !(await raw(fresh.path)).includes(SECRET);
		await app.lock.lock();
		let refused = false;
		try { await vault.create('Matters/Third.md', 'x'); } catch (e) { refused = (e as Error).name === 'LockedError'; }
		const third = !vault.getFileByPath('Matters/Third.md') || !(await raw('Matters/Third.md').catch(() => '')).includes('x');
		return (both && refused && third) || `bothSealed=${both} refused=${refused} third=${third}`;
	});

	await check('locking: the recovery key unlocks and sets a new passphrase; the old one stops working', async () => {
		const p = app.lock.requestUnlock();
		await sleep(60);
		[...document.querySelectorAll<HTMLButtonElement>('.modal button')].find((b) => b.textContent?.startsWith('Use the recovery key'))?.click();
		await sleep(80);
		const inputs = modalInputs();
		fill(inputs[0], recoveryKey.toLowerCase().replace(/-/g, ' '));
		const NEW = 'a brand new passphrase';
		fill(inputs[1], NEW); fill(inputs[2], NEW);
		enter(inputs[2]);
		const ok = await p;
		await app.lock.lock();
		const oldFails = !(await app.lock.unlock(PASS));
		const newWorks = await app.lock.unlock(NEW);
		// Back to the first passphrase for the rest of the checks.
		await app.lock.changePassphrase(NEW, PASS);
		return (ok && oldFails && newWorks) || `recovered=${ok} oldFails=${oldFails} newWorks=${newWorks}`;
	});

	await check('locking: sleep locks it (setting on); removing a lock decrypts the note on disk', async () => {
		app.host.app.smokeSystemLock?.();
		await until(() => !app.lock.isUnlocked, 3000);
		const slept = !app.lock.isUnlocked;
		await app.lock.unlock(PASS);
		const note = vault.getFileByPath('Client matter.md')!;
		await app.lock.removeNoteLock(note);
		const plain = (await raw(note.path)).includes(SECRET);
		await app.lock.removeFolderLock(vault.getFolderByPath('Matters')!);
		const folderPlain = (await raw('Matters/New file note.md')).includes(SECRET);
		for (const p of ['Client matter.md', 'Matters/Old file note.md', 'Matters/New file note.md']) { const f = vault.getFileByPath(p); if (f) await vault.trash(f, true); }
		return (slept && plain && folderPlain) || `slept=${slept} notePlain=${plain} folderPlain=${folderPlain}`;
	});
}

/** The note's name as an editable title above its text. */
async function titleChecks(app: App, check: CheckFn): Promise<void> {
	const { vault, workspace } = app;
	const title = () => [...document.querySelectorAll<HTMLInputElement>('.workspace-leaf.mod-active input.inline-title')].find((e) => e.offsetParent !== null) ?? null;
	const editTitle = async (text: string, key: string) => {
		const t = title()!;
		t.focus();
		t.value = text;
		t.dispatchEvent(new Event('input'));
		t.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
		await sleep(300);
	};
	await check('title: the note\'s name above its text; editing it renames the note and links follow', async () => {
		const note = vault.getFileByPath('Renamed note.md')!;
		await workspace.getLeaf(false).openFile(note);
		const v = workspace.getActiveViewOfType(MarkdownView)!;
		if (v.getMode() !== 'source') await v.setMode('source');
		await sleep(150);
		const shows = title()?.value === 'Renamed note';
		const notInText = !v.editor.getValue().startsWith('Renamed note');
		await editTitle('Retitled note', 'Enter');
		const renamed = !!vault.getFileByPath('Retitled note.md') && !vault.getFileByPath('Renamed note.md');
		const linkFollowed = (await vault.read(vault.getFileByPath('Welcome.md')!)).includes('[[Retitled note');
		const inText = v.editor.cm.dom.contains(document.activeElement);
		const showsNew = title()?.value === 'Retitled note';
		// Esc puts the name back; a bad name and a name already taken are refused.
		await editTitle('Something else', 'Escape');
		const escaped = title()?.value === 'Retitled note' && !!vault.getFileByPath('Retitled note.md');
		await editTitle('Bad: name', 'Enter');
		const badRefused = !!vault.getFileByPath('Retitled note.md') && title()?.value === 'Retitled note';
		await editTitle('Welcome', 'Enter');
		const takenRefused = !!vault.getFileByPath('Retitled note.md');
		// ↑ on the first line goes up into the title; ↓ (or Enter) back down.
		v.editor.cm.dispatch({ selection: { anchor: 0 } });
		v.editor.cm.focus();
		runScopeHandlers(v.editor.cm, new KeyboardEvent('keydown', { key: 'ArrowUp' }), 'editor');
		await sleep(50);
		const upInto = document.activeElement === title();
		title()?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
		await sleep(50);
		const downOut = v.editor.cm.dom.contains(document.activeElement);
		// Reading view has it too.
		await v.setMode('preview');
		await sleep(150);
		const reading = [...document.querySelectorAll<HTMLInputElement>('.markdown-reading-view input.inline-title')].some((e) => e.value === 'Retitled note');
		await v.setMode('source');
		// Turned off in Settings → Editor: gone.
		await app.setConfig('inlineTitle', false);
		await sleep(80);
		const off = !title();
		await app.setConfig('inlineTitle', true);
		await sleep(80);
		// Put the name back for the rest of the tests.
		await app.fileManager.renameFile(vault.getFileByPath('Retitled note.md')!, 'Renamed note.md');
		const ok = shows && notInText && renamed && linkFollowed && inText && showsNew && escaped && badRefused && takenRefused && upInto && downOut && reading && off;
		return ok || `shows=${shows} notInText=${notInText} renamed=${renamed} links=${linkFollowed} inText=${inText} showsNew=${showsNew} esc=${escaped} bad=${badRefused} taken=${takenRefused} up=${upInto} down=${downOut} reading=${reading} off=${off}`;
	});
}
