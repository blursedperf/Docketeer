/**
 * A generated homebase for performance checks: law-school notes in subject and topic folders, with
 * headings, tags, links and footnotes. Deterministic (seeded), so timings compare from run to run. The
 * text is made up from a word list; it is not legal content.
 *
 *   import { makeFixture } from './fixture.mjs'; makeFixture(10000) → [{ path, text }]
 *   node scripts/fixture.mjs <folder> [count]       writes the notes to <folder>
 */
const SUBJECTS = ['Torts', 'Contracts', 'Criminal Law', 'Constitutional Law', 'Property', 'Equity', 'Administrative Law', 'Evidence', 'Civil Procedure', 'Corporations'];
const TOPICS = ['Introduction', 'Duty', 'Breach', 'Causation', 'Remedies', 'Defences', 'Formation', 'Terms', 'Interpretation', 'Jurisdiction', 'Procedure', 'Review', 'Trusts', 'Estoppel'];
const WORDS = ('the court held that a duty of care arises where harm is reasonably foreseeable and the relationship is sufficiently proximate '
	+ 'negligence requires breach causation and damage the plaintiff must prove each element on the balance of probabilities '
	+ 'a contract is formed by offer acceptance consideration and an intention to create legal relations terms may be express or implied '
	+ 'the legislation confers power on the minister subject to procedural fairness and the decision may be reviewed for jurisdictional error '
	+ 'equity intervenes where it would be unconscionable for a party to insist on strict legal rights estoppel trust fiduciary obligation '
	+ 'the evidence was admissible because its probative value outweighed the danger of unfair prejudice hearsay tendency coincidence '
	+ 'the High Court distinguished the earlier authority and applied the principle in a later appeal ratio obiter dissent majority judgment '
	+ 'statutory interpretation begins with the text read in context and purpose extrinsic material may be considered').split(' ');
const PARTIES = ['Smith', 'Jones', 'Brown', 'Nguyen', 'Patel', 'Wilson', 'Taylor', 'Chen', 'Kelly', 'Murphy', 'Commonwealth', 'Queensland', 'Victoria', 'Minister for Immigration'];

function rng(seed) {
	let s = seed >>> 0;
	return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export function makeFixture(count = 10000, seed = 42) {
	const r = rng(seed);
	const pick = (a) => a[Math.floor(r() * a.length)];
	const sentence = (n) => { const w = []; for (let i = 0; i < n; i++) w.push(pick(WORDS)); const s = w.join(' '); return s.charAt(0).toUpperCase() + s.slice(1) + '.'; };
	const notes = [];
	const names = new Set();
	for (let i = 0; i < count; i++) {
		const subject = SUBJECTS[i % SUBJECTS.length];
		const topic = TOPICS[Math.floor(i / SUBJECTS.length) % TOPICS.length];
		const kase = `${pick(PARTIES)} v ${pick(PARTIES)}`;
		let name = `${kase} ${i}`;
		if (names.has(name)) name = `${name} b`;
		names.add(name);
		const year = 1950 + Math.floor(r() * 74);
		const lines = ['---', `tags: [${subject.toLowerCase().replace(/ /g, '-')}, ${topic.toLowerCase()}]`, '---', '', `# ${kase}`, '', `*${kase}* [${year}] HCA ${1 + Math.floor(r() * 60)}.`, ''];
		for (const h of ['Facts', 'Issues', 'Held', 'Ratio']) {
			lines.push(`## ${h}`, '');
			for (let p = 0; p < 2; p++) lines.push(`${sentence(12 + Math.floor(r() * 18))} ${sentence(10 + Math.floor(r() * 15))}`, '');
		}
		if (i > 0) lines.push(`See also [[${notes[Math.floor(r() * notes.length)].name}]].[^1]`, '', `[^1]: ${kase} (${year}) ${100 + Math.floor(r() * 200)} CLR ${1 + Math.floor(r() * 600)}.`, '');
		notes.push({ name, path: `${subject}/${topic}/${name}.md`, text: lines.join('\n') });
	}
	return notes.map(({ path, text }) => ({ path, text }));
}

if (import.meta.url === `file://${process.argv[1]}`) {
	const [dir, n] = process.argv.slice(2);
	if (!dir) { console.error('Usage: node scripts/fixture.mjs <folder> [count]'); process.exit(1); }
	const { mkdirSync, writeFileSync } = await import('node:fs');
	const { join, dirname } = await import('node:path');
	const notes = makeFixture(Number(n) || 10000);
	for (const note of notes) { mkdirSync(dirname(join(dir, note.path)), { recursive: true }); writeFileSync(join(dir, note.path), note.text); }
	console.log(`Wrote ${notes.length} notes to ${dir}`);
}
