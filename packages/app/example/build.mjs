/**
 * The example homebase: the notes in ./homebase, plus a sample recording and a sample reading made here, so
 * no audio or PDF is kept in the repository. build.mjs writes it to dist/example-homebase; Caselore copies it
 * into the user's Documents when they ask for it (src/main/example.ts).
 */
import { cp, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const EXAMPLE_SOURCE = join(here, 'homebase');

/** The sample lecture: quiet, with a soft chime at each timestamp the notes link to. 8 kHz, 8-bit mono WAV. */
export function lectureWav(seconds = 80, chimes = [20, 45, 65]) {
	const rate = 8000;
	const n = rate * seconds;
	const buf = Buffer.alloc(44 + n);
	buf.write('RIFF', 0); buf.writeUInt32LE(36 + n, 4); buf.write('WAVE', 8); buf.write('fmt ', 12);
	buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(rate, 24);
	buf.writeUInt32LE(rate, 28); buf.writeUInt16LE(1, 32); buf.writeUInt16LE(8, 34); buf.write('data', 36); buf.writeUInt32LE(n, 40);
	buf.fill(128, 44);
	for (const at of chimes) {
		const start = at * rate;
		const len = Math.floor(rate * 0.6);
		for (let i = 0; i < len && start + i < n; i++) {
			const t = i / rate;
			const v = Math.sin(2 * Math.PI * 880 * t) * Math.exp(-t * 6) * 40 + Math.sin(2 * Math.PI * 1320 * t) * Math.exp(-t * 9) * 15;
			buf[44 + start + i] = Math.max(0, Math.min(255, Math.round(128 + v)));
		}
	}
	return buf;
}

/** Text for the sample reading, page by page: an explanation written for the example, not a real report. */
export const READING = [
	[
		'Sample reading for the Caselore example homebase',
		'The neighbour principle',
		'',
		'[1] The neighbour principle states a reason for a duty of care rather than a rule',
		'that decides each case. It asks whether harm to the plaintiff was reasonably',
		'foreseeable, and whether the parties were so closely and directly connected that',
		'the defendant ought to have had the plaintiff in mind.',
		'',
		'[2] Its first use was to explain why a manufacturer owes a duty to the person who',
		'ends up using its product, even without a contract between them.',
	],
	[
		'[3] Later courts tried to turn the principle into a general test for every new',
		'kind of case. Each attempt was criticised as too broad or too vague.',
		'',
		'[4] Australian courts have declined to adopt a single test for novel cases.',
		'Instead they look at the salient features of the relationship: foreseeability,',
		'control, vulnerability, and coherence with the rest of the law.',
	],
	[
		'[5] In a problem question, begin with the settled categories. Only where the',
		'facts fall outside them is it necessary to weigh the salient features.',
		'',
		'[6] Whatever the approach, foreseeability of harm remains necessary, though it',
		'is never enough on its own.',
	],
];

/** A small PDF: Helvetica text, pages labelled from `firstLabel` (so links show the printed page). */
export function readingPdf(pages = READING, firstLabel = 101) {
	const esc = (s) => s.replace(/[\\()]/g, (c) => `\\${c}`);
	const objs = [];
	const ids = pages.map((_, i) => 4 + i * 2);
	objs[1] = `<< /Type /Catalog /Pages 2 0 R /PageLabels << /Nums [0 << /S /D /St ${firstLabel} >>] >> >>`;
	objs[2] = `<< /Type /Pages /Kids [${ids.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`;
	objs[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
	pages.forEach((lines, i) => {
		const body = lines.map((l, j) => `${j === 0 ? '' : 'T* '}(${esc(l)}) Tj`).join('\n');
		const footer = `BT /F1 10 Tf 290 40 Td (${firstLabel + i}) Tj ET`;
		const stream = `BT /F1 12 Tf 16 TL 72 720 Td\n${body}\nET\n${footer}`;
		objs[4 + i * 2] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`;
		objs[5 + i * 2] = `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`;
	});
	let out = '%PDF-1.4\n';
	const offsets = [];
	for (let id = 1; id < objs.length; id++) { offsets[id] = Buffer.byteLength(out); out += `${id} 0 obj\n${objs[id]}\nendobj\n`; }
	const xref = Buffer.byteLength(out);
	out += `xref\n0 ${objs.length}\n0000000000 65535 f \n${offsets.slice(1).map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
	out += `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
	return Buffer.from(out, 'latin1');
}

/** Write the whole example homebase to `out` (which must not exist yet, or be empty). */
export async function buildExample(out) {
	await mkdir(out, { recursive: true });
	await cp(EXAMPLE_SOURCE, out, { recursive: true });
	await writeFile(join(out, 'Torts', 'Negligence', 'Week 3 lecture.wav'), lectureWav());
	await writeFile(join(out, 'Torts', 'Readings', 'The neighbour principle (sample reading).pdf'), readingPdf());
}
