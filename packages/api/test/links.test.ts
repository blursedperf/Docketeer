import { ensureSyntaxTree } from '@codemirror/language';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { realLinkRanges } from '../src/cm-setup';

function links(doc: string): string[] {
	const state = EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage })] });
	ensureSyntaxTree(state, state.doc.length, 5000);
	return realLinkRanges(state).map((r) => doc.slice(r.from, r.to));
}

describe('which [brackets] are links', () => {
	it('citations are not: years, pinpoints, medium neutral citations', () => {
		expect(links('*Donoghue v Stevenson* [1932] AC 562, 580.')).toEqual([]);
		expect(links('*Mabo v Queensland [No 2]* (1992) 175 CLR 1, 15 [78].')).toEqual([]);
		expect(links('*Sullivan v Moody* [2001] HCA 59, [42]–[45].')).toEqual([]);
	});
	it('links with a URL are', () => {
		expect(links('See [the Act](https://example.org/act) and ![map](map.png).')).toEqual(['[the Act](https://example.org/act)', '![map](map.png)']);
	});
	it('reference links are when their label is defined, in any case', () => {
		const doc = 'See [the report] and [a summary][Report] but not [1932].\n\n[the report]: https://example.org/r\n[report]: https://example.org/r';
		expect(links(doc)).toEqual(['[the report]', '[a summary][Report]']);
	});
	it('footnotes and wikilinks are left to their own styles', () => {
		expect(links('A claim.[^1] See [[Duty of care]].\n\n[^1]: *Donoghue v Stevenson* [1932] AC 562.')).toEqual([]);
	});
});
