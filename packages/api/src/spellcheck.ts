/**
 * Offline spellcheck. Hunspell dictionaries (SCOWL: English, Australian, British and US) ship with the
 * app and are read on demand; checking runs here with nspell, so nothing goes online. Words are marked
 * in the visible part of the editor, skipping code, links, web addresses, frontmatter and (unless turned
 * on) footnotes, where citations would be flagged throughout.
 */
import { syntaxTree } from '@codemirror/language';
import { type Extension, StateEffect } from '@codemirror/state';
import { Decoration, type DecorationSet, type EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import nspell from 'nspell';
import type { App } from './app';
import { Events } from './events';
import { LEGAL_WORDS } from './legal-words';

export const SPELL_LANGUAGES: Record<string, string> = {
	'en-AU': 'English (Australia)',
	'en-GB': 'English (United Kingdom)',
	'en-US': 'English (United States)',
};

/** Ask every editor to recheck (after a language change or a word added). */
export const spellRefresh = StateEffect.define<null>();

type Checker = ReturnType<typeof nspell>;

export class Spellchecker extends Events {
	private checker: Checker | null = null;
	private loadedLang: string | null = null;
	private personal = new Set<string>();
	private ignored = new Set<string>();
	private cache = new Map<string, boolean>();
	private loading: Promise<void> | null = null;

	constructor(private app: App) {
		super();
	}

	get ready(): boolean { return this.checker !== null; }
	get language(): string | null { return this.loadedLang; }
	private get personalPath(): string { return `${this.app.vault.configDir}/dictionary.txt`; }

	/** Load the dictionary for `lang` (and the personal dictionary); editors recheck when done. */
	load(lang: string, force = false): Promise<void> {
		if (!force && lang === this.loadedLang && this.checker) return Promise.resolve();
		const run = async () => {
			const dict = await this.app.host.app.dictionary(lang);
			if (!dict) throw new Error(`No dictionary for ${lang}`);
			const checker = nspell(dict.aff, dict.dic);
			await this.readPersonal();
			for (const w of this.personal) checker.add(w);
			if (this.app.vault.getConfig('spellcheckLegal') !== false) for (const w of LEGAL_WORDS) checker.add(w);
			this.checker = checker;
			this.loadedLang = lang;
			this.cache.clear();
			this.refreshEditors();
			this.trigger('loaded', lang);
		};
		this.loading = (this.loading ?? Promise.resolve()).then(run, run);
		return this.loading;
	}

	private async readPersonal(): Promise<void> {
		this.personal.clear();
		try {
			if (await this.app.vault.adapter.exists(this.personalPath)) {
				for (const w of (await this.app.vault.adapter.read(this.personalPath)).split(/\r?\n/)) if (w.trim()) this.personal.add(w.trim());
			}
		} catch (e) {
			console.error('Could not read the personal dictionary', e);
		}
	}

	/** Words added to the personal dictionary. */
	personalWords(): string[] {
		return [...this.personal].sort((a, b) => a.localeCompare(b));
	}

	/** Replace the personal dictionary (from the settings page). */
	async setPersonalWords(words: string[]): Promise<void> {
		this.personal = new Set(words.map((w) => w.trim()).filter(Boolean));
		await this.app.vault.adapter.write(this.personalPath, `${this.personalWords().join('\n')}\n`);
		const lang = this.loadedLang;
		this.checker = null;
		this.loadedLang = null;
		if (lang) await this.load(lang);
	}

	/** True when `word` is spelled correctly (or not checked yet). */
	check(word: string): boolean {
		if (!this.checker || this.ignored.has(word)) return true;
		let ok = this.cache.get(word);
		if (ok === undefined) {
			ok = this.checker.correct(word) || this.checker.correct(word.replace(/’/g, "'"));
			this.cache.set(word, ok);
		}
		return ok;
	}

	suggest(word: string): string[] {
		return this.checker ? this.checker.suggest(word.replace(/’/g, "'")).slice(0, 6) : [];
	}

	async addWord(word: string): Promise<void> {
		this.personal.add(word);
		this.checker?.add(word);
		this.cache.delete(word);
		await this.app.vault.adapter.write(this.personalPath, `${this.personalWords().join('\n')}\n`);
		this.refreshEditors();
	}

	/** Leave a word alone until Quire restarts. */
	ignore(word: string): void {
		this.ignored.add(word);
		this.refreshEditors();
	}

	refreshEditors(): void {
		this.app.workspace?.iterateAllLeaves((l) => {
			const cm = (l.view as { editor?: { cm?: EditorView } }).editor?.cm;
			cm?.dispatch({ effects: spellRefresh.of(null) });
		});
	}
}

const WORD = /[\p{L}][\p{L}\p{M}'’]*[\p{L}\p{M}]|[\p{L}]/gu;
const misspelled = Decoration.mark({ class: 'cm-misspelled' });
const SKIP_NODES = new Set(['InlineCode', 'FencedCode', 'CodeBlock', 'URL', 'Frontmatter', 'HTMLTag', 'HTMLBlock', 'Autolink', 'CodeText', 'LinkLabel']);

/** Offsets not to check in a line: code, links, web addresses, footnotes (unless on), comments' markers. */
function skipRanges(view: EditorView, from: number, to: number, text: string, footnotes: boolean): [number, number][] {
	const skip: [number, number][] = [];
	syntaxTree(view.state).iterate({
		from,
		to,
		enter: (n) => {
			if (SKIP_NODES.has(n.name)) { skip.push([n.from, n.to]); return false; }
			return undefined;
		},
	});
	const re = /\[\[[^\]\n]*\]\]|\bhttps?:\/\/\S+|\bwww\.\S+|\S+@\S+\.\S+|%%|==|\[\^[^\]\n]*\]/g;
	for (const m of text.matchAll(re)) skip.push([from + m.index, from + m.index + m[0].length]);
	if (!footnotes) {
		// Footnote definitions ("[^1]: …" to the end of the line) and inline footnotes (^[…]).
		for (const m of text.matchAll(/^ {0,3}\[\^[^\]\n]+\]:.*$/gm)) skip.push([from + m.index, from + m.index + m[0].length]);
		for (const m of text.matchAll(/\^\[[^\]\n]*\]/g)) skip.push([from + m.index, from + m.index + m[0].length]);
	}
	return skip;
}

