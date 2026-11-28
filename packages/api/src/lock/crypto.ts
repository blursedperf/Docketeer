/**
 * The cryptography for locked notes, on the platform's Web Crypto (no dependency, works offline):
 * PBKDF2-SHA-256 turns a passphrase (or the recovery key) into a key that wraps a random AES-256-GCM
 * homebase key; notes are sealed with that key in an envelope that other apps show as a short message.
 * Pure (no files), so it is unit-tested. See docs/docket/locking.md.
 */

const subtle = () => globalThis.crypto.subtle;
/** Bytes backed by a plain ArrayBuffer (what Web Crypto accepts). */
type Bytes = Uint8Array<ArrayBuffer>;
const random = (n: number): Bytes => globalThis.crypto.getRandomValues(new Uint8Array(n));

export const PBKDF2_ITERATIONS = 600_000;

export interface Wrapped { salt: string; iv: string; data: string }
export interface LockFile {
	version: 1;
	kdf: { name: 'PBKDF2'; hash: 'SHA-256'; iterations: number };
	passphrase: Wrapped;
	recovery: Wrapped;
	/** Folders whose notes are all locked, new ones included. */
	folders: string[];
}

export function toBase64(b: Uint8Array): string {
	let s = '';
	for (const x of b) s += String.fromCharCode(x);
	return btoa(s);
}

export function fromBase64(s: string): Bytes {
	const bin = atob(s.replace(/\s+/g, ''));
	const out = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
	return out;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

async function deriveKey(secret: string, salt: Bytes, iterations: number): Promise<CryptoKey> {
	const base = await subtle().importKey('raw', enc.encode(secret.normalize('NFC')), 'PBKDF2', false, ['deriveKey']);
	return subtle().deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

async function wrap(raw: Bytes, secret: string, iterations: number): Promise<Wrapped> {
	const salt = random(16);
	const iv = random(12);
	const kek = await deriveKey(secret, salt, iterations);
	const data = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv }, kek, raw));
	return { salt: toBase64(salt), iv: toBase64(iv), data: toBase64(data) };
}

/** The raw homebase key, or null if `secret` is wrong (the authentication check fails). */
async function unwrap(w: Wrapped, secret: string, iterations: number): Promise<Bytes | null> {
	try {
		const kek = await deriveKey(secret, fromBase64(w.salt), iterations);
		return new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv: fromBase64(w.iv) }, kek, fromBase64(w.data)));
	} catch {
		return null;
	}
}

const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I

/** 200 random bits as eight groups of five letters and digits ("K7QX2-…"); 32 symbols, 5 bits each. */
export function newRecoveryKey(): string {
	const chars = [...random(40)].map((b) => RECOVERY_ALPHABET[b % 32]!).join('');
	return chars.match(/.{5}/g)!.join('-');
}

/** A recovery key as typed: case, spaces and dashes do not matter. */
export function normaliseRecoveryKey(s: string): string {
	const c = s.toUpperCase().replace(/[\s-]+/g, '');
	return c.match(/.{1,5}/g)?.join('-') ?? '';
}

/** A new lock file and its key: from a passphrase; the recovery key is returned to show once. */
export async function createLock(passphrase: string, iterations = PBKDF2_ITERATIONS): Promise<{ lock: LockFile; key: CryptoKey; recoveryKey: string }> {
	const raw = random(32);
	const recoveryKey = newRecoveryKey();
	const lock: LockFile = {
		version: 1,
		kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations },
		passphrase: await wrap(raw, passphrase, iterations),
		recovery: await wrap(raw, recoveryKey, iterations),
		folders: [],
	};
	const key = await importKey(raw);
	raw.fill(0);
	return { lock, key, recoveryKey };
}

async function importKey(raw: Bytes): Promise<CryptoKey> {
	return subtle().importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

/** The homebase key from the passphrase, or null when it is wrong. */
export async function unlockWithPassphrase(lock: LockFile, passphrase: string): Promise<CryptoKey | null> {
	const raw = await unwrap(lock.passphrase, passphrase, lock.kdf.iterations);
	if (!raw) return null;
	const key = await importKey(raw);
	raw.fill(0);
	return key;
}

/** With the recovery key: the key, and a lock file re-wrapped for a new passphrase. Null when it is wrong. */
export async function recover(lock: LockFile, recoveryKey: string, newPassphrase: string): Promise<{ lock: LockFile; key: CryptoKey } | null> {
	const raw = await unwrap(lock.recovery, normaliseRecoveryKey(recoveryKey), lock.kdf.iterations);
	if (!raw) return null;
	const next: LockFile = { ...lock, passphrase: await wrap(raw, newPassphrase, lock.kdf.iterations) };
	const key = await importKey(raw);
	raw.fill(0);
	return { lock: next, key };
}

/** A new passphrase (the old one must be right). Null when the old one is wrong. */
export async function changePassphrase(lock: LockFile, oldPassphrase: string, newPassphrase: string): Promise<LockFile | null> {
	const raw = await unwrap(lock.passphrase, oldPassphrase, lock.kdf.iterations);
	if (!raw) return null;
	const next: LockFile = { ...lock, passphrase: await wrap(raw, newPassphrase, lock.kdf.iterations) };
	raw.fill(0);
	return next;
}

// -------------------------------------------------------------------------------------------------
// Sealed notes

const ENVELOPE_START = '<!-- quire-encrypted v1\n';
const ENVELOPE_END = '\n-->';
const HEADER = '---\nquire-locked: 1\n---\nThis note is encrypted by Caselore. Open it in Caselore to read it.\n\n';

/** Whether a note's text on disk is sealed (cheap: looks at the start). */
export function isSealed(text: string): boolean {
	return text.startsWith('---\nquire-locked: 1\n---\n') && text.includes(ENVELOPE_START);
}

/** Seal a note's text: the readable header, then the IV and ciphertext. */
export async function seal(key: CryptoKey, plain: string): Promise<string> {
	const iv = random(12);
	const data = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode('quire-note-v1') }, key, enc.encode(plain)));
	const both: Bytes = new Uint8Array(iv.length + data.length);
	both.set(iv);
	both.set(data, iv.length);
	const b64 = toBase64(both).match(/.{1,76}/g)!.join('\n');
	return `${HEADER}${ENVELOPE_START}${b64}${ENVELOPE_END}\n`;
}

export class SealError extends Error {}

/** The note's text, or a SealError when the key is not this homebase's or the file was altered. */
export async function open(key: CryptoKey, sealed: string): Promise<string> {
	const start = sealed.indexOf(ENVELOPE_START);
	const end = sealed.indexOf(ENVELOPE_END, start);
	if (start < 0 || end < 0) throw new SealError('Not a sealed note');
	const both = fromBase64(sealed.slice(start + ENVELOPE_START.length, end));
	try {
		const plain = await subtle().decrypt({ name: 'AES-GCM', iv: both.slice(0, 12), additionalData: enc.encode('quire-note-v1') }, key, both.slice(12));
		return dec.decode(plain);
	} catch {
		throw new SealError('This locked note cannot be opened with this homebase\'s key, or it was changed outside Caselore.');
	}
}
