/**
 * The core Docket panels, Mod+1 to Mod+6, and the "@" search over the open note's authorities.
 */
import { type App, findAuthorities, nextOccurrence } from '@quire/api';
import type { Docket } from './docket';
import { AuthorityStore } from './authority-store';
import { authoritiesPanel } from './panels/authorities';
import { citePanel } from './panels/cite';
import { currentNote, jumpTo } from './panels/common';
import { homebasePanel } from './panels/homebase';
import { layoutPanel } from './panels/layout';
import { outlinePanel } from './panels/outline';
import { unitsPanel } from './panels/units';

export function registerCorePanels(app: App, docket: Docket): () => void {
	const store = new AuthorityStore(app);
	const cite = citePanel(app, docket);
	const removers = [
		app.docket.addPanel(authoritiesPanel(app, docket, store, (s) => cite.prefill(s))),
		app.docket.addPanel(outlinePanel(app, docket)),
		app.docket.addPanel(unitsPanel(app, docket)),
		app.docket.addPanel(cite),
		app.docket.addPanel(homebasePanel(app, docket)),
		app.docket.addPanel(layoutPanel(app, docket)),
		app.docket.addSearchProvider({
			id: 'core:authorities', title: 'Authorities in this note', prefixes: ['@', ''], source: 'core',
			search: async ({ text, prefix }) => {
				if (!prefix && text.length < 3) return [];
				const note = await currentNote(app, docket);
				if (!note || app.isLocked(note.file)) return [];
				const words = text.toLowerCase().split(/\s+/).filter(Boolean);
				return findAuthorities(note.text, await store.load())
					.filter((a) => words.every((w) => `${a.name} ${a.citations.join(' ')} ${a.author ?? ''}`.toLowerCase().includes(w)))
					.map((a, i) => ({
						id: a.key, type: 'Authorities', title: a.name, icon: a.kind === 'case' ? 'gavel' : a.kind === 'legislation' ? 'scroll-text' : 'book-open',
						detail: [a.kind === 'case' ? 'Case' : a.kind === 'legislation' ? 'Legislation' : 'Secondary', ...a.citations, `${a.occurrences.length}×`, a.confirmed ? '' : 'unconfirmed'].filter(Boolean).join(' · '),
						score: 100 - i,
						open: () => { const cm = note.cm; const o = cm && nextOccurrence(a, cm.state.selection.main.head); if (cm && o) jumpTo(cm, o.from, o.to); },
						insert: () => (a.kind === 'secondary' ? a.name : `*${a.aliases[0] ?? a.name}*`),
					}));
			},
		}),
	];
	return () => { for (const r of removers) r(); };
}
