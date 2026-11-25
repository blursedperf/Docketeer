/**
 * Your own Docket panels, and how all the panels are arranged: kept in `.quire/panels.json`.
 *
 *   {
 *     "panels": [
 *       { "id": "my-week", "title": "My week", "icon": "calendar",
 *         "elements": [
 *           { "type": "notes", "rule": { "kind": "tag", "tag": "week" } },
 *           { "type": "commands", "commands": ["app:new-note", "media:insert-timestamp"] },
 *           { "type": "files", "folder": "Torts" },
 *           { "type": "section", "panel": "core:outline" }
 *         ] }
 *     ],
 *     "order": ["core:units", "custom:my-week", "core:outline"],
 *     "hidden": ["core:cite"]
 *   }
 *
 * Pure (no app, no DOM): parsing and describing, tested on their own. custom-panels.ts draws and edits them.
 */

export type NoteRule =
	| { kind: 'folder'; folder: string }
	| { kind: 'tag'; tag: string }
	| { kind: 'recent' }
	| { kind: 'pinned' }
	| { kind: 'search'; query: string };

export type PanelElement =
	| { type: 'commands'; title?: string; commands: string[] }
	| { type: 'files'; title?: string; folder: string }
	| { type: 'notes'; title?: string; rule: NoteRule; limit?: number }
	| { type: 'section'; title?: string; panel: string };

export interface CustomPanel { id: string; title: string; icon?: string; elements: PanelElement[] }

export interface PanelsConfig { panels: CustomPanel[]; order: string[]; hidden: string[] }

/** The id a custom panel has in the Docket. */
export const panelId = (p: { id: string }): string => `custom:${p.id}`;

const str = (v: unknown): v is string => typeof v === 'string';

