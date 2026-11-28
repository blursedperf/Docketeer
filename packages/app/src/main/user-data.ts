/**
 * The app was called Quire, then Docketeer, before it was renamed Caselore. Electron names its user-data folder
 * after the app, so the app-wide settings (recent homebases, the last one open, app-wide hotkeys) are copied
 * across from the newest old folder that has them, on the first launch after the rename. Old folders are left
 * as they were.
 *
 * Kept free of Electron so it can be tested with plain Node.
 */
import { existsSync } from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';

/** The user-data folder's earlier names, newest first. */
export const LEGACY_APP_NAMES = ['Docketeer', 'Quire'];
/** The app-wide settings file in the user-data folder. */
export const CONFIG_NAME = 'quire.json';

/**
 * Copy the settings into `newDir` from the first of `oldDirs` that has them, when `newDir` has none; returns
 * whether it copied.
 */
export async function migrateUserData(oldDirs: string[], newDir: string): Promise<boolean> {
	const to = path.join(newDir, CONFIG_NAME);
	if (existsSync(to)) return false;
	const oldDir = oldDirs.find((d) => path.resolve(d) !== path.resolve(newDir) && existsSync(path.join(d, CONFIG_NAME)));
	if (!oldDir) return false;
	await fsp.mkdir(newDir, { recursive: true });
	await fsp.copyFile(path.join(oldDir, CONFIG_NAME), to, fsp.constants.COPYFILE_EXCL);
	return true;
}
