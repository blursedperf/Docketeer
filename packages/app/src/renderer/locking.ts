/**
 * Locking, as the user meets it: setting up (passphrase, then the recovery key shown once), unlocking
 * (or recovering with the recovery key), changing the passphrase, the commands, the lock in the status
 * bar, the Security settings page, and auto-locking after idle time and when the computer sleeps or its
 * screen locks. The keys and the encryption are in @quire/api (lock/service.ts). See docs/docket/locking.md.
 */
import { type App, Modal, Notice, Setting, SettingTab, Platform, TFile, TFolder, setIcon } from '@quire/api';

const MIN_PASSPHRASE = 10;

/** A passphrase field that never shows its text and never fills itself in. */
function secretField(parent: HTMLElement, name: string, desc: string | null, onChange: (v: string) => void, onEnter: () => void): HTMLInputElement {
	let input!: HTMLInputElement;
	new Setting(parent).setName(name).setDesc(desc ?? '').addText((t) => {
		input = t.inputEl;
		input.type = 'password';
		input.autocomplete = 'off';
		input.spellcheck = false;
		t.onChange(onChange);
		input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); onEnter(); } });
	});
	return input;
}

function error(parent: HTMLElement): (text: string) => void {
	const el = parent.createDiv({ cls: 'lock-error', attr: { role: 'alert' } });
	return (text) => el.setText(text);
}

/** Shows the recovery key once, and asks the user to confirm they have kept it. */
class RecoveryKeyModal extends Modal {
	constructor(app: App, private recoveryKey: string, private done: () => void) {
		super(app);
		this.setTitle('Your recovery key');
	}
	override onOpen(): void {
		const { contentEl } = this;
		contentEl.createEl('p', { text: 'If you forget your passphrase, this key is the only way to open your locked notes. Write it down or print it, and keep it somewhere safe, away from this computer. Caselore will not show it again.' });
		contentEl.createDiv({ cls: 'lock-recovery-key', text: this.recoveryKey, attr: { 'aria-label': `Recovery key: ${this.recoveryKey.split('').join(' ')}` } });
		new Setting(contentEl).addButton((b) => b.setButtonText('Copy').onClick(() => { this.app.host.clipboard.writeText(this.recoveryKey); new Notice('Recovery key copied. Paste it somewhere safe, then clear your clipboard.'); }));
		let kept = false;
		let button!: HTMLButtonElement;
		new Setting(contentEl).setName('I have kept my recovery key somewhere safe').addToggle((t) => t.onChange((v) => { kept = v; button.disabled = !v; }));
		new Setting(contentEl).addButton((b) => { button = b.buttonEl; b.setButtonText('Done').setCta().onClick(() => { if (kept) this.close(); }); button.disabled = true; });
	}
	override onClose(): void { this.contentEl.empty(); this.done(); }
}

/** Set up locking: a passphrase twice, then the recovery key. */
export class SetUpLockModal extends Modal {
	private a = '';
	private b = '';
	constructor(app: App, private after?: () => void) {
		super(app);
		this.setTitle('Set up locking');
	}
	override onOpen(): void {
		const { contentEl } = this;
		contentEl.createEl('p', { text: 'Locked notes and folders are encrypted on this computer. One passphrase unlocks them all; you will also get a recovery key. Without both, locked notes cannot be opened by anyone, including you.' });
		const say = error(contentEl);
		const submit = async () => {
			if (this.a.length < MIN_PASSPHRASE) { say(`Use at least ${MIN_PASSPHRASE} characters. A few unrelated words work well.`); return; }
			if (this.a !== this.b) { say('The two passphrases are different.'); return; }
			say('Setting up…');
			try {
				const key = await this.app.lock.setUp(this.a);
				this.close();
				new RecoveryKeyModal(this.app, key, () => { new Notice('Locking is set up. Lock a note or folder from its actions (→), or with "Lock note".'); this.after?.(); }).open();
			} catch (e) {
				say(e instanceof Error ? e.message : String(e));
			}
		};
		const first = secretField(contentEl, 'Passphrase', `At least ${MIN_PASSPHRASE} characters.`, (v) => { this.a = v; }, () => second.focus());
		const second = secretField(contentEl, 'Again', null, (v) => { this.b = v; }, () => { void submit(); });
		new Setting(contentEl)
			.addButton((b) => b.setButtonText('Cancel').onClick(() => this.close()))
			.addButton((b) => b.setButtonText('Set up').setCta().onClick(() => { void submit(); }));
		window.setTimeout(() => first.focus(), 0);
	}
	override onClose(): void { this.contentEl.empty(); }
}