function parseRule(v: unknown): NoteRule | null {
	if (!v || typeof v !== 'object') return null;
	const r = v as Record<string, unknown>;
	switch (r.kind) {
		case 'folder': return str(r.folder) ? { kind: 'folder', folder: r.folder } : null;
		case 'tag': return str(r.tag) && r.tag.replace(/^#/, '') ? { kind: 'tag', tag: r.tag.replace(/^#/, '') } : null;
		case 'recent': return { kind: 'recent' };
		case 'pinned': return { kind: 'pinned' };
		case 'search': return str(r.query) && r.query.trim() ? { kind: 'search', query: r.query.trim() } : null;
		default: return null;
	}
}

function parseElement(v: unknown): PanelElement | null {
	if (!v || typeof v !== 'object') return null;
	const e = v as Record<string, unknown>;
	const title = str(e.title) && e.title.trim() ? { title: e.title.trim() } : {};
	switch (e.type) {
		case 'commands': return Array.isArray(e.commands) ? { type: 'commands', ...title, commands: e.commands.filter(str) } : null;
		case 'files': return { type: 'files', ...title, folder: str(e.folder) ? e.folder.replace(/^\/+|\/+$/g, '') : '' };
		case 'notes': {
			const rule = parseRule(e.rule);
			if (!rule) return null;
			const limit = typeof e.limit === 'number' && e.limit > 0 ? Math.floor(e.limit) : undefined;
			return { type: 'notes', ...title, rule, ...(limit ? { limit } : {}) };
		}
		case 'section': return str(e.panel) && !e.panel.startsWith('custom:') ? { type: 'section', ...title, panel: e.panel } : null;
		default: return null;
	}
}

/** Read the file's JSON. Anything not understood is left out rather than failing the rest. */
export function parsePanelsConfig(json: string): PanelsConfig {
	const out: PanelsConfig = { panels: [], order: [], hidden: [] };
	let data: unknown;
	try { data = JSON.parse(json); } catch { return out; }
	if (!data || typeof data !== 'object' || Array.isArray(data)) return out;
	const d = data as Record<string, unknown>;
	const seen = new Set<string>();
	for (const p of Array.isArray(d.panels) ? d.panels : []) {
		if (!p || typeof p !== 'object') continue;
		const q = p as Record<string, unknown>;
		if (!str(q.id) || !/^[a-z0-9][a-z0-9-]*$/.test(q.id) || seen.has(q.id) || !str(q.title) || !q.title.trim()) continue;
		seen.add(q.id);
		out.panels.push({
			id: q.id, title: q.title.trim(), ...(str(q.icon) && q.icon ? { icon: q.icon } : {}),
			elements: (Array.isArray(q.elements) ? q.elements : []).map(parseElement).filter((e): e is PanelElement => !!e),
		});
	}
	out.order = Array.isArray(d.order) ? [...new Set(d.order.filter(str))] : [];
	out.hidden = Array.isArray(d.hidden) ? [...new Set(d.hidden.filter(str))] : [];
	return out;
}

/** An id for a new panel called `title`, not already used. */
export function newPanelId(title: string, taken: string[]): string {
	const base = title.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'panel';
	let id = base;
	for (let n = 2; taken.includes(id); n++) id = `${base}-${n}`;
	return id;
}

/** What a note-list rule shows, in words ("Notes tagged #week"). */
export function describeRule(r: NoteRule): string {
	switch (r.kind) {
		case 'folder': return r.folder ? `Notes in ${r.folder.replace(/\//g, ' › ')}` : 'Notes at the top of the homebase';
		case 'tag': return `Notes tagged #${r.tag}`;
		case 'recent': return 'Recent notes';
		case 'pinned': return 'Pinned notes';
		case 'search': return `Notes matching “${r.query}”`;
	}
}

/** An element's heading in the panel: its own title, or one made from what it shows. */
export function elementHeading(e: PanelElement, panelTitle: (id: string) => string | null): string {
	if (e.title) return e.title;
	switch (e.type) {
		case 'commands': return 'Commands';
		case 'files': return e.folder ? e.folder.split('/').pop()! : 'Files';
		case 'notes': return describeRule(e.rule);
		case 'section': return panelTitle(e.panel) ?? e.panel;
	}
}

/** One line about an element, for the editor's list ("3 commands", "File tree: Torts"). */
export function describeElement(e: PanelElement, panelTitle: (id: string) => string | null): string {
	switch (e.type) {
		case 'commands': return `Commands: ${e.commands.length} ${e.commands.length === 1 ? 'command' : 'commands'}`;
		case 'files': return `File tree: ${e.folder ? e.folder.replace(/\//g, ' › ') : 'the whole homebase'}`;
		case 'notes': return `Note list: ${describeRule(e.rule)}${e.limit ? ` (up to ${e.limit})` : ''}`;
		case 'section': return `Section: ${panelTitle(e.panel) ?? e.panel}`;
	}
}

/** Move item `i` of `list` by `by` places (clamped); a new array. */
export function moveItem<T>(list: T[], i: number, by: number): T[] {
	const out = [...list];
	const j = Math.max(0, Math.min(out.length - 1, i + by));
	if (i < 0 || i >= out.length || i === j) return out;
	const [x] = out.splice(i, 1);
	out.splice(j, 0, x!);
	return out;
}

/** Layouts a new homebase can start with: Legal (the panels as they come) or Generic. */
export type HomebaseLayout = 'legal' | 'generic';

/**
 * The Generic layout: three panels, Files and Folders (the whole homebase as a tree), Homebase and Layout. The
 * others are hidden, not removed: "Arrange the Docket's panels" shows them again.
 */
export function genericPanels(): PanelsConfig {
	return {
		panels: [{ id: 'files-and-folders', title: 'Files and Folders', icon: 'folder-tree', elements: [{ type: 'files', folder: '' }] }],
		order: ['custom:files-and-folders', 'core:homebase', 'core:layout'],
		hidden: ['core:authorities', 'core:outline', 'core:units', 'core:cite'],
	};
}
