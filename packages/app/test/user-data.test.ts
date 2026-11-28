import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { CONFIG_NAME, LEGACY_APP_NAMES, migrateUserData } from '../src/main/user-data';

const tmp = mkdtempSync(join(tmpdir(), 'caselore-user-data-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

/** A user-data folder under an earlier name, holding `text` as its settings. */
function oldDir(name: string, app: string, text: string): string {
	const dir = join(tmp, name, app);
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, CONFIG_NAME), text);
	return dir;
}

/** The earlier user-data folders under `name`, newest first, as main.ts passes them. */
const oldDirs = (name: string) => LEGACY_APP_NAMES.map((app) => join(tmp, name, app));

describe('migrateUserData', () => {
	it('copies the settings from the Docketeer folder on the first launch, and leaves the old folder as it was', async () => {
		const old = oldDir('a', 'Docketeer', '{"recent":[{"path":"/notes"}]}');
		const now = join(tmp, 'a', 'Caselore');
		expect(await migrateUserData(oldDirs('a'), now)).toBe(true);
		expect(readFileSync(join(now, CONFIG_NAME), 'utf8')).toBe('{"recent":[{"path":"/notes"}]}');
		expect(readFileSync(join(old, CONFIG_NAME), 'utf8')).toBe('{"recent":[{"path":"/notes"}]}');
	});

	it('copies from the Quire folder when there was never a Docketeer one', async () => {
		oldDir('e', 'Quire', '{"last":"/quire"}');
		const now = join(tmp, 'e', 'Caselore');
		expect(await migrateUserData(oldDirs('e'), now)).toBe(true);
		expect(readFileSync(join(now, CONFIG_NAME), 'utf8')).toBe('{"last":"/quire"}');
	});

	it('prefers Docketeer\'s settings to older ones from Quire', async () => {
		oldDir('f', 'Quire', '{"last":"/quire"}');
		oldDir('f', 'Docketeer', '{"last":"/docketeer"}');
		const now = join(tmp, 'f', 'Caselore');
		expect(await migrateUserData(oldDirs('f'), now)).toBe(true);
		expect(readFileSync(join(now, CONFIG_NAME), 'utf8')).toBe('{"last":"/docketeer"}');
	});

	it('never replaces Caselore\'s own settings', async () => {
		oldDir('b', 'Docketeer', '{"last":"/old"}');
		const now = join(tmp, 'b', 'Caselore');
		mkdirSync(now, { recursive: true });
		writeFileSync(join(now, CONFIG_NAME), '{"last":"/new"}');
		expect(await migrateUserData(oldDirs('b'), now)).toBe(false);
		expect(readFileSync(join(now, CONFIG_NAME), 'utf8')).toBe('{"last":"/new"}');
	});

	it('does nothing when there was no earlier folder, or when it is the same folder', async () => {
		expect(await migrateUserData(oldDirs('c'), join(tmp, 'c', 'Caselore'))).toBe(false);
		const same = oldDir('d', 'Docketeer', '{}');
		expect(await migrateUserData([same], same)).toBe(false);
	});
});
