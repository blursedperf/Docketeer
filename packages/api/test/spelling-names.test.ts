import { Text } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { authorityWords, nameTokens, startsSentence } from '../src/spellcheck';

describe('names in notes', () => {
	it('takes the capitalised words of a name', () => {
		expect(nameTokens('Donoghue v Stevenson')).toEqual(['Donoghue', 'Stevenson']);
		expect(nameTokens('Wyong Shire Council v Shirt (sample)')).toEqual(['Wyong', 'Shire', 'Council', 'Shirt']);
		expect(nameTokens('Week 3 lecture')).toEqual(['Week']);
	});
	it('finds the parties and short titles of the authorities in a note', () => {
		const words = authorityWords(Text.of(['Breach: *Wyong Shire Council v Shirt* (1980) 146 CLR 40; *Sullivan v Moody* (2001) 207 CLR 562.']));
		for (const w of ['Wyong', 'Shirt', 'Sullivan', 'Moody']) expect(words.has(w), w).toBe(true);
	});
});

describe('the start of a sentence', () => {
	const at = (text: string, word: string) => startsSentence(text, text.indexOf(word));
	it('is the start of a line, after list, task, quote and heading marks', () => {
		expect(at('Thankerton agreed.', 'Thankerton')).toBe(true);
		expect(at('- Thankerton agreed.', 'Thankerton')).toBe(true);
		expect(at('1. Thankerton agreed.', 'Thankerton')).toBe(true);
		expect(at('- [ ] Thankerton agreed.', 'Thankerton')).toBe(true);
		expect(at('> Thankerton agreed.', 'Thankerton')).toBe(true);
		expect(at('## Thankerton', 'Thankerton')).toBe(true);
		expect(at('**Thankerton** agreed.', 'Thankerton')).toBe(true);
	});
	it('is after a full stop, question mark or colon, with quotes or brackets between', () => {
		expect(at('It was held. Thankerton agreed.', 'Thankerton')).toBe(true);
		expect(at('Held: Thankerton agreed.', 'Thankerton')).toBe(true);
		expect(at('It was held. "Thankerton agreed."', 'Thankerton')).toBe(true);
		expect(at('First line.\nThankerton agreed.', 'Thankerton')).toBe(true);
	});
	it('is not the middle of a sentence', () => {
		expect(at('Lords Atkin, Thankerton and Macmillan', 'Thankerton')).toBe(false);
		expect(at('Held, by Lord Thankerton', 'Thankerton')).toBe(false);
		expect(at('as in (Thankerton)', 'Thankerton')).toBe(false);
	});
});