/** Unlock with the passphrase, or switch to the recovery key. Resolves whether it is unlocked. */
export class UnlockModal extends Modal {
	private pass = '';
	private result = false;
	constructor(app: App, private resolve: (ok: boolean) => void) {
		super(app);
		this.setTitle('Unlock');
	}
	override onOpen(): void {
		const { contentEl } = this;
		const say = error(contentEl);
		const submit = async () => {
			if (!this.pass) return;
			say('Unlocking…');
			if (await this.app.lock.unlock(this.pass)) { this.result = true; this.close(); return; }
			say('That passphrase is not right.');
			input.select();
		};
		const input = secretField(contentEl, 'Passphrase', null, (v) => { this.pass = v; }, () => { void submit(); });
		new Setting(contentEl)
			// Hand the waiting caller to the recovery dialog before closing, so it waits for that instead.
			.addButton((b) => b.setButtonText('Use the recovery key…').onClick(() => { const r = this.resolve; this.resolve = () => undefined; this.close(); new RecoverModal(this.app, r).open(); }))
			.addButton((b) => b.setButtonText('Cancel').onClick(() => this.close()))
			.addButton((b) => b.setButtonText('Unlock').setCta().onClick(() => { void submit(); }));
		window.setTimeout(() => input.focus(), 0);
	}
	override onClose(): void { this.contentEl.empty(); this.resolve(this.result); }
}

/** Unlock with the recovery key and choose a new passphrase. */
class RecoverModal extends Modal {
	private key = '';
	private a = '';
	private b = '';
	private result = false;
	constructor(app: App, private resolve: (ok: boolean) => void) {
		super(app);
		this.setTitle('Unlock with the recovery key');
	}
	override onOpen(): void {
		const { contentEl } = this;
		const say = error(contentEl);
		let keyInput!: HTMLInputElement;
		new Setting(contentEl).setName('Recovery key').setDesc('Capitals, spaces and dashes do not matter.').addText((t) => {
			keyInput = t.inputEl;
			keyInput.autocomplete = 'off';
			keyInput.spellcheck = false;
			t.onChange((v) => { this.key = v; });
		});
		const submit = async () => {
			if (this.a.length < MIN_PASSPHRASE) { say(`Use at least ${MIN_PASSPHRASE} characters for the new passphrase.`); return; }
			if (this.a !== this.b) { say('The two passphrases are different.'); return; }
			say('Checking…');
			if (await this.app.lock.recover(this.key, this.a)) { this.result = true; this.close(); new Notice('Unlocked, with a new passphrase.'); return; }
			say('That recovery key is not right.');
		};
		secretField(contentEl, 'New passphrase', null, (v) => { this.a = v; }, () => undefined);
		secretField(contentEl, 'Again', null, (v) => { this.b = v; }, () => { void submit(); });
		new Setting(contentEl)
			.addButton((b) => b.setButtonText('Cancel').onClick(() => this.close()))
			.addButton((b) => b.setButtonText('Unlock').setCta().onClick(() => { void submit(); }));
		window.setTimeout(() => keyInput.focus(), 0);
	}
	override onClose(): void { this.contentEl.empty(); this.resolve(this.result); }
}

class ChangePassphraseModal extends Modal {
	private old = '';
	private a = '';
	private b = '';
	constructor(app: App) {
		super(app);
		this.setTitle('Change passphrase');
	}
	override onOpen(): void {
		const { contentEl } = this;
		const say = error(contentEl);
		const submit = async () => {
			if (this.a.length < MIN_PASSPHRASE) { say(`Use at least ${MIN_PASSPHRASE} characters.`); return; }
			if (this.a !== this.b) { say('The two new passphrases are different.'); return; }
			say('Changing…');
			if (await this.app.lock.changePassphrase(this.old, this.a)) { this.close(); new Notice('Passphrase changed. Your recovery key still works.'); return; }
			say('The current passphrase is not right.');
		};
		const first = secretField(contentEl, 'Current passphrase', null, (v) => { this.old = v; }, () => undefined);
		secretField(contentEl, 'New passphrase', `At least ${MIN_PASSPHRASE} characters.`, (v) => { this.a = v; }, () => undefined);
		secretField(contentEl, 'Again', null, (v) => { this.b = v; }, () => { void submit(); });
		new Setting(contentEl)
			.addButton((b) => b.setButtonText('Cancel').onClick(() => this.close()))
			.addButton((b) => b.setButtonText('Change').setCta().onClick(() => { void submit(); }));
		window.setTimeout(() => first.focus(), 0);
	}
	override onClose(): void { this.contentEl.empty(); }
}

