/**
 * Outline (Mod+2): the open note's headings. Enter jumps; Alt+↑/↓ moves a section with everything under
 * it; Alt+←/→ promotes or demotes a heading with its subheadings. A case brief also lists its fields
 * (Facts, Issues, Held, Ratio, Obiter), and Enter on a missing one adds it. Links from the note follow.
 */
import { type App, BRIEF_FIELDS, type DocketPanel, addBriefField, isCaseBrief, moveSection, outlineHeadings, parseFrontMatter, shiftLevel } from '@quire/api';
import type { EditorView } from '@codemirror/view';
import type { Docket } from '../docket';
import { showLinksFrom } from '../actions';
import { openFileIn, plainHeading } from '../providers';
import { currentNote, empty, jumpTo, row, section } from './common';

/** Replace the editor's text (one undo step) and put the cursor at the start of `line`. */
function apply(cm: EditorView, text: string, line: number): void {
	const pos = text.split('\n').slice(0, line).reduce((n, l) => n + l.length + 1, 0);
	cm.dispatch({ changes: { from: 0, to: cm.state.doc.length, insert: text }, selection: { anchor: pos }, scrollIntoView: true });
}

export function outlinePanel(app: App, docket: Docket): DocketPanel {
	return {
		id: 'core:outline', title: 'Outline', icon: 'list-tree', order: 2, source: 'core',
		render: async (el) => {
			const note = await currentNote(app, docket);
			if (!note) { empty(el, 'Open a note to see its outline.'); return; }
			if (app.isLocked(note.file)) { empty(el, 'This note is locked.'); return; }
			const { file, text, cm } = note;
			const heads = outlineHeadings(text);
			const lineStart = (line: number) => text.split('\n').slice(0, line).reduce((n, l) => n + l.length + 1, 0);

			if (isCaseBrief(parseFrontMatter(text) as Record<string, unknown> | undefined, heads)) {
				const sec = section(el, 'Case brief');
				for (const field of BRIEF_FIELDS) {
					const h = heads.find((x) => x.text.trim().toLowerCase() === field.toLowerCase());
					row(sec, docket, field, () => {
						if (!cm) return;
						docket.close();
						if (h) jumpTo(cm, lineStart(h.line));
						else { const r = addBriefField(cm.state.doc.toString(), field); apply(cm, r.text, r.line + 2); cm.focus(); }
					}, { icon: h ? 'circle-check' : 'circle-dashed', detail: h ? null : 'Missing: Enter adds it', cls: h ? '' : 'is-missing' });
				}
			}

			const sec = section(el, `Headings in ${file.basename}`, heads.length);
			if (!heads.length) empty(sec, 'This note has no headings.');
			if (heads.length && !cm) empty(sec, 'Open the note in editing view to rearrange it.');
			const min = Math.min(...heads.map((h) => h.level));
			heads.forEach((h, i) => {
				const r = row(sec, docket, plainHeading(h.text), (where) => {
					if (where === 'insert') return;
					docket.close();
					if (where === 'current' && cm) jumpTo(cm, lineStart(h.line));
					else void openFileIn(app, file, where, `#${h.text}`);
				}, { level: h.level - min, cls: 'docket-outline-item' });
				r.setAttribute('aria-level', String(h.level));
				r.setAttribute('aria-description', 'Alt+Up or Down moves the section; Alt+Left or Right changes its level');
				r.addEventListener('keydown', (e) => {
					if (!e.altKey || !cm || !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return;
					e.preventDefault();
					e.stopPropagation();
					const current = cm.state.doc.toString();
					if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
						const moved = moveSection(current, h.line, e.key === 'ArrowUp' ? -1 : 1);
						if (!moved) return;
						apply(cm, moved.text, moved.line);
						const idx = outlineHeadings(moved.text).findIndex((x) => x.line === moved.line);
						void docket.refreshPanel(rowIndexOf(el, idx, i));
					} else {
						const next = shiftLevel(current, h.line, e.key === 'ArrowLeft' ? -1 : 1);
						if (!next) return;
						apply(cm, next, h.line);
						void docket.refreshPanel(rowIndexOf(el, i, i));
					}
				});
			});

			const links = Object.keys(app.metadataCache.resolvedLinks[file.path] ?? {}).length + Object.keys(app.metadataCache.unresolvedLinks[file.path] ?? {}).length;
			if (links) {
				const ls = section(el, 'Links');
				row(ls, docket, `Links from this note`, () => showLinksFrom(app, docket, file), { icon: 'arrow-up-right', badge: String(links) });
			}
		},
	};
}

/** The row number of heading `idx` (case-brief rows come first). */
function rowIndexOf(el: HTMLElement, idx: number, fallback: number): number {
	const rows = Array.from(el.querySelectorAll('[data-docket-item]'));
	const first = rows.findIndex((r) => r.classList.contains('docket-outline-item'));
	return (first < 0 ? 0 : first) + (idx < 0 ? fallback : idx);
}
