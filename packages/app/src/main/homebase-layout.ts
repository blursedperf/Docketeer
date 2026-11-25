/**
 * The layout a new homebase starts with. Legal: nothing to write (the panels as they come). Generic: its panels
 * (see genericPanels) in `.quire/panels.json`, unless the folder already has one, which is left as it is.
 *
 * Kept free of Electron so it can be tested with plain Node.
 */
import { existsSync } from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { type HomebaseLayout, genericPanels } from '../renderer/docket/panels-model';

export async function applyHomebaseLayout(dir: string, layout: HomebaseLayout): Promise<boolean> {
	if (layout !== 'generic') return false;
	const file = path.join(dir, '.quire', 'panels.json');
	if (existsSync(file)) return false;
	await fsp.mkdir(path.dirname(file), { recursive: true });
	await fsp.writeFile(file, JSON.stringify(genericPanels(), null, '\t'));
	return true;
}
