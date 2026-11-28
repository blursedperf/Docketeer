/**
 * The layout a new homebase starts with. Legal: nothing to write (the panels as they come). Generic: its panels
 * (see genericPanels) in `.quire/panels.json`. A template: its panels there, and the folders its panels show. A folder
 * that already has a panels file keeps it, and then nothing is written or made.
 *
 * Kept free of Electron so it can be tested with plain Node.
 */
import { existsSync } from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { type HomebaseLayout, genericPanels, parsePanelsConfig, safeFolders } from '../renderer/docket/panels-model';

/** A saved template, as the page sends it: its panels file's text, and folders to make. */
export interface TemplateLayout { panels: unknown; folders?: unknown }

export async function applyHomebaseLayout(dir: string, layout: HomebaseLayout | TemplateLayout): Promise<boolean> {
	if (layout !== 'generic' && (!layout || typeof layout !== 'object')) return false;
	const file = path.join(dir, '.quire', 'panels.json');
	if (existsSync(file)) return false;
	const template = typeof layout === 'object' ? layout : null;
	// The page's panels are read again here, so only what Caselore understands is written.
	const panels = template ? parsePanelsConfig(typeof template.panels === 'string' ? template.panels : '') : genericPanels();
	await fsp.mkdir(path.dirname(file), { recursive: true });
	await fsp.writeFile(file, JSON.stringify(panels, null, '\t'));
	for (const f of template ? safeFolders(template.folders) : []) {
		const abs = path.resolve(dir, f);
		if (abs.startsWith(path.resolve(dir) + path.sep)) await fsp.mkdir(abs, { recursive: true });
	}
	return true;
}
