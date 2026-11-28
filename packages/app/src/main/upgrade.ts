/**
 * Caselore is upgraded by hand: people download the new version and replace the old app. So the first launch of
 * a new version does the upgrade's work itself: it keeps a copy of the app-wide settings from before, records the
 * version, and tells the page so it can say what changed. Opening an older copy after a newer one is noticed too,
 * and the newer version's record is kept. Notes are never touched here: they live in the user's own homebases.
 *
 * Kept free of Electron so it can be tested with plain Node.
 */
import { existsSync } from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { compareVersions } from '../renderer/changelog';
import { CONFIG_NAME } from './user-data';

export { compareVersions };

/** The folder in the user-data folder that holds copies of the settings from before each upgrade. */
export const BACKUPS_DIR = 'Backups';
/** How many copies are kept; older ones are removed. */
export const BACKUPS_KEPT = 5;

/** What this launch is: the first ever, the same version as last time, a newer one, or an older one. */
export interface LaunchCheck {
	kind: 'first' | 'same' | 'upgrade' | 'downgrade';
	/** The version that ran last (left out when the settings came from a version before this was recorded). */
	from?: string;
	/** The copy of the settings made before this launch changed anything. */
	backup?: string;
	/** The settings should be saved: `lastRunVersion` changed. */
	save: boolean;
}

/**
 * Check this launch against the settings in `dir` (already read into `config`, which this updates). `hadSettings`
 * is whether the settings file existed before the app read it.
 */
export async function checkLaunch(dir: string, config: Record<string, unknown>, appVersion: string, hadSettings: boolean): Promise<LaunchCheck> {
	const last = typeof config.lastRunVersion === 'string' ? config.lastRunVersion : undefined;
	if (!hadSettings) {
		config.lastRunVersion = appVersion;
		return { kind: 'first', save: true };
	}
	const order = last ? compareVersions(appVersion, last) : 1;
	if (order === 0) return { kind: 'same', from: last, save: false };
	const backup = await backUpSettings(dir, last ? `${last}` : 'earlier', order < 0 ? `opened-in-${appVersion}` : undefined);
	if (order < 0) return { kind: 'downgrade', from: last, backup, save: false };
	config.lastRunVersion = appVersion;
	return { kind: 'upgrade', from: last, backup, save: true };
}

/** Copy the settings file into Backups/ as "quire-<version>.json", then keep only the newest copies. */
async function backUpSettings(dir: string, version: string, note?: string): Promise<string | undefined> {
	const from = path.join(dir, CONFIG_NAME);
	if (!existsSync(from)) return undefined;
	const backups = path.join(dir, BACKUPS_DIR);
	await fsp.mkdir(backups, { recursive: true });
	const safe = (s: string) => s.replace(/[^\w.-]+/g, '_');
	let to = path.join(backups, `quire-${safe(version)}${note ? `-${safe(note)}` : ''}.json`);
	for (let n = 2; existsSync(to); n++) to = to.replace(/(?: \(\d+\))?\.json$/, ` (${n}).json`);
	await fsp.copyFile(from, to, fsp.constants.COPYFILE_EXCL);
	// The copy's time is when it was made (macOS keeps the original's when it clones a file).
	const now = new Date();
	await fsp.utimes(to, now, now);
	const files = [];
	for (const name of await fsp.readdir(backups)) {
		if (!/^quire-.*\.json$/.test(name)) continue;
		const p = path.join(backups, name);
		files.push({ p, version: name.slice('quire-'.length, -'.json'.length), time: (await fsp.stat(p)).mtimeMs });
	}
	// Newest first; copies made in the same moment go by version.
	files.sort((a, b) => b.time - a.time || compareVersions(b.version, a.version));
	for (const f of files.slice(BACKUPS_KEPT)) await fsp.rm(f.p, { force: true });
	return to;
}
