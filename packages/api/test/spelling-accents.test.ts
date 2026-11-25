import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import nspell from 'nspell';
import { describe, expect, it } from 'vitest';
import { Spellchecker, withoutAccents } from '../src/spellcheck';

const dir = join(__dirname, '..', '..', '..', 'node_modules', 'dictionary-en-au');
const dictionary = nspell(readFileSync(join(dir, 'index.aff'), 'utf8'), readFileSync(join(dir, 'index.dic'), 'utf8'));

function checker(): Spellchecker {
	const s = new Spellchecker({} as never);
	(s as unknown as { checker: unknown }).checker = dictionary;
	return s;
}

describe('accented words', () => {
	it('folds accents and other marks away', () => {
		expect(withoutAccents('café')).toBe('cafe');
		expect(withoutAccents('café')).toBe('cafe');
		expect(withoutAccents('naïve rôle résumé')).toBe('naive role resume');
	});
	it('accepts the accented spelling of a word the dictionary has plain', () => {
		expect(dictionary.correct('café')).toBe(false);
		const s = checker();
		for (const w of ['café', 'café', 'naïve', 'rôle', 'cafés']) expect(s.check(w), w).toBe(true);
	});
	it('still marks misspelt words, accented or not', () => {
		const s = checker();
		for (const w of ['negligance', 'négligance', 'cafféé']) expect(s.check(w), w).toBe(false);
	});
	it('does not judge which accent a word takes (the trade-off: "cafè" passes as "cafe")', () => {
		expect(checker().check('cafè')).toBe(true);
	});
});