/** Ask to unlock (resolves true when unlocked). */
export function promptUnlock(app: App): Promise<boolean> {
	if (app.lock.isUnlocked) return Promise.resolve(true);
	return new Promise((resolve) => new UnlockModal(app, resolve).open());
}

class SecurityTab extends SettingTab {
	constructor(app: App) {
		super(app);
		this.id = 'security';
		this.name = 'Security';
	}
	display(): void {
		const el = this.containerEl;
		el.empty();
		const lock = this.app.lock;
		new Setting(el).setName('Locking').setHeading();
		if (!lock.isSetUp) {
			new Setting(el).setName('Set up locking').setDesc('Encrypt chosen notes and folders on this computer, opened with a passphrase.')
				.addButton((b) => b.setButtonText('Set up…').onClick(() => { new SetUpLockModal(this.app, () => this.display()).open(); }));
		} else {
			new Setting(el).setName(lock.isUnlocked ? 'Unlocked' : 'Locked').setDesc(`${lock.sealedNotes.length} locked note(s), ${lock.lockedFolders.length} locked folder(s).`)
				.addButton((b) => b.setButtonText(lock.isUnlocked ? 'Lock now' : 'Unlock…').onClick(async () => { if (lock.isUnlocked) await lock.lock(); else await promptUnlock(this.app); this.display(); }));
			new Setting(el).setName('Change passphrase').addButton((b) => b.setButtonText('Change…').onClick(() => new ChangePassphraseModal(this.app).open()));
		}
		new Setting(el).setName('Lock again by itself').setHeading();
		new Setting(el).setName('After idle time').setDesc('Minutes without typing or clicking; 0 never locks on idle.').setClass('mod-number')
			.addText((t) => {
				t.inputEl.type = 'number';
				t.inputEl.min = '0';
				t.inputEl.insertAdjacentElement('afterend', createSpan({ cls: 'setting-unit', text: 'minutes' }));
				t.setValue(String(this.app.config.lockIdleMinutes ?? 15)).onChange((v) => { const n = Math.max(0, Math.round(Number(v) || 0)); void this.app.setConfig('lockIdleMinutes', n); });
			});
		new Setting(el).setName(Platform.isMobileApp ? 'When you leave Caselore or the screen locks' : 'When the computer sleeps or its screen locks')
			.addToggle((t) => t.setValue(this.app.config.lockOnSleep !== false).onChange((v) => { void this.app.setConfig('lockOnSleep', v); }));
		new Setting(el).setName('When Caselore closes').setDesc('Always: the key is never written to disk, so Caselore starts locked.');
	}
}

