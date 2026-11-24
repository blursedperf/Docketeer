/**
 * Lecture recordings from the keyboard: play and pause, skip, change speed, and drop a timestamp link
 * into the note, all without leaving the editor. They act on the player in use (`app.media.current()`):
 * the one last played or clicked, embedded in a note or open in its own tab.
 */
import { type App, MarkdownView, Notice, formatTimestamp, nextSpeed, timestampLink } from '@quire/api';

/** Seconds skipped back or forward. */
export const SKIP = 5;

export function registerMedia(app: App): void {
	const { workspace } = app;
	const player = () => app.media.current();
	const hasPlayer = () => player() !== null;
	const add = (c: Parameters<App['commands']['addCommand']>[0]) => app.commands.addCommand({ section: 'Recordings', when: hasPlayer, ...c });
	const alt = (key: string) => [{ modifiers: ['Alt' as const], key }];

	add({
		id: 'media:insert-timestamp', name: 'Insert a timestamp link to the recording', icon: 'clock', hotkeys: alt('t'),
		aliases: ['Timestamp', 'Lecture time'], keywords: ['video', 'audio', 'lecture'],
		when: () => hasPlayer() && workspace.getActiveViewOfType(MarkdownView)?.getMode() === 'source',
		run: () => {
			const p = player();
			const view = workspace.getActiveViewOfType(MarkdownView);
			if (!p || !view?.file) return;
			view.editor.replaceSelection(`${timestampLink(app, p.file, view.file.path, p.el.currentTime)} `);
		},
	});
	add({
		id: 'media:play-pause', name: 'Play or pause the recording', icon: 'play', hotkeys: alt('k'), aliases: ['Pause', 'Resume'],
		run: () => {
			const el = player()?.el;
			if (!el) return;
			if (el.paused) void el.play().catch(() => {});
			else el.pause();
		},
	});
	const skip = (by: number) => () => {
		const el = player()?.el;
		if (!el) return;
		el.currentTime = Math.max(0, Math.min(Number.isFinite(el.duration) ? el.duration : Infinity, el.currentTime + by));
	};
	add({ id: 'media:back', name: `Back ${SKIP} seconds in the recording`, icon: 'rewind', hotkeys: alt('j'), aliases: ['Rewind'], run: skip(-SKIP) });
	add({ id: 'media:forward', name: `Forward ${SKIP} seconds in the recording`, icon: 'fast-forward', hotkeys: alt('l'), aliases: ['Skip'], run: skip(SKIP) });
	const speed = (dir: 1 | -1) => () => {
		const el = player()?.el;
		if (!el) return;
		el.playbackRate = nextSpeed(el.playbackRate, dir);
		new Notice(`Speed ${el.playbackRate}×`, 1200);
	};
	add({ id: 'media:faster', name: 'Play the recording faster', icon: 'chevrons-right', hotkeys: alt('.'), aliases: ['Speed up'], run: speed(1) });
	add({ id: 'media:slower', name: 'Play the recording slower', icon: 'chevrons-left', hotkeys: alt(','), aliases: ['Slow down'], run: speed(-1) });
	add({
		id: 'media:copy-time', name: 'Copy the time in the recording', icon: 'copy',
		run: () => {
			const p = player();
			if (!p) return;
			const stamp = formatTimestamp(p.el.currentTime);
			app.host.clipboard.writeText(stamp);
			new Notice(`Copied ${stamp}`, 1200);
		},
	});
}
