/**
 * Cite (Mod+4): build a citation and insert it as a footnote at the cursor. The form follows the style's
 * fields; the preview shows what will go in, and whether it will be the full citation, Ibid, or a later
 * reference with "(n X)", worked out from the footnotes already in the note. Enter in any field inserts;
 * Esc goes back to the list of kinds. The AGLC4 plugin's tools (problems, bibliography, page preview)
 * are listed too.
 */
import { type App, CITATION_STYLES, type CitationStyle, type DocketPanel, type Source, type SourceKind, footnoteChanges, planCitation } from '@quire/api';
import type { Docket } from '../docket';
import { currentNote, empty, row, section } from './common';

const PLUGIN_TOOLS: [string, string][] = [
	['aglc-citations:insert-footnote', 'Insert a footnote (with suggestions as you type)'],
	['aglc-citations:show-issues', 'List citation problems'],
	['aglc-citations:fix-all', 'Fix all fixable problems'],
	['aglc-citations:tidy-footnotes', 'Tidy footnotes'],
	['aglc-citations:insert-bibliography', 'Insert a bibliography'],
	['aglc-citations:page-preview', 'Page preview'],
];

export interface CitePanel extends DocketPanel { prefill(s: Source): void }

export function citePanel(app: App, docket: Docket): CitePanel {
	let kind: SourceKind | null = null;
	let values: Record<string, string> = {};
	let pin = '';
	/** Put the keyboard in the form on the next draw (after choosing a kind), not every time it is shown. */
	let focusForm = false;
	const style = (): CitationStyle => CITATION_STYLES[String(app.config.citationStyle)] ?? CITATION_STYLES.aglc4!;

	const panel: CitePanel = {
		id: 'core:cite', title: 'Cite', icon: 'quote', order: 4, source: 'core',
		prefill(s) {
			kind = s.kind;
			values = { ...s.fields };
			pin = '';
			focusForm = true;
			docket.showPanel('core:cite');
		},
		render: async (el) => {
			const st = style();
			const note = await currentNote(app, docket);
			if (!kind) {
				const sec = section(el, `New citation · ${st.name}`);
				for (const k of st.kinds) row(sec, docket, k.label, () => { kind = k.id; values = {}; pin = ''; focusForm = true; void docket.refreshPanel(); }, { icon: 'plus' });
				const tools = PLUGIN_TOOLS.map(([id, label]) => [app.commands.findCommand(id), label] as const).filter(([c]) => c && app.commands.isAvailable(c));
				if (tools.length) {
					const ts = section(el, 'AGLC4 tools');
					for (const [c, label] of tools) row(ts, docket, label, () => { docket.close(); app.commands.executeCommand(c!); }, { icon: c!.icon ?? 'terminal' });
				}
				return;
			}
			const def = st.kinds.find((k) => k.id === kind)!;
			if (!note?.cm) empty(el, 'Open a note in editing view to insert a citation.');
			const form = el.createEl('form', { cls: 'docket-form', attr: { 'data-docket-form': '', 'aria-label': `${def.label} citation` } });
			form.createDiv({ cls: 'docket-section-title', text: `${def.label} · Enter inserts · Esc goes back` });
			const grid = form.createDiv({ cls: 'docket-form-grid' });
			const preview = form.createDiv({ cls: 'docket-preview', attr: { 'aria-live': 'polite' } });
			const source = (): Source => ({ kind: kind!, fields: values });

			const update = () => {
				preview.empty();
				const missing = st.missing(source());
				const plan = note ? planCitation(st, note.cm ? note.cm.state.doc.toString() : note.text, note.cm ? note.cm.state.selection.main.head : note.text.length, source(), pin) : { form: 'full' as const, body: st.full(source(), pin) };
				const form = plan.form === 'ibid' ? 'Ibid (the footnote before cites the same source)' : plan.form === 'subsequent' ? `Later reference (first cited in footnote ${'n' in plan ? plan.n : ''})` : 'Full citation';
				preview.createDiv({ cls: 'docket-preview-kind', text: form });
				const text = preview.createDiv({ cls: 'docket-preview-text' });
				// Show the Markdown with *italics* as italics.
				for (const [i, part] of plan.body.split('*').entries()) (i % 2 ? text.createEl('em', { text: part }) : text.appendText(part));
				if (missing.length) preview.createDiv({ cls: 'docket-preview-missing', text: `Still needed: ${missing.join(', ')}` });
			};

			const field = (id: string, label: string, opts: { placeholder?: string; options?: string[]; value: string; set: (v: string) => void }) => {
				const wrap = grid.createEl('label', { cls: 'docket-field' });
				wrap.createSpan({ cls: 'docket-field-label', text: label });
				let input: HTMLInputElement | HTMLSelectElement;
				if (opts.options) {
					input = wrap.createEl('select', { attr: { name: id } });
					input.createEl('option', { text: '—', attr: { value: '' } });
					for (const o of opts.options) input.createEl('option', { text: o, attr: { value: o } });
				} else {
					input = wrap.createEl('input', { attr: { type: 'text', name: id, placeholder: opts.placeholder ?? '', autocomplete: 'off', spellcheck: 'false' } });
				}
				input.value = opts.value;
				input.addEventListener('input', () => { opts.set(input.value); update(); });
				input.addEventListener('change', () => { opts.set(input.value); update(); });
				return input;
			};
			let first: HTMLElement | null = null;
			for (const f of def.fields) {
				const input = field(f.id, `${f.label}${f.required ? ' *' : ''}`, { placeholder: f.placeholder, options: f.options, value: values[f.id] ?? '', set: (v) => { values[f.id] = v; } });
				first ??= input;
			}
			field('pinpoint', `Pinpoint (${def.pinpoint})`, { value: pin, set: (v) => { pin = v; } });
			update();

			form.addEventListener('submit', (e) => e.preventDefault());
			form.addEventListener('keydown', (e) => {
				if (e.key === 'Escape') {
					e.preventDefault();
					e.stopPropagation();
					kind = null;
					void docket.refreshPanel(0);
					return;
				}
				if (e.key !== 'Enter' || e.isComposing) return;
				e.preventDefault();
				e.stopPropagation();
				const missing = st.missing(source());
				if (missing.length) { preview.querySelector('.docket-preview-missing')?.addClass('is-flash'); return; }
				const cm = note?.cm;
				if (!cm) return;
				const text = cm.state.doc.toString();
				const at = cm.state.selection.main.head;
				const plan = planCitation(st, text, at, source(), pin);
				const { label, changes } = footnoteChanges(text, at, plan.body);
				docket.close();
				cm.dispatch({ changes, selection: { anchor: at + `[^${label}]`.length }, scrollIntoView: true });
				cm.focus();
				kind = null;
			});
			if (focusForm) { focusForm = false; window.setTimeout(() => first?.focus(), 0); }
		},
	};
	return panel;
}
