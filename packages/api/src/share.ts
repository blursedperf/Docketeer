import type { App } from './app';
import { Notice } from './ui';

/** True where the system can share a file (the share sheet on iPhone and iPad; not desktop). */
export function canShare(app: App): boolean {
	return !!app.host.app.shareFile;
}

/** Open the share sheet for a homebase file. A notice says why if it cannot. */
export async function shareFile(app: App, path: string): Promise<void> {
	const share = app.host.app.shareFile;
	if (!share) return;
	try {
		await share.call(app.host.app, path);
	} catch (e) {
		new Notice(`Could not share ${path}: ${e instanceof Error ? e.message : String(e)}`);
	}
}

/**
 * The notice after an export wrote `path`: `message`, with a Share… button where the system can share files, so the
 * export can go straight to Mail, Messages or another app. On desktop it is a plain notice.
 */
export function exportedNotice(app: App, path: string, message: string, duration = 8000): Notice {
	const notice = new Notice(message, canShare(app) ? Math.max(duration, 10000) : duration);
	if (canShare(app)) {
		const row = notice.noticeEl.createDiv({ cls: 'notice-actions' });
		const b = row.createEl('button', { cls: 'mod-cta', text: 'Share…', attr: { type: 'button' } });
		b.addEventListener('click', (e) => {
			e.stopPropagation();
			notice.hide();
			void shareFile(app, path);
		});
	}
	return notice;
}
