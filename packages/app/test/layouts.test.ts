import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { applyHomebaseLayout } from '../src/main/homebase-layout';
import { genericPanels, parsePanelsConfig } from '../src/renderer/docket/panels-model';
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
