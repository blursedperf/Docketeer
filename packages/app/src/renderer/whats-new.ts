/**
 * "What's new": the changelog bundled with the app, shown once after it has been upgraded by hand and from
 * Settings → About. Nothing is fetched: the text is part of the build (virtual:changelog).
 */
import { type App, Component, MarkdownRenderer, Modal } from '@quire/api';
import changelogText from 'virtual:changelog';
import { changesSince, parseChangelog } from './changelog';

/** The modal: the changes since `from` (only this version's without it), newest first. */
export class WhatsNewModal extends Modal {
	private comp = new Component();

	constructor(app: App, private from?: string, private intro?: string) {
		super(app);
	}

	override onOpen(): void {
		const version = this.app.host.appVersion;
		this.setTitle(`What's new in Caselore ${version}`);
		this.modalEl.addClass('mod-whats-new');
		const el = this.contentEl;
		if (this.intro) el.createEl('p', { cls: 'whats-new-intro', text: this.intro });
		const sections = changesSince(parseChangelog(changelogText), version, this.from);
		if (!sections.length) {
			el.createEl('p', { text: 'Nothing is listed for this version.' });
			return;
		}
		this.comp.load();
		for (const s of sections) {
			el.createEl('h3', { text: s.version === 'Unreleased' ? 'Not yet released' : `Version ${s.version}` });
			const body = el.createDiv({ cls: 'markdown-rendered' });
			void MarkdownRenderer.render(this.app, s.body, body, '', this.comp);
		}
	}

	override onClose(): void {
		this.comp.unload();
		this.contentEl.empty();
	}
}

/** After a version replaced by hand starts for the first time: what changed, or a word about an older copy. */
export function showLaunchNotes(app: App): void {
	const launch = app.host.app.launch;
	if (!launch) return;
	const version = app.host.appVersion;
	if (launch.kind === 'upgrade') {
		const from = launch.from ? ` from ${launch.from}` : '';
		const backup = launch.backup ? ' A copy of your settings from before is kept in the Backups folder beside them.' : '';
		new WhatsNewModal(app, launch.from, `Caselore has been upgraded${from}. Your notes weren't touched, and your settings came across as they were.${backup}`).open();
		return;
	}
	const modal = new Modal(app);
	modal.setTitle('This copy of Caselore is older');
	modal.contentEl.createEl('p', {
		text: `This is Caselore ${version}, but ${launch.from ? `version ${launch.from}` : 'a newer version'} was used last. Your notes are fine. `
			+ 'Settings that only newer versions have are kept but not used here. To get them back, open the newer version again.',
	});
	modal.open();
}
