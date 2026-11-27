import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { applyHomebaseLayout } from '../src/main/homebase-layout';
import { type PanelsConfig, describeTemplate, genericPanels, parsePanelsConfig, parseTemplates, safeFolders, templateFolders, withTemplate } from '../src/renderer/docket/panels-model';
import { moveTarget } from '../src/renderer/docket/drag-paths';

const tmp = mkdtempSync(join(tmpdir(), 'quire-layout-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe('homebase layouts', () => {
	it('Generic: Files and Folders, Homebase and Layout, the rest hidden; it reads back as written', () => {
		const g = genericPanels();
		expect(g.order).toEqual(['custom:files-and-folders', 'core:homebase', 'core:layout']);
		expect(g.hidden.sort()).toEqual(['core:authorities', 'core:cite', 'core:outline', 'core:units']);
		expect(parsePanelsConfig(JSON.stringify(g))).toEqual(g);
	});
	it('writes the Generic panels into a new homebase, never over panels already there; Legal writes nothing', async () => {
		const generic = join(tmp, 'generic');
		mkdirSync(generic);
		expect(await applyHomebaseLayout(generic, 'generic')).toBe(true);
		expect(parsePanelsConfig(readFileSync(join(generic, '.quire', 'panels.json'), 'utf8'))).toEqual(genericPanels());
		const own = join(tmp, 'own');
		mkdirSync(join(own, '.quire'), { recursive: true });
		writeFileSync(join(own, '.quire', 'panels.json'), '{"hidden":["core:cite"]}');
		expect(await applyHomebaseLayout(own, 'generic')).toBe(false);
		expect(readFileSync(join(own, '.quire', 'panels.json'), 'utf8')).toBe('{"hidden":["core:cite"]}');
		const legal = join(tmp, 'legal');
		mkdirSync(legal);
		expect(await applyHomebaseLayout(legal, 'legal')).toBe(false);
		expect(existsSync(join(legal, '.quire'))).toBe(false);
	});
});

const week: PanelsConfig = {
	panels: [
		{ id: 'week', title: 'My week', elements: [{ type: 'files', folder: 'Torts/Cases' }, { type: 'notes', rule: { kind: 'folder', folder: 'Contracts' } }, { type: 'notes', rule: { kind: 'tag', tag: 'week' } }] },
		{ id: 'all', title: 'Everything', elements: [{ type: 'files', folder: '' }, { type: 'files', folder: 'Torts/Cases' }] },
	],
	order: ['custom:week', 'core:outline'],
	hidden: ['core:cite', 'core:units'],
};

describe('homebase templates', () => {
	it('reads the setting, leaving out what it does not understand and later names that repeat', () => {
		const list = parseTemplates([{ name: ' Semester ', panels: week }, { name: 'semester', panels: {} }, { name: '' }, null, 'x', { name: 'Bare' }]);
		expect(list.map((t) => t.name)).toEqual(['Semester', 'Bare']);
		expect(list[0]!.panels).toEqual(week);
		expect(list[1]!.panels).toEqual({ panels: [], order: [], hidden: [] });
		expect(parseTemplates(undefined)).toEqual([]);
	});
	it('replaces a template of the same name where it was, or adds one at the end', () => {
		const a = { name: 'A', panels: genericPanels() };
		const b = { name: 'B', panels: week };
		expect(withTemplate([a, b], { name: 'a', panels: week }).map((t) => [t.name, t.panels === week])).toEqual([['a', true], ['B', true]]);
		expect(withTemplate([a], b).map((t) => t.name)).toEqual(['A', 'B']);
	});
	it("makes the folders its panels show, once each, and only safe ones", () => {
		expect(templateFolders(week)).toEqual(['Torts/Cases', 'Contracts']);
		expect(templateFolders(genericPanels())).toEqual([]);
		expect(safeFolders(['Torts', '/abs', '../up', 'a/../b', '.quire', 'a/.hidden', 'C:\\x', 'a\\b', ' ', 'Torts', 'Week/', 3])).toEqual(['Torts', 'Week']);
	});
	it('says what a template holds', () => {
		expect(describeTemplate({ name: 'S', panels: week })).toBe('Your panels: My week, Everything · 2 hidden · makes 2 folders');
		expect(describeTemplate({ name: 'L', panels: { panels: [], order: [], hidden: [] } })).toBe('The built-in panels');
	});
	it("writes a template's panels and folders into a new homebase, never over panels already there", async () => {
		const dir = join(tmp, 'template');
		mkdirSync(dir);
		expect(await applyHomebaseLayout(dir, { panels: JSON.stringify({ ...week, extra: 1 }), folders: ['Torts/Cases', 'Contracts', '../outside', '.quire/x'] })).toBe(true);
		expect(parsePanelsConfig(readFileSync(join(dir, '.quire', 'panels.json'), 'utf8'))).toEqual(week);
		expect(existsSync(join(dir, 'Torts', 'Cases')) && existsSync(join(dir, 'Contracts'))).toBe(true);
		expect(existsSync(join(tmp, 'outside')) || existsSync(join(dir, '.quire', 'x'))).toBe(false);
		const own = join(tmp, 'own-template');
		mkdirSync(join(own, '.quire'), { recursive: true });
		writeFileSync(join(own, '.quire', 'panels.json'), '{}');
		expect(await applyHomebaseLayout(own, { panels: JSON.stringify(week), folders: ['Torts'] })).toBe(false);
		expect(existsSync(join(own, 'Torts'))).toBe(false);
		expect(await applyHomebaseLayout(join(tmp, 'none'), null as never)).toBe(false);
	});
});

describe('dropping files and folders', () => {
	it('moves into the folder dropped on, or to the top', () => {
		expect(moveTarget('Week 3.md', false, 'Torts')).toEqual({ to: 'Torts/Week 3.md' });
		expect(moveTarget('Torts/Week 3.md', false, '')).toEqual({ to: 'Week 3.md' });
		expect(moveTarget('Torts/Negligence', true, 'Contracts')).toEqual({ to: 'Contracts/Negligence' });
	});
	it('does nothing where it already is, and refuses a folder into itself', () => {
		expect(moveTarget('Torts/Week 3.md', false, 'Torts')).toBeNull();
		expect(moveTarget('Torts', true, 'Torts')).toEqual({ refuse: 'A folder cannot go inside itself.' });
		expect(moveTarget('Torts', true, 'Torts/Negligence')).toEqual({ refuse: 'A folder cannot go inside itself.' });
		expect(moveTarget('Torts', true, 'Torts two')).toEqual({ to: 'Torts two/Torts' });
	});
});
