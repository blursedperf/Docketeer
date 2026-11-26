/**
 * The app was called Quire before it was renamed Docketeer. Electron names its user-data folder after the
 * app, so the app-wide settings (recent homebases, the last one open, app-wide hotkeys) are copied across from
 * the old folder on the first launch after the rename. The old folder is left as it was.
 *
 * Kept free of Electron so it can be tested with plain Node.
 */
import { existsSync } from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';

/** The user-data folder's name before the rename. */
export const LEGACY_APP_NAME = 'Quire';
/** The app-wide settings file in the user-data folder. */
export const CONFIG_NAME = 'quire.json';

/** Copy the settings from `oldDir` into `newDir` when `newDir` has none; returns whether it copied. */
export async function migrateUserData(oldDir: string, newDir: string): Promise<boolean> {
	const from = path.join(oldDir, CONFIG_NAME);
	const to = path.join(newDir, CONFIG_NAME);
	if (path.resolve(oldDir) === path.resolve(newDir) || existsSync(to) || !existsSync(from)) return false;
	await fsp.mkdir(newDir, { recursive: true });
	await fsp.copyFile(from, to, fsp.constants.COPYFILE_EXCL);
	return true;
}
