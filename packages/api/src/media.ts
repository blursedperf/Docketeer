/**
 * Audio and video from the homebase: lecture recordings above all. Players are embedded in notes
 * (`![[Week 3.mp4]]`) or open in a tab of their own; timestamps link into them (`[[Week 3.mp4#t=12:34|12:34]]`).
 * Every player registers with `app.media`, which knows the one in use, so commands (play, skip, speed,
 * insert a timestamp) work from the note being written.
 */
import type { App } from './app';
import type { TFile } from './files';
import { FileView, type ViewStateResult } from './view';

export const VIDEO_EXTENSIONS: ReadonlySet<string> = new Set(['mp4', 'm4v', 'webm', 'ogv', 'mov']);
export const AUDIO_EXTENSIONS: ReadonlySet<string> = new Set(['mp3', 'm4a', 'aac', 'ogg', 'oga', 'opus', 'wav', 'flac']);

/** 'video', 'audio' or null, from a file name or link path (a #subpath is ignored). */
export function mediaKind(name: string): 'video' | 'audio' | null {
	const bare = name.replace(/[#?].*$/, '');
	const ext = bare.slice(bare.lastIndexOf('.') + 1).toLowerCase();
	if (bare.lastIndexOf('.') === -1) return null;
	return VIDEO_EXTENSIONS.has(ext) ? 'video' : AUDIO_EXTENSIONS.has(ext) ? 'audio' : null;
}

export function isMedia(name: string): boolean {
	return mediaKind(name) !== null;
}

/** Seconds from "12:34", "1:02:03", "754" or "754.5"; null if it is not a time. */
export function parseTimestamp(text: string): number | null {
	const s = text.trim();
	if (!/^\d+(?::\d{1,2}){0,2}(?:\.\d+)?$/.test(s)) return null;
	const parts = s.split(':').map(Number);
	// Minutes and seconds after the first part stay under 60 ("1:75" is not a time).
	if (parts.slice(1).some((n) => n >= 60)) return null;
	return parts.reduce((acc, n) => acc * 60 + n, 0);
}

/** "m:ss", or "h:mm:ss" from an hour on; whole seconds. */
export function formatTimestamp(seconds: number): string {
	const t = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
	const h = Math.floor(t / 3600);
	const m = Math.floor((t % 3600) / 60);
	const s = String(t % 60).padStart(2, '0');
	return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/** The time in a link's subpath ("#t=12:34", "#t=754"), or null. */
export function timeFromSubpath(subpath: string): number | null {
	const m = /^#t=([^&#]+)/.exec(subpath.trim());
	return m ? parseTimestamp(m[1]!) : null;
}

/** Playback speeds, slowest first. */
export const SPEEDS: readonly number[] = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3];

/** The next speed up (1) or down (-1) from `rate`, staying within SPEEDS. */
export function nextSpeed(rate: number, dir: 1 | -1): number {
	if (dir === 1) return SPEEDS.find((s) => s > rate + 1e-9) ?? SPEEDS[SPEEDS.length - 1]!;
	return [...SPEEDS].reverse().find((s) => s < rate - 1e-9) ?? SPEEDS[0]!;
}

/** The link that jumps to `seconds` in `file`, written from the note at `sourcePath`. */
export function timestampLink(app: App, file: TFile, sourcePath: string, seconds: number): string {
	const stamp = formatTimestamp(seconds);
	return `[[${app.metadataCache.fileToLinktext(file, sourcePath, false)}#t=${stamp}|${stamp}]]`;
}

/** A sidecar caption file for `file`: the same name with .vtt, in the same folder. */
export function captionsFor(app: App, file: TFile): TFile | null {
	const dir = file.parent && !file.parent.isRoot() ? `${file.parent.path}/` : '';
	return app.vault.getFileByPath(`${dir}${file.basename}.vtt`);
}

/**
 * Make the element for `file`: <video> or <audio> with controls, captions from a sidecar .vtt, starting at
 * `start` seconds. It is registered with `app.media`; call the returned function when it goes away.
 */
export function createPlayer(app: App, file: TFile, opts: { start?: number | null; width?: number | null } = {}): { el: HTMLMediaElement; dispose: () => void } {
	const kind = mediaKind(file.name) ?? 'audio';
	const el = document.createElement(kind);
	el.className = `media-embed media-embed-${kind}`;
	el.controls = true;
	el.preload = 'metadata';
	el.dataset.path = file.path;
	if (opts.width) el.style.width = `${opts.width}px`;
	const captions = kind === 'video' ? captionsFor(app, file) : null;
	if (captions) {
		const track = document.createElement('track');
		track.kind = 'captions';
		track.label = 'Captions';
		track.src = app.vault.getResourcePath(captions);
		track.default = true;
		el.appendChild(track);
	}
	// A media fragment starts it there without loading anything first.
	el.src = app.vault.getResourcePath(file) + (opts.start ? `#t=${opts.start}` : '');
	const unregister = app.media.register(el, file);
	return {
		el,
		dispose: () => {
			unregister();
			el.pause();
			el.removeAttribute('src');
			el.load();
		},
	};
}

interface Player { el: HTMLMediaElement; file: TFile; }

/** Every player on screen, and the one in use. */
export class MediaPlayers {
	private players: Player[] = [];
	private activePlayer: Player | null = null;

	register(el: HTMLMediaElement, file: TFile): () => void {
		const p: Player = { el, file };
		this.players.push(p);
		const use = () => { this.activePlayer = p; };
		el.addEventListener('play', use);
		el.addEventListener('pointerdown', use);
		el.addEventListener('focus', use);
		return () => {
			el.removeEventListener('play', use);
			el.removeEventListener('pointerdown', use);
			el.removeEventListener('focus', use);
			this.players = this.players.filter((x) => x !== p);
			if (this.activePlayer === p) this.activePlayer = null;
		};
	}

	/** The player in use: the last one played or touched, else the only one still on screen. */
	current(): { el: HTMLMediaElement; file: TFile } | null {
		if (this.activePlayer?.el.isConnected) return this.activePlayer;
		const live = this.players.filter((p) => p.el.isConnected);
		return live.length === 1 ? live[0]! : null;
	}

	/** Players showing `file`, the one in use first, then visible ones. */
	forFile(file: TFile): HTMLMediaElement[] {
		const live = this.players.filter((p) => p.file === file && p.el.isConnected);
		const visible = (p: Player) => p.el.getClientRects().length > 0;
		live.sort((a, b) => Number(b === this.activePlayer) - Number(a === this.activePlayer) || Number(visible(b)) - Number(visible(a)));
		return live.map((p) => p.el);
	}

	/** Seek a player of `file` to `seconds` and play it; false if none is open. */
	seek(file: TFile, seconds: number, play = true): HTMLMediaElement | null {
		const el = this.forFile(file)[0];
		if (!el) return null;
		this.activePlayer = this.players.find((p) => p.el === el) ?? null;
		el.currentTime = seconds;
		if (play) void el.play().catch(() => { /* not playable: the controls say why */ });
		return el;
	}
}

/** A tab with one recording: video or audio, with captions from a sidecar .vtt. */
export class MediaView extends FileView {
	private player: { el: HTMLMediaElement; dispose: () => void } | null = null;
	private pendingTime: number | null = null;

	getViewType(): string { return 'media'; }
	override getIcon(): string { return this.file && mediaKind(this.file.name) === 'audio' ? 'music' : 'video'; }

	get mediaEl(): HTMLMediaElement | null { return this.player?.el ?? null; }

	override async onLoadFile(file: TFile): Promise<void> {
		this.player?.dispose();
		this.contentEl.empty();
		this.contentEl.addClass('media-view');
		this.player = createPlayer(this.app, file, { start: this.pendingTime });
		this.pendingTime = null;
		// Where it was paused is kept with the layout, for the next time the tab is shown.
		this.player.el.addEventListener('pause', () => this.app.workspace.requestSaveLayout());
		this.contentEl.appendChild(this.player.el);
	}

	override async onUnloadFile(_file: TFile): Promise<void> {
		this.player?.dispose();
		this.player = null;
	}

	override async onClose(): Promise<void> {
		this.player?.dispose();
		this.player = null;
	}

	override getState(): Record<string, unknown> {
		const time = this.player?.el.currentTime;
		return { ...super.getState(), ...(time ? { time: Math.floor(time) } : {}) };
	}

	override async setState(state: unknown, result: ViewStateResult): Promise<void> {
		const time = (state as { time?: unknown } | null)?.time;
		if (typeof time === 'number' && !this.player) this.pendingTime = time;
		await super.setState(state, result);
	}

	override setEphemeralState(state: unknown): void {
		const subpath = (state as { subpath?: unknown } | null)?.subpath;
		const t = typeof subpath === 'string' ? timeFromSubpath(subpath) : null;
		if (t === null || !this.player) return;
		this.player.el.currentTime = t;
		void this.player.el.play().catch(() => {});
	}

	override canAcceptExtension(extension: string): boolean { return isMedia(`x.${extension}`); }
}
