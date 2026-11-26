/**
 * Installing the example homebase (built into dist/example-homebase) where the user can find it: a folder
 * "Docketeer example" in their Documents. A copy made earlier is opened again as it is, with the user's changes;
 * a folder of that name that is not the example is left alone and the next free name used. A "Quire example"
 * made before the app was renamed is opened again too.
 *
 * Kept free of Electron so it can be tested with plain Node.
 */
import { existsSync } from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';

export const EXAMPLE_NAME = 'Docketeer example';
/** The example's folder from before the rename to Docketeer. */
export const LEGACY_EXAMPLE_NAME = 'Quire example';
/** The file that marks a folder as Docketeer's example homebase. */
export const EXAMPLE_MARKER = path.join('.quire', 'example.json');

/** Copy the example from `source` into `parent` (unless a copy is there already); returns its folder. */
export async function installExample(source: string, parent: string): Promise<string> {
	if (!existsSync(path.join(source, EXAMPLE_MARKER))) throw new Error('The example homebase is missing from this installation');
	const legacy = path.join(parent, LEGACY_EXAMPLE_NAME);
	if (existsSync(path.join(legacy, EXAMPLE_MARKER)) && !existsSync(path.join(parent, EXAMPLE_NAME, EXAMPLE_MARKER))) return legacy;
	for (let n = 1; n <= 99; n++) {
		const dest = path.join(parent, n === 1 ? EXAMPLE_NAME : `${EXAMPLE_NAME} ${n}`);
		if (existsSync(dest)) {
			if (existsSync(path.join(dest, EXAMPLE_MARKER))) return dest;
			continue;
		}
		await fsp.mkdir(parent, { recursive: true });
		await fsp.cp(source, dest, { recursive: true, errorOnExist: true, force: false });
		return dest;
	}
	throw new Error(`Too many folders called "${EXAMPLE_NAME}"`);
}
