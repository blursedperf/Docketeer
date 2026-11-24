import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { parseRange, serveVaultFile, vaultType } from '../src/main/vault-files';

describe('vaultType', () => {
	it('serves pictures, PDFs, audio, video and captions', () => {
		expect(vaultType('attachments/Brief.PNG')).toBe('image/png');
		expect(vaultType('Readings/Mabo v Queensland (No 2).pdf')).toBe('application/pdf');
		expect(vaultType('Lectures/Week 3.mp4')).toBe('video/mp4');
		expect(vaultType('Lectures/Week 3.webm')).toBe('video/webm');
		expect(vaultType('Lectures/Week 3.m4a')).toBe('audio/mp4');
		expect(vaultType('Lectures/Week 3.vtt')).toBe('text/vtt; charset=utf-8');
	});
	it('refuses notes, pages, scripts and unknown files', () => {
		for (const p of ['Note.md', 'page.html', 'x.htm', 'evil.js', 'data.json', 'keys', 'Week 3.srt', '.quire/lock.json']) {
			expect(vaultType(p), p).toBeNull();
		}
	});
});

describe('parseRange', () => {
	const size = 1000;
	it('no header, or one it does not handle, means the whole file', () => {
		expect(parseRange(null, size)).toBeNull();
		expect(parseRange('', size)).toBeNull();
		expect(parseRange('items=0-5', size)).toBeNull();
		expect(parseRange('bytes=0-1,5-9', size)).toBeNull();
		expect(parseRange('bytes=-', size)).toBeNull();
		expect(parseRange('bytes=9-3', size)).toBeNull();
	});
	it('reads start-end, open-ended and suffix ranges', () => {
		expect(parseRange('bytes=0-99', size)).toEqual({ start: 0, end: 99 });
		expect(parseRange('bytes=500-', size)).toEqual({ start: 500, end: 999 });
		expect(parseRange('bytes=-100', size)).toEqual({ start: 900, end: 999 });
		expect(parseRange('Bytes = 10 - 20', size)).toEqual({ start: 10, end: 20 });
	});
	it('clamps ranges that run past the end', () => {
		expect(parseRange('bytes=990-5000', size)).toEqual({ start: 990, end: 999 });
		expect(parseRange('bytes=-5000', size)).toEqual({ start: 0, end: 999 });
	});
	it('a range wholly outside the file is unsatisfiable', () => {
		expect(parseRange('bytes=1000-', size)).toBe('unsatisfiable');
		expect(parseRange('bytes=-0', size)).toBe('unsatisfiable');
		expect(parseRange('bytes=0-', 0)).toBe('unsatisfiable');
	});
});

describe('serveVaultFile', () => {
	const dir = mkdtempSync(join(tmpdir(), 'quire-vault-files-'));
	afterAll(() => rmSync(dir, { recursive: true, force: true }));
	const bytes = Buffer.from(Array.from({ length: 256 }, (_, i) => i));
	const video = join(dir, 'Week 3.mp4');
	writeFileSync(video, bytes);
	writeFileSync(join(dir, 'Note.md'), '# secret');
	const req = (range?: string, method = 'GET') => ({ method, headers: new Headers(range ? { range } : {}) });

	it('sends the whole file with its type and says ranges are accepted', async () => {
		const res = await serveVaultFile(video, req());
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toBe('video/mp4');
		expect(res.headers.get('accept-ranges')).toBe('bytes');
		expect(res.headers.get('content-length')).toBe('256');
		expect(Buffer.from(await res.arrayBuffer())).toEqual(bytes);
	});
	it('sends a byte range as 206 Partial Content', async () => {
		const res = await serveVaultFile(video, req('bytes=16-31'));
		expect(res.status).toBe(206);
		expect(res.headers.get('content-range')).toBe('bytes 16-31/256');
		expect(res.headers.get('content-length')).toBe('16');
		expect(Buffer.from(await res.arrayBuffer())).toEqual(bytes.subarray(16, 32));
	});
	it('sends the tail for an open-ended range (a seek near the end)', async () => {
		const res = await serveVaultFile(video, req('bytes=250-'));
		expect(res.status).toBe(206);
		expect(Buffer.from(await res.arrayBuffer())).toEqual(bytes.subarray(250));
	});
	it('answers 416 for a range past the end', async () => {
		const res = await serveVaultFile(video, req('bytes=256-'));
		expect(res.status).toBe(416);
		expect(res.headers.get('content-range')).toBe('bytes */256');
	});
	it('HEAD sends headers only', async () => {
		const res = await serveVaultFile(video, req(undefined, 'HEAD'));
		expect(res.status).toBe(200);
		expect(res.headers.get('content-length')).toBe('256');
		expect(res.body).toBeNull();
	});
	it('refuses notes and missing files', async () => {
		expect((await serveVaultFile(join(dir, 'Note.md'), req())).status).toBe(403);
		expect((await serveVaultFile(join(dir, 'Gone.mp4'), req())).status).toBe(404);
		expect((await serveVaultFile(dir + '/sub.mp4', req())).status).toBe(404);
	});
	it('never serves something that could run as a page', async () => {
		const res = await serveVaultFile(video, req());
		expect(res.headers.get('x-content-type-options')).toBe('nosniff');
		expect(res.headers.get('content-security-policy')).toContain('sandbox');
	});
});
