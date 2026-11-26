/**
 * Templates: any note in the templates folder (Settings → Editor; "Templates" by default) is a template. Each is
 * offered in the "/" menu and by "Insert template…", and "New note from template…" makes a note from one.
 * "Save as template…" turns the selection (or the whole note) into one, so making a template takes a moment.
 *
 * In a template, {{title}} becomes the note's name, {{date}} and {{time}} today's date and the time now (or in a
 * format given: {{date:D MMMM YYYY}}, {{time:HH:mm}}), and {{cursor}} marks where the cursor goes. A template's
 * properties go into the note's own properties (those it lacks) when it is inserted into a note.
 */
import { type App, type Command, type Editor, FuzzySuggestModal, type FuzzyMatch, Notice, TFile, TFolder, editFrontmatter, parseYaml, splitFrontMatter } from '@quire/api';
import { NameModal, NewNoteModal, notePlaces } from './dialogs';
import { CURSOR, type SlashItem, insertTemplate } from './slash';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** `d` in a format of YYYY, MM, M, MMMM, MMM, DD, D, dddd, ddd, HH, H, mm, ss ("D MMMM YYYY"). */
export function formatDate(d: Date, format: string): string {
	const p = (n: number) => String(n).padStart(2, '0');
	const tokens: Record<string, () => string> = {
		YYYY: () => String(d.getFullYear()), MMMM: () => MONTHS[d.getMonth()]!, MMM: () => MONTHS[d.getMonth()]!.slice(0, 3),
		MM: () => p(d.getMonth() + 1), M: () => String(d.getMonth() + 1), dddd: () => DAYS[d.getDay()]!, ddd: () => DAYS[d.getDay()]!.slice(0, 3),
		DD: () => p(d.getDate()), D: () => String(d.getDate()), HH: () => p(d.getHours()), H: () => String(d.getHours()),
		mm: () => p(d.getMinutes()), ss: () => p(d.getSeconds()),
	};
	return format.replace(/YYYY|MMMM|MMM|MM|M|dddd|ddd|DD|D|HH|H|mm|ss/g, (t) => tokens[t]!());
}

/** A template's text with its {{variables}} filled; {{cursor}} becomes the cursor's mark (the first one only). */
export function fillTemplate(text: string, ctx: { title: string; now: Date }): string {
	let cursor = false;
	return text.replace(/\{\{\s*(\w+)(?::([^}]*))?\s*\}\}/g, (all, name: string, fmt: string | undefined) => {
		switch (name.toLowerCase()) {
			case 'title': return ctx.title;
			case 'date': return formatDate(ctx.now, fmt?.trim() || 'YYYY-MM-DD');
			case 'time': return formatDate(ctx.now, fmt?.trim() || 'HH:mm');
			case 'cursor': if (cursor) return ''; cursor = true; return CURSOR;
			default: return all;
		}
	});
}

export function templatesFolder(app: App): string {
	return String(app.config.templatesFolder || 'Templates').replace(/^\/+|\/+$/g, '');
}

/** The templates: the notes in the templates folder (and its folders), by name. */
export function listTemplates(app: App): TFile[] {
	const folder = app.vault.getFolderByPath(templatesFolder(app));
	if (!folder) return [];
	const out: TFile[] = [];
	const walk = (f: TFolder) => { for (const c of f.children) { if (c instanceof TFolder) walk(c); else if (c instanceof TFile && c.extension === 'md') out.push(c); } };
	walk(folder);
	return out.sort((a, b) => a.basename.localeCompare(b.basename));
}

/** Insert `template` at the cursor in `editor` (the note `title`): its properties merged into the note's own. */
export async function insertTemplateFile(app: App, editor: Editor, template: TFile, title: string): Promise<void> {
	const filled = fillTemplate(await app.vault.cachedRead(template), { title, now: new Date() });
	const { yaml, body } = splitFrontMatter(filled);
	let text = yaml === null ? filled : body.replace(/^\n+/, '');
	const cursor = editor.getCursor();
	const line = editor.getLine(cursor.line);
	// A block of its own: after any text on the line, on a new line.
	if (line.slice(0, cursor.ch).trim()) text = `\n\n${text}`;
	insertTemplate(editor, text.replace(/\n+$/, ''), cursor, cursor);
	if (yaml) mergeProperties(editor, yaml);
}

