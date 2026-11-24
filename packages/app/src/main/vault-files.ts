/**
 * Serving homebase files over quire://app/vault/: pictures, PDFs, audio, video and captions. Files are
 * streamed from disk (lecture recordings run to gigabytes) and byte ranges are honoured, which media
 * elements need in order to seek. Everything else in the homebase (notes, scripts, HTML) is refused: the
 * page reads notes through the fs bridge, never as URLs.
 *
 * Kept free of Electron so it can be tested with plain Node.
 */
import { createReadStream } from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { Readable } from 'node:stream';

/** File types served from the homebase, by extension. */
export const VAULT_TYPES: Readonly<Record<string, string>> = {
	// Pictures
	'.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
	'.bmp': 'image/bmp', '.avif': 'image/avif', '.svg': 'image/svg+xml',
	// Documents
	'.pdf': 'application/pdf',
	// Video
	'.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm', '.ogv': 'video/ogg', '.mov': 'video/quicktime',
	// Audio
	'.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.ogg': 'audio/ogg', '.oga': 'audio/ogg',
	'.opus': 'audio/ogg', '.wav': 'audio/wav', '.flac': 'audio/flac',
	// Captions, for <track>
	'.vtt': 'text/vtt; charset=utf-8',
};

/** The content type for a homebase path, or null if it is not served. */
export function vaultType(rel: string): string | null {
	return VAULT_TYPES[path.extname(rel).toLowerCase()] ?? null;
}

export type ByteRange = { start: number; end: number };

/**
 * Parse a Range header against a file of `size` bytes.
 * - null: no usable range, serve the whole file (no header, another unit, or several ranges);
 * - 'unsatisfiable': a byte range that lies wholly outside the file (answer 416);
 * - otherwise the inclusive range to send, clamped to the file.
 */
export function parseRange(header: string | null | undefined, size: number): ByteRange | 'unsatisfiable' | null {
	if (!header) return null;
	const m = /^\s*bytes\s*=\s*(\d*)\s*-\s*(\d*)\s*$/i.exec(header);
	if (!m) return null; // other units, malformed, or a list of ranges: the whole file is a valid answer
	const [, a, b] = m as unknown as [string, string, string];
	if (a === '' && b === '') return null;
	if (a === '') {
		// Suffix: the last N bytes.
		const n = Number(b);
		if (n === 0 || size === 0) return 'unsatisfiable';
		return { start: Math.max(0, size - n), end: size - 1 };
	}
	const start = Number(a);
	const end = b === '' ? size - 1 : Math.min(Number(b), size - 1);
	if (b !== '' && Number(b) < start) return null; // invalid: ignore it
	if (start >= size) return 'unsatisfiable';
	return { start, end };
}

/** Stream a homebase file of a served type, honouring Range. `abs` must already be checked to lie in the homebase. */
export async function serveVaultFile(abs: string, req: { method?: string; headers: { get(name: string): string | null } }): Promise<Response> {
	const type = vaultType(abs);
	if (!type) return new Response('Forbidden', { status: 403 });
	let size: number;
	try {
		const st = await fsp.stat(abs);
		if (!st.isFile()) return new Response('Not found', { status: 404 });
		size = st.size;
	} catch {
		return new Response('Not found', { status: 404 });
	}
	const headers: Record<string, string> = {
		'content-type': type,
		'accept-ranges': 'bytes',
		'x-content-type-options': 'nosniff',
		'cache-control': 'no-store',
		// Never a document that can run anything, should it be opened as a page.
		'content-security-policy': "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox",
	};
	const range = parseRange(req.headers.get('range'), size);
	if (range === 'unsatisfiable') {
		return new Response(null, { status: 416, headers: { ...headers, 'content-range': `bytes */${size}` } });
	}
	const { start, end } = range ?? { start: 0, end: size - 1 };
	const length = size === 0 ? 0 : end - start + 1;
	headers['content-length'] = String(length);
	if (range) headers['content-range'] = `bytes ${start}-${end}/${size}`;
	const status = range ? 206 : 200;
	if (req.method === 'HEAD' || length === 0) return new Response(null, { status, headers });
	const body = Readable.toWeb(createReadStream(abs, { start, end })) as unknown as ReadableStream<Uint8Array>;
	return new Response(body, { status, headers });
}
