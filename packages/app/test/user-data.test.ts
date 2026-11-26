import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { CONFIG_NAME, migrateUserData } from '../src/main/user-data';

const tmp = mkdtempSync(join(tmpdir(), 'docketeer-user-data-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function quireDir(name: string, text: string): string {
	const dir = join(tmp, name, 'Quire');
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, CONFIG_NAME), text);
	return dir;
}

describe('migrateUserData', () => {
	it('copies the settings from the Quire folder on the first launch, and leaves the old folder as it was', async () => {
		const old = quireDir('a', '{"recent":[{"path":"/notes"}]}');
		const now = join(tmp, 'a', 'Docketeer');
		expect(await migrateUserData(old, now)).toBe(true);
		expect(readFileSync(join(now, CONFIG_NAME), 'utf8')).toBe('{"recent":[{"path":"/notes"}]}');
		expect(readFileSync(join(old, CONFIG_NAME), 'utf8')).toBe('{"recent":[{"path":"/notes"}]}');
	});

	it('never replaces Docketeer\'s own settings', async () => {
		const old = quireDir('b', '{"last":"/old"}');
		const now = join(tmp, 'b', 'Docketeer');
		mkdirSync(now, { recursive: true });
		writeFileSync(join(now, CONFIG_NAME), '{"last":"/new"}');
		expect(await migrateUserData(old, now)).toBe(false);
		expect(readFileSync(join(now, CONFIG_NAME), 'utf8')).toBe('{"last":"/new"}');
	});

	it('does nothing when there was no Quire, or when both are the same folder', async () => {
		expect(await migrateUserData(join(tmp, 'c', 'Quire'), join(tmp, 'c', 'Docketeer'))).toBe(false);
		const same = quireDir('d', '{}');
		expect(await migrateUserData(same, same)).toBe(false);
	});
});