function build(view: EditorView, checker: Spellchecker, footnotes: boolean): DecorationSet {
	if (!checker.ready) return Decoration.none;
	const ranges = [];
	const head = view.state.selection.main.head;
	for (const { from, to } of view.visibleRanges) {
		const text = view.state.doc.sliceString(from, to);
		const skip = skipRanges(view, from, to, text, footnotes);
		for (const m of text.matchAll(WORD)) {
			const a = from + m.index;
			const b = a + m[0].length;
			const word = m[0].replace(/['’]+$/, '');
			if (word.length < 2 || /^\p{Lu}+$/u.test(word)) continue;
			if (head >= a && head <= b) continue; // the word being typed
			if (skip.some(([s, e]) => a < e && b > s)) continue;
			if (!checker.check(word)) ranges.push(misspelled.range(a, a + word.length));
		}
	}
	return Decoration.set(ranges, true);
}

/** Mark misspellings in an editor. */
export function spellcheckExtension(checker: Spellchecker, footnotes: () => boolean): Extension {
	return ViewPlugin.fromClass(class {
		decorations: DecorationSet;
		constructor(view: EditorView) { this.decorations = build(view, checker, footnotes()); }
		update(u: ViewUpdate) {
			const refresh = u.transactions.some((t) => t.effects.some((e) => e.is(spellRefresh)));
			if (u.docChanged || u.viewportChanged || u.selectionSet || refresh) this.decorations = build(u.view, checker, footnotes());
		}
	}, { decorations: (v) => v.decorations });
}

/** The word at `pos` in the editor, with its range. */
export function wordAt(view: EditorView, pos: number): { word: string; from: number; to: number } | null {
	const line = view.state.doc.lineAt(pos);
	for (const m of line.text.matchAll(WORD)) {
		const from = line.from + m.index;
		const word = m[0].replace(/['’]+$/, '');
		const to = from + word.length;
		if (pos >= from && pos <= to) return { word, from, to };
	}
	return null;
}
