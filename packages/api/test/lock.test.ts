import { describe, expect, it } from 'vitest';
import { SealError, changePassphrase, createLock, isSealed, normaliseRecoveryKey, open, recover, seal, unlockWithPassphrase } from '../src/lock/crypto';

// Few iterations in tests (the real count is 600,000); the code path is the same.
const IT = 1000;

describe('locking: keys', () => {
	it('sets up with a passphrase and a recovery key, and unlocks with the right passphrase only', async () => {
		const { lock, key, recoveryKey } = await createLock('correct horse', IT);
		expect(recoveryKey).toMatch(/^([A-Z2-9]{5}-){7}[A-Z2-9]{5}$/);
		expect(JSON.stringify(lock)).not.toContain('correct horse');
		const sealed = await seal(key, 'secret');
		const again = await unlockWithPassphrase(lock, 'correct horse');
		expect(again).not.toBeNull();
		expect(await open(again!, sealed)).toBe('secret');
		expect(await unlockWithPassphrase(lock, 'wrong')).toBeNull();
	});
	it('recovers with the recovery key (typed loosely) and sets a new passphrase', async () => {
		const { lock, key, recoveryKey } = await createLock('first', IT);
		const sealed = await seal(key, 'kept');
		const typed = recoveryKey.toLowerCase().replace(/-/g, ' ');
		expect(normaliseRecoveryKey(typed)).toBe(recoveryKey);
		const r = await recover(lock, typed, 'second');
		expect(r).not.toBeNull();
		expect(await open(r!.key, sealed)).toBe('kept');
		expect(await unlockWithPassphrase(r!.lock, 'second')).not.toBeNull();
		expect(await unlockWithPassphrase(r!.lock, 'first')).toBeNull();
		expect(await recover(lock, 'AAAAA-AAAAA-AAAAA-AAAAA-AAAAA-AAAAA-AAAAA-AAAAA', 'x')).toBeNull();
	});
	it('changes the passphrase only with the old one', async () => {
		const { lock } = await createLock('old', IT);
		expect(await changePassphrase(lock, 'nope', 'new')).toBeNull();
		const next = (await changePassphrase(lock, 'old', 'new'))!;
		expect(await unlockWithPassphrase(next, 'new')).not.toBeNull();
	});
});

describe('locking: sealed notes', () => {
	it('seals with a readable header, no plaintext, and a fresh IV each time', async () => {
		const { key } = await createLock('p', IT);
		const a = await seal(key, '# Client: Jane Example\n\nPrivileged.');
		const b = await seal(key, '# Client: Jane Example\n\nPrivileged.');
		expect(isSealed(a)).toBe(true);
		expect(a).toContain('This note is encrypted by Docketeer');
		expect(a).not.toContain('Jane');
		expect(a).not.toBe(b);
		expect(isSealed('# Plain note')).toBe(false);
	});
	it('refuses another homebase\'s key and altered files', async () => {
		const one = await createLock('p', IT);
		const two = await createLock('p', IT);
		const sealed = await seal(one.key, 'text');
		await expect(open(two.key, sealed)).rejects.toBeInstanceOf(SealError);
		const i = sealed.indexOf('v1\n') + 3;
		const tampered = sealed.slice(0, i) + (sealed[i] === 'A' ? 'B' : 'A') + sealed.slice(i + 1);
		await expect(open(one.key, tampered)).rejects.toBeInstanceOf(SealError);
	});
});
