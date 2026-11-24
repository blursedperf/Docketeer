/**
 * Authorities (Mod+1): the cases, legislation and secondary sources in the open note, by kind, with how
 * often each appears. Enter goes to the next place it appears; → offers every note citing it, citing it
 * again, and confirming or merging unsure finds. A jurisdiction filter narrows the list.
 */
import { type App, type Authority, type DocketPanel, JURISDICTIONS, type SearchResult, type Source, findAuthorities, nextOccurrence } from '@quire/api';
import type { ActionItem, Docket } from '../docket';
import type { AuthorityStore } from '../authority-store';
import { openFileIn } from '../providers';
import { currentNote, empty, jumpTo, row, section } from './common';

const GROUPS: [Authority['kind'], string][] = [['case', 'Cases'], ['legislation', 'Legislation'], ['secondary', 'Secondary sources']];

/** A Cite form filled from an authority, when its citation is one the builder knows. */
export function sourceFromAuthority(a: Authority): Source | null {
	if (a.kind === 'case') {
		for (const c of a.citations) {
			let m = /^\[(\d{4})\] ([A-Za-z0-9]+) (\d+)$/.exec(c);
			if (m && !/R$/.test(m[2]!)) return { kind: 'case-mnc', fields: { name: a.name, year: m[1]!, court: m[2]!, number: m[3]!, short: a.aliases[0] ?? '' } };
			m = /^[([](\d{4})[)\]](?: (\d+))? (.+) (\d+)$/.exec(c);
			if (m) return { kind: 'case-reported', fields: { name: a.name, year: m[1]!, volume: m[2] ?? '', report: m[3]!, page: m[4]!, short: a.aliases[0] ?? '' } };
		}
		return { kind: 'case-reported', fields: { name: a.name, short: a.aliases[0] ?? '' } };
	}
	if (a.kind === 'legislation') {
		const m = /^(.*) (\d{4})$/.exec(a.name);
		return { kind: 'legislation', fields: { title: m ? m[1]! : a.name, year: m ? m[2]! : '', jurisdiction: a.jurisdiction ?? '', short: a.aliases[0] ?? '' } };
	}
	return null;
}

export function authoritiesPanel(app: App, docket: Docket, store: AuthorityStore, cite: (s: Source) => void): DocketPanel {
	let filter: string | null = null;

	/** Every note citing `a`: notes containing its name's words (from the index), then checked exactly. */
	const citing = async (a: Authority) => {
		const words = a.kind === 'secondary' ? a.name : a.name.replace(/\[No \d+\]/, '');
		const paths = app.search.index.candidates(words) ?? app.vault.getMarkdownFiles().map((f) => f.path);
		const decisions = await store.load();
		const out: SearchResult[] = [];
		let n = 0;
		for (const p of paths) {
			const f = app.vault.getFileByPath(p);
			if (!f || app.isLocked(f)) continue;
			if (++n % 100 === 0) await new Promise((r) => setTimeout(r, 0));
			const found = findAuthorities(await app.vault.cachedRead(f), decisions).find((x) => x.key === a.key);
			if (!found) continue;
			const first = found.occurrences[0]!;
			out.push({
				id: f.path, type: 'Notes', title: f.basename, detail: `${found.occurrences.length}× · ${f.parent && !f.parent.isRoot() ? f.parent.path : ''}`, icon: 'file-text', file: f,
				open: async (where) => {
					await openFileIn(app, f, where);
					const ed = app.workspace.activeEditor?.editor;
					if (ed) ed.setSelection(ed.offsetToPos(first.from), ed.offsetToPos(first.to));
				},
			});
		}
		docket.showList(`Notes citing ${a.name}`, out);
	};

	return {
		id: 'core:authorities', title: 'Authorities', icon: 'scale', order: 1, source: 'core',
		render: async (el, { focus }) => {
			const note = await currentNote(app, docket);
			if (!note) { empty(el, 'Open a note to see the authorities it cites.'); return; }
			if (app.isLocked(note.file)) { empty(el, 'This note is locked.'); return; }
			const decisions = await store.load();
			const all = findAuthorities(note.text, decisions);
			if (!all.length) { empty(el, 'No cases, legislation or secondary sources found in this note.'); return; }

			// Jurisdiction filter: only those that appear.
			const present = JURISDICTIONS.filter((j) => all.some((a) => a.jurisdiction === j));
			if (present.length) {
				const bar = el.createDiv({ cls: 'docket-filter', attr: { role: 'group', 'aria-label': 'Jurisdiction' } });
				for (const j of [null, ...present]) {
					const b = row(bar, docket, j ?? 'All', () => { filter = j; void docket.refreshPanel(); }, { cls: `docket-chip${filter === j ? ' is-active' : ''}` });
					b.setAttribute('aria-pressed', String(filter === j));
				}
			}
			const shown = filter ? all.filter((a) => a.jurisdiction === filter) : all;
			let focusEl: HTMLElement | null = null;
			for (const [kind, title] of GROUPS) {
				const list = shown.filter((a) => a.kind === kind);
				if (!list.length) continue;
				const sec = section(el, title, list.length);
				for (const a of list) {
					const detail = [a.author, ...a.citations, ...a.sections, a.jurisdiction && !a.citations.includes(`(${a.jurisdiction})`) ? a.jurisdiction : null].filter(Boolean).join(' · ');
					const actions = (): ActionItem[] => {
						const others = all.filter((o) => o !== a && o.kind === a.kind);
						const src = sourceFromAuthority(a);
						return [
							{ title: 'Next place in this note', icon: 'arrow-down', run: () => go(a) },
							{ title: 'Every note citing this', icon: 'files', run: () => citing(a) },
							...(src ? [{ title: 'Cite this', icon: 'quote', run: () => cite(src) }] : []),
							...(a.confirmed ? [] : [{ title: 'Confirm', icon: 'check', run: async () => { await store.confirm(a.key); await docket.refreshPanel(); } }]),
							...(others.length ? [{ title: 'Merge into…', icon: 'merge', run: () => docket.showActionList(`Merge ${a.name} into`, others.map((o) => ({ title: o.name, run: async () => { await store.merge(a.key, o.key); await docket.refreshPanel(); } }))) }] : []),
							{ title: 'Copy name', icon: 'copy', run: () => app.host.clipboard.writeText(a.name) },
						];
					};
					const r = row(sec, docket, a.name, () => go(a), {
						detail, italic: a.kind !== 'secondary', badge: `${a.confirmed ? '' : 'unconfirmed · '}${a.occurrences.length}×`, actions,
						icon: kind === 'case' ? 'gavel' : kind === 'legislation' ? 'scroll-text' : 'book-open',
					});
					if (!a.confirmed) r.addClass('is-unconfirmed');
					if (focus && (a.name === focus || a.name.startsWith(focus) || focus.startsWith(a.name))) { r.addClass('is-focus'); focusEl = r; }
				}
			}
			(focusEl as HTMLElement | null)?.scrollIntoView({ block: 'nearest' });

			function go(a: Authority) {
				const cm = note!.cm;
				if (!cm) { void openFileIn(app, note!.file, 'current'); return; }
				const o = nextOccurrence(a, cm.state.selection.main.head);
				if (!o) return;
				docket.close();
				jumpTo(cm, o.from, o.to);
			}
		},
	};
}