export function registerLocking(app: App): void {
	const { lock, commands } = app;
	lock.prompt = () => promptUnlock(app);
	app.setting.addCoreTab(new SecurityTab(app));

	const add = (c: Parameters<typeof commands.addCommand>[0]) => commands.addCommand({ section: 'Homebase', ...c });
	const fileArg = (args: Record<string, unknown>) => (args.file instanceof TFile ? args.file : app.workspace.getActiveFile());
	const folderArg = (args: Record<string, unknown>) => (args.folder instanceof TFolder ? args.folder : null);
	const report = (e: unknown) => new Notice(e instanceof Error ? e.message : String(e));
	/** Locking needs setting up, and unlocking, first: ask for whatever is missing, then go on. */
	const ready = async (): Promise<boolean> => {
		if (!lock.isSetUp) { new SetUpLockModal(app).open(); return false; }
		return promptUnlock(app);
	};

	add({ id: 'app:lock-setup', name: 'Set up locking', icon: 'shield', when: () => !lock.isSetUp, run: () => new SetUpLockModal(app).open() });
	add({ id: 'app:lock-now', name: 'Lock now', icon: 'lock', hotkeys: [{ modifiers: ['Mod'], key: 'l' }], when: () => lock.isUnlocked, run: () => lock.lock() });
	add({ id: 'app:unlock', name: 'Unlock', icon: 'lock-open', when: () => lock.isSetUp && !lock.isUnlocked, run: () => promptUnlock(app) });
	add({ id: 'app:change-passphrase', name: 'Change passphrase', icon: 'key-round', when: () => lock.isSetUp, run: () => new ChangePassphraseModal(app).open() });
	add({
		id: 'app:lock-note', name: 'Lock note', icon: 'lock', aliases: ['Encrypt note'],
		when: (ctx) => { const f = fileArg(ctx.args); return !!f && f.extension === 'md' && !lock.isEncrypted(f.path); },
		run: async (ctx) => {
			const f = fileArg(ctx.args)!;
			if (!(await ready())) return;
			await lock.lockNote(f).then(() => new Notice(`Locked “${f.basename}”: encrypted on disk.`)).catch(report);
		},
	});
	add({
		id: 'app:remove-note-lock', name: 'Remove lock from note', icon: 'lock-open', aliases: ['Decrypt note'],
		when: (ctx) => { const f = fileArg(ctx.args); return !!f && lock.isEncrypted(f.path); },
		confirm: (ctx) => `Decrypt “${fileArg(ctx.args)?.basename}” on disk? Other apps will be able to read it again.`, confirmAction: 'Remove lock', danger: true,
		run: async (ctx) => {
			const f = fileArg(ctx.args)!;
			if (!(await promptUnlock(app))) return;
			await lock.removeNoteLock(f).then(() => new Notice(`“${f.basename}” is no longer locked.`)).catch(report);
		},
	});
	add({
		id: 'app:lock-folder', name: 'Lock folder', icon: 'folder-lock', aliases: ['Lock subject', 'Lock topic'],
		when: (ctx) => { const f = folderArg(ctx.args); return !!f && !f.isRoot() && !lock.isFolderLocked(f); },
		confirm: (ctx) => `Lock “${folderArg(ctx.args)?.name}”? Every note in it, and every new note made in it, is encrypted on disk.`, confirmAction: 'Lock folder',
		run: async (ctx) => {
			const f = folderArg(ctx.args)!;
			if (!(await ready())) return;
			await lock.lockFolder(f).then(() => new Notice(`Locked “${f.name}” and its notes.`)).catch(report);
		},
	});
	add({
		id: 'app:remove-folder-lock', name: 'Remove lock from folder', icon: 'lock-open',
		when: (ctx) => { const f = folderArg(ctx.args); return !!f && lock.isFolderLocked(f) && lock.lockedFolders.includes(f.path); },
		confirm: (ctx) => `Decrypt every note in “${folderArg(ctx.args)?.name}” on disk? Other apps will be able to read them again.`, confirmAction: 'Remove lock', danger: true,
		run: async (ctx) => {
			const f = folderArg(ctx.args)!;
			if (!(await promptUnlock(app))) return;
			await lock.removeFolderLock(f).then(() => new Notice(`“${f.name}” is no longer locked.`)).catch(report);
		},
	});

	// The status bar: the lock's state, once locking is set up; click to lock or unlock.
	const item = app.statusBarEl.createDiv({ cls: 'status-bar-item mod-clickable lock-indicator' });
	const paint = () => {
		item.toggle(lock.isSetUp);
		item.empty();
		setIcon(item, lock.isUnlocked ? 'lock-open' : 'lock');
		item.setAttribute('aria-label', lock.isUnlocked ? 'Unlocked: click to lock' : 'Locked: click to unlock');
		item.toggleClass('is-unlocked', lock.isUnlocked);
	};
	item.addEventListener('click', () => { void (lock.isUnlocked ? lock.lock() : promptUnlock(app)); });
	lock.on('unlocked', paint);
	lock.on('locked', paint);
	paint();
	app.on('config-changed', () => paint());

	// Auto-lock: after idle time, and when the computer sleeps or its screen locks.
	let last = Date.now();
	const touch = () => { last = Date.now(); };
	for (const ev of ['keydown', 'mousedown', 'wheel', 'pointermove', 'touchstart'] as const) window.addEventListener(ev, touch, { capture: true, passive: true });
	window.setInterval(() => {
		const minutes = Number(app.config.lockIdleMinutes ?? 15);
		if (lock.isUnlocked && minutes > 0 && Date.now() - last > minutes * 60_000) void lock.lock().then(() => new Notice('Locked after being idle.'));
	}, 15_000);
	app.host.app.onSystemLock?.(() => { if (lock.isUnlocked && app.config.lockOnSleep !== false) void lock.lock(); });
	// iPhone and iPad: the app switcher's picture of the window is taken as the app leaves, before the lock lands.
	const cover = app.host.app.setCoverInBackground;
	if (cover) {
		let was: boolean | null = null;
		const tell = () => {
			const on = lock.isUnlocked && app.config.lockOnSleep !== false;
			if (on !== was) cover.call(app.host.app, on);
			was = on;
		};
		lock.on('unlocked', tell);
		lock.on('locked', tell);
		app.on('config-changed', tell);
		tell();
	}
}
