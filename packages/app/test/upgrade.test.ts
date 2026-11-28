import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { BACKUPS_DIR, BACKUPS_KEPT, checkLaunch, compareVersions } from '../src/main/upgrade';
import { CONFIG_NAME } from '../src/main/user-data';
import { changesSince, parseChangelog } from '../src/renderer/changelog';

const tmp = mkdtempSync(join(tmpdir(), 'caselore-upgrade-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

/** A user-data folder holding `config` as its settings (none when it is null). */
function userData(name: string, config: Record<string, unknown> | null): string {
	const dir = join(tmp, name);
	mkdirSync(dir, { recursive: true });
	if (config) writeFileSync(join(dir, CONFIG_NAME), JSON.stringify(config));
	return dir;
}

describe('compareVersions', () => {
	it('orders by number, not text', () => {
		expect(compareVersions('0.10.0', '0.9.9')).toBe(1);
		expect(compareVersions('0.25.4', '0.25.4')).toBe(0);
		expect(compareVersions('v1.0.0', '1.0.1')).toBe(-1);
		expect(compareVersions('1.0.0-beta.1', '1.0.0')).toBe(-1);
	});
});

describe('checkLaunch', () => {
	it('records the version on a first launch, with no backup', async () => {
		const dir = userData('first', null);
		const config: Record<string, unknown> = {};
		expect(await checkLaunch(dir, config, '0.26.0', false)).toEqual({ kind: 'first', save: true });
		expect(config.lastRunVersion).toBe('0.26.0');
		expect(existsSync(join(dir, BACKUPS_DIR))).toBe(false);
	});

	it('does nothing when the same version runs again', async () => {
		const config = { lastRunVersion: '0.26.0' };
		const dir = userData('same', config);
		expect(await checkLaunch(dir, config, '0.26.0', true)).toEqual({ kind: 'same', from: '0.26.0', save: false });
		expect(existsSync(join(dir, BACKUPS_DIR))).toBe(false);
	});

	it('backs up the settings before an upgrade and records the new version', async () => {
		const config: Record<string, unknown> = { lastRunVersion: '0.25.4', last: '/notes' };
		const dir = userData('upgrade', config);
		const r = await checkLaunch(dir, config, '0.26.0', true);
		expect(r).toMatchObject({ kind: 'upgrade', from: '0.25.4', save: true });
		expect(r.backup).toBe(join(dir, BACKUPS_DIR, 'quire-0.25.4.json'));
		expect(JSON.parse(readFileSync(r.backup!, 'utf8'))).toEqual({ lastRunVersion: '0.25.4', last: '/notes' });
		expect(config.lastRunVersion).toBe('0.26.0');
	});

	it('treats settings from before versions were recorded as an upgrade', async () => {
		const config: Record<string, unknown> = { recent: [] };
		const dir = userData('unrecorded', config);
		const r = await checkLaunch(dir, config, '0.26.0', true);
		expect(r).toMatchObject({ kind: 'upgrade', save: true });
		expect(r.from).toBeUndefined();
		expect(r.backup).toBe(join(dir, BACKUPS_DIR, 'quire-earlier.json'));
	});

	it('keeps the newer version recorded when an older copy opens', async () => {
		const config: Record<string, unknown> = { lastRunVersion: '0.27.0' };
		const dir = userData('downgrade', config);
		const r = await checkLaunch(dir, config, '0.26.0', true);
		expect(r).toMatchObject({ kind: 'downgrade', from: '0.27.0', save: false });
		expect(r.backup).toBe(join(dir, BACKUPS_DIR, 'quire-0.27.0-opened-in-0.26.0.json'));
		expect(config.lastRunVersion).toBe('0.27.0');
	});

	it('keeps only the newest backups', async () => {
		const dir = userData('many', {});
		for (let i = 0; i < BACKUPS_KEPT + 3; i++) {
			const config: Record<string, unknown> = { lastRunVersion: `0.${i}.0` };
			writeFileSync(join(dir, CONFIG_NAME), JSON.stringify(config));
			await checkLaunch(dir, config, `0.${i + 1}.0`, true);
		}
		expect(readdirSync(join(dir, BACKUPS_DIR)).length).toBe(BACKUPS_KEPT);
	});
});

describe('changelog', () => {
	const text = [
		'# Changelog', '',
		'## Unreleased', '',
		'- **Coming next**', '',
		'## v0.26.0', '', '- **Newest**', '',
		'## v0.25.4', '', '- **Middle**', '',
		'## v0.25.3', '', '- **Oldest**', '',
	].join('\n');
	const sections = parseChangelog(text);

	it('reads each version section, newest first', () => {
		expect(sections.map((s) => s.version)).toEqual(['Unreleased', '0.26.0', '0.25.4', '0.25.3']);
		expect(sections[1]!.body).toBe('- **Newest**');
	});

	it('leaves out an empty Unreleased section', () => {
		expect(parseChangelog('## Unreleased\n\n## v1.0.0\n\n- **One**\n').map((s) => s.version)).toEqual(['1.0.0']);
	});

	it('lists what is new since the last version run', () => {
		const released = sections.filter((s) => s.version !== 'Unreleased');
		expect(changesSince(released, '0.26.0', '0.25.3').map((s) => s.version)).toEqual(['0.26.0', '0.25.4']);
		expect(changesSince(released, '0.26.0').map((s) => s.version)).toEqual(['0.26.0']);
		expect(changesSince(released, '0.25.4', '0.25.3').map((s) => s.version)).toEqual(['0.25.4']);
	});
});
