/**
 * The Tasks panel in Quire's Docket: every task in the homebase, grouped (by when it is due, by default) and
 * sorted (by urgency). Rows move like the Docket's own: ↑↓ choose, Enter opens the task in its note (Mod+Enter:
 * to the right), → offers its actions (check off, due today or tomorrow, a date, a priority). The row above the
 * tasks chooses what is shown (open, done, all), the sort and the grouping, or adds a task.
 */
import type { DocketPanel, DocketPanelUI, OpenWhere } from "@quire/api";
import type TaskDocketPlugin from "./main";
import { type GroupMode, type SortMode, type StatusFilter, addDays, dueLabel, filterTasks, groupTasks, isoDate, sortTasks, whenBucket } from "./arrange";
import { GROUP_OPTIONS, SORT_OPTIONS } from "./settings";
import { PRIORITY_NAMES, type Priority, type Task } from "./task";
import { DueDateModal } from "./modals";

/** Rows drawn in a group before "Show more". */
const PAGE = 40;

/** A task's text as plain words: [[Link|alias]] → alias, [text](url) → text, **marks** dropped. */
export function plainText(text: string): string {
	return text
		.replace(/!?\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g, (_m, target: string, alias?: string) => alias ?? target)
		.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
		.replace(/(\*\*|__|==|~~|`)/g, "")
		.replace(/(^|[\s(])[*_]([^*_\s][^*_]*?)[*_](?=$|[\s).,;:!?])/g, "$1$2")
		// Tags are shown in the row's detail.
		.replace(/(^|\s)#[\p{L}\p{N}_/-]+/gu, "")
		.replace(/\s{2,}/g, " ")
		.trim();
}

export interface PanelState {
	status: StatusFilter;
	sort: SortMode;
	group: GroupMode;
	/** Groups showing all their rows. */
	expanded: Set<string>;
}

export function tasksPanel(plugin: TaskDocketPlugin, state: PanelState): DocketPanel {
	return {
		id: "tasks",
		title: "Tasks",
		icon: "list-checks",
		render: (el, { ui }) => {
			if (!ui) return;
			render(plugin, state, el, ui);
		},
	};
}

function render(plugin: TaskDocketPlugin, state: PanelState, el: HTMLElement, ui: DocketPanelUI): void {
	el.addClass("task-docket-panel");
	const now = new Date();
	const today = isoDate(now);
	const minutes = now.getHours() * 60 + now.getMinutes();
	const redraw = () => void ui.refresh();

	// What to show, and how.
	const bar = el.createDiv({ cls: "docket-filter", attr: { role: "group", "aria-label": "Show" } });
	for (const [value, label] of [["open", "Open"], ["done", "Done"], ["all", "All"]] as [StatusFilter, string][]) {
		const b = ui.row(bar, label, () => { state.status = value; state.expanded.clear(); redraw(); }, { cls: `docket-chip${state.status === value ? " is-active" : ""}` });
		b.setAttribute("aria-pressed", String(state.status === value));
	}
	ui.row(bar, `Sort: ${SORT_OPTIONS[state.sort]}`, () => ui.showActions("Sort tasks by", (Object.keys(SORT_OPTIONS) as SortMode[]).map((k) => ({
		title: SORT_OPTIONS[k], icon: k === state.sort ? "check" : undefined, run: () => { state.sort = k; redraw(); },
	}))), { cls: "docket-chip" });
	ui.row(bar, `Group: ${GROUP_OPTIONS[state.group]}`, () => ui.showActions("Group tasks by", (Object.keys(GROUP_OPTIONS) as GroupMode[]).map((k) => ({
		title: GROUP_OPTIONS[k], icon: k === state.group ? "check" : undefined, run: () => { state.group = k; state.expanded.clear(); redraw(); },
	}))), { cls: "docket-chip" });
	ui.row(bar, "+ Add task", () => { ui.close(); plugin.openAddTask(); }, { cls: "docket-chip" });

	if (!plugin.index.isReady) { ui.empty(el, "Collecting tasks…"); return; }
	const all = plugin.index.all();
	const shown = filterTasks(all, state.status, "");
	if (!shown.length) {
		ui.empty(el, all.length
			? (state.status === "done" ? "No tasks done yet." : "Nothing to do: every task is done.")
			: "No tasks yet. A task is a checklist item in any note: - [ ] Read Donoghue v Stevenson 📅 2026-11-20");
		return;
	}
	const groups = groupTasks(sortTasks(shown, state.sort, today, minutes), state.group, today);
	for (const g of groups) {
		const sec = ui.section(el, g.label, g.tasks.length);
		if (g.tone) sec.parentElement?.addClass(`is-${g.tone}`);
		const limit = state.expanded.has(g.key) ? g.tasks.length : PAGE;
		for (const t of g.tasks.slice(0, limit)) taskRow(plugin, ui, sec, t, today);
		if (g.tasks.length > limit) {
			ui.row(sec, `Show ${g.tasks.length - limit} more`, () => { state.expanded.add(g.key); redraw(); }, { icon: "chevrons-down", cls: "task-docket-more" });
		}
	}
}

function taskRow(plugin: TaskDocketPlugin, ui: DocketPanelUI, parent: HTMLElement, t: Task, today: string): void {
	const closed = t.status === "done" || t.status === "cancelled";
	const bucket = whenBucket(t, today);
	const note = t.path.split("/").pop()!.replace(/\.md$/i, "");
	const detail = [
		t.due ? dueLabel(t.due, today) + (t.time ? ` ${t.time}` : "") : null,
		t.priority !== 2 ? `${PRIORITY_NAMES[t.priority]} priority` : null,
		...t.tags.map((x) => `#${x}`),
		note,
	].filter(Boolean).join(" · ");
	const open = (where: OpenWhere | "insert") => { ui.close(); void plugin.openTask(t, where === "right" || where === "below" ? "split" : false); };
	ui.row(parent, plainText(t.text) || "(empty task)", open, {
		icon: closed ? "check-square" : t.status === "in-progress" ? "square-dot" : "square",
		detail,
		badge: !closed && bucket === "overdue" ? "overdue" : undefined,
		label: `${closed ? "Done: " : ""}${plainText(t.text)}. ${detail}`,
		cls: `task-docket-row${closed ? " is-done" : ""}${bucket === "overdue" && !closed ? " is-overdue" : ""} is-p${t.priority}`,
		actions: () => {
			const later = (days: number) => addDays(today, days);
			return [
				{ title: closed ? "Reopen" : "Check off", icon: closed ? "square" : "check-square", run: () => plugin.toggleTask(t) },
				{ title: "Open in its note", icon: "file-text", run: () => open("current") },
				{ title: "Due today", icon: "calendar-check", run: () => plugin.setDue(t, today, t.time ?? null) },
				{ title: "Due tomorrow", icon: "calendar-plus", run: () => plugin.setDue(t, later(1), t.time ?? null) },
				{ title: "Due in a week", icon: "calendar-days", run: () => plugin.setDue(t, later(7), t.time ?? null) },
				{ title: "Set due date…", icon: "calendar-clock", run: () => { ui.close(); new DueDateModal(plugin.app, t, (date, time) => void plugin.setDue(t, date, time)).open(); } },
				...(t.due ? [{ title: "Clear due date", icon: "calendar-x", run: () => plugin.setDue(t, null, null) }] : []),
				...([5, 4, 3, 2, 1, 0] as Priority[]).filter((p) => p !== t.priority).map((p) => ({
					title: `Priority: ${PRIORITY_NAMES[p]}`, icon: "flag", run: () => plugin.setPriority(t, p),
				})),
			];
		},
	});
}