/** Add the properties in `yaml` that the note in `editor` does not have yet (its own values stay). */
function mergeProperties(editor: Editor, yaml: string) {
	let props: unknown;
	try { props = parseYaml(yaml); } catch { return; }
	if (!props || typeof props !== 'object' || Array.isArray(props)) return;
	const doc = editor.getValue();
	const own = splitFrontMatter(doc);
	let mine = own.yaml ?? '';
	let have: Record<string, unknown> = {};
	try { have = (parseYaml(mine) as Record<string, unknown> | null) ?? {}; } catch { return; }
	for (const [k, v] of Object.entries(props as Record<string, unknown>)) {
		if (k in have) continue;
		try { mine = editFrontmatter(mine, { op: 'set', key: k, value: v }); } catch { return; }
	}
	if (mine === (own.yaml ?? '')) return;
	const block = `---\n${mine}${mine && !mine.endsWith('\n') ? '\n' : ''}---\n`;
	// The block replaces the old one (or goes at the top); the cursor keeps its place in the text below.
	const cursor = editor.posToOffset(editor.getCursor());
	editor.replaceRange(block, { line: 0, ch: 0 }, editor.offsetToPos(own.end));
	editor.setCursor(editor.offsetToPos(cursor + block.length - own.end));
}

class TemplatePicker extends FuzzySuggestModal<TFile> {
	constructor(app: App, private onChoose: (f: TFile) => void) {
		super(app);
		this.setPlaceholder('Choose a template…');
		this.emptyStateText = `No templates yet: notes in "${templatesFolder(app)}" are templates. "Save as template…" makes one.`;
	}
	getItems(): TFile[] { return listTemplates(this.app); }
	getItemText(f: TFile): string { return f.basename; }
	onChooseItem(f: TFile): void { this.onChoose(f); }
	override renderSuggestion(m: FuzzyMatch<TFile>, el: HTMLElement): void { el.setText(m.item.basename); }
}

/** The "/" menu's template items: one per template. */
export function templateSlashItems(app: App): SlashItem[] {
	return listTemplates(app).map((f) => ({
		id: `template:${f.path}`, name: f.basename, icon: 'file-text', aliases: ['template'], hint: 'template', kind: 'block',
		run: (a, editor) => { void insertTemplateFile(a, editor, f, a.workspace.getActiveFile()?.basename ?? ''); },
	}));
}

/** The template commands. */
export function registerTemplates(app: App, add: (c: Command) => unknown): void {
	add({
		id: 'templates:insert', name: 'Insert template…', icon: 'file-input', section: 'Edit', aliases: ['Template', 'Use a template'],
		editorCallback: (editor: Editor) => new TemplatePicker(app, (f) => { void insertTemplateFile(app, editor, f, app.workspace.getActiveFile()?.basename ?? ''); }).open(),
	});
	add({
		id: 'templates:new-note', name: 'New note from template…', icon: 'file-plus', section: 'Notes', aliases: ['Create note from template'],
		run: () => new TemplatePicker(app, (template) => {
			const folder = app.fileManager.getNewFileParent(app.workspace.getActiveFile()?.path ?? '');
			const content = async (title: string) => fillTemplate(await app.vault.cachedRead(template), { title, now: new Date() });
			new NewNoteModal(app, folder, notePlaces(app, String(app.config.archiveFolder || 'Archive')), { title: `New note from ${template.basename}`, content }).open();
		}).open(),
	});
	add({
		id: 'templates:save', name: 'Save as template…', icon: 'file-output', section: 'Edit', aliases: ['Make a template', 'New template'],
		editorCallback: (editor: Editor) => {
			const text = editor.getSelection() || editor.getValue();
			const initial = editor.getSelection() ? '' : app.workspace.getActiveFile()?.basename ?? '';
			new NameModal(app, 'Save as template', initial, 'Save', (name) => { void saveTemplate(app, name, text); }).open();
		},
	});
}

async function saveTemplate(app: App, name: string, text: string): Promise<void> {
	const clean = name.trim().replace(/\.md$/i, '');
	if (!clean) return;
	if (/[\\/:]/.test(clean)) { new Notice('A name cannot contain / \\ or :'); return; }
	const folder = templatesFolder(app);
	if (!app.vault.getFolderByPath(folder)) await app.vault.createFolder(folder);
	const path = `${folder}/${clean}.md`;
	const existing = app.vault.getFileByPath(path);
	if (existing) await app.vault.modify(existing, text);
	else await app.vault.create(path, text);
	new Notice(`Saved the template "${clean}". Type / or use "Insert template…" to use it.`);
}
