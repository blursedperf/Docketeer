/**
 * The Study panel in the Docket: the focus timer (start or pause it, skip to the next phase), every deck with how
 * many cards are due, and today's streak. Enter on a deck opens the study view on its due cards (all of them when
 * none are due); → offers due cards, cram (every card) or the deck's notes. Rows move like the Docket's own.
 */
import type { DocketAction, DocketPanel, DocketPanelUI } from "@quire/api";
import type PomodoroFlashcardsPlugin from "./main";
import { isCardDue } from "./srs";
import { PomodoroTimer } from "./pomodoro";
import { CreateFlashcardModal } from "./create-card-modal";
import type { Flashcard, PomodoroState } from "./types";

export const STUDY_PANEL = "study";

export function studyPanel(plugin: PomodoroFlashcardsPlugin): DocketPanel {
	return {
		id: STUDY_PANEL,
		title: "Study",
		icon: "layers",
		render: (el, { ui }) => {
			if (!ui) return;
			render(plugin, el, ui);
		},
	};
}

/** What the timer chip says: "Focus 24:12", with what Enter does next. */
function timerText(s: PomodoroState): string {
	return `${PomodoroTimer.getPhaseLabel(s.phase)} ${PomodoroTimer.formatTime(s.remainingSeconds)}`;
}

/** "3 due · 12 cards", or "12 cards, none due". */
export function deckDetail(cards: Flashcard[], now: number): string {
	const due = cards.filter((c) => isCardDue(c.srs, now)).length;
	const n = `${cards.length} ${cards.length === 1 ? "card" : "cards"}`;
	return due ? `${due} due · ${n}` : `${n}, none due`;
}

function render(plugin: PomodoroFlashcardsPlugin, el: HTMLElement, ui: DocketPanelUI): void {
	el.addClass("pomo-fc-panel");
	const now = Date.now();
	const state = plugin.pomodoro.getState();

	// The timer, then what else can be done from here.
	const bar = el.createDiv({ cls: "docket-filter", attr: { role: "group", "aria-label": "Focus timer" } });
	const timer = ui.row(bar, timerText(state), () => { plugin.pomodoro.toggle(); void ui.refresh(); }, {
		cls: `docket-chip pomo-fc-panel-timer${state.isRunning ? " is-active" : ""}`,
		icon: state.isRunning ? "pause" : "play",
		label: state.isRunning ? "Pause the timer" : "Start the timer",
	});
	ui.row(bar, "Skip", () => { plugin.pomodoro.skipPhase(); void ui.refresh(); }, { cls: "docket-chip", icon: "skip-forward", label: "Skip to the next phase" });
	ui.row(bar, "+ New card", () => {
		ui.close();
		new CreateFlashcardModal(plugin.app, plugin, { onCardCreated: () => plugin.refreshStudyViews() }).open();
	}, { cls: "docket-chip" });

	// The time counts down while the panel is open (the rest is drawn again on a start, pause or new phase).
	const title = timer.querySelector(".docket-option-title") ?? timer;
	let running = state.isRunning;
	let phase = state.phase;
	const stop = plugin.pomodoro.subscribe((s) => {
		if (!timer.isConnected) { stop(); return; }
		title.setText(timerText(s));
		if (s.isRunning !== running || s.phase !== phase) { running = s.isRunning; phase = s.phase; stop(); void ui.refresh(); }
	});

	const cards = plugin.cards;
	if (!cards.length) {
		ui.empty(el, "No cards yet. Write Question :: Answer in any note, or fill in a case brief's Held and Ratio.");
		return;
	}
	const decks = ui.section(el, "Decks", plugin.getDecks().length);
	const deckRow = (name: string, deckCards: Flashcard[]) => {
		const due = deckCards.filter((c) => isCardDue(c.srs, now)).length;
		const deck = name === "All decks" ? "ALL" : name;
		const actions = (): DocketAction[] => [
			{ title: `Study the ${due} due`, icon: "layers", run: () => { ui.close(); void plugin.studyDeck(deck, "due"); } },
			{ title: `Cram all ${deckCards.length}`, icon: "rotate-ccw", run: () => { ui.close(); void plugin.studyDeck(deck, "cram"); } },
		];
		ui.row(decks, name, () => { ui.close(); void plugin.studyDeck(deck, due ? "due" : "cram"); }, {
			icon: deck === "ALL" ? "layers" : "folder",
			detail: deckDetail(deckCards, now),
			badge: due ? String(due) : undefined,
			actions,
			label: `${name}: ${deckDetail(deckCards, now)}`,
		});
	};
	deckRow("All decks", cards);
	for (const name of plugin.getDecks()) {
		const deckCards = cards.filter((c) => c.deck === name);
		if (deckCards.length) deckRow(name, deckCards);
	}

	const s = plugin.stats;
	const today = ui.section(el, "So far");
	const open = () => { ui.close(); void plugin.activateStudyView(); };
	ui.row(today, `${s.dailyStreak} ${s.dailyStreak === 1 ? "day" : "days"} in a row`, open, { icon: "flame", detail: s.lastStudyDate ? `Last studied ${s.lastStudyDate}` : "Not studied yet" });
	ui.row(today, `${s.totalCardsReviewed} cards reviewed`, open, { icon: "check", detail: `${s.totalPomodoros} focus sessions, ${s.totalFocusMinutes} minutes` });
}
