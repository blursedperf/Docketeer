/** What the user decided about unsure authorities (confirmed, merged), kept in .quire/authorities.json. */
import type { App, AuthorityDecisions } from '@quire/api';

export class AuthorityStore {
	data: Required<AuthorityDecisions> = { confirmed: [], merges: {} };
	private loaded = false;
	constructor(private app: App) {}
	private get path() { return `${this.app.vault.configDir}/authorities.json`; }

	async load(): Promise<Required<AuthorityDecisions>> {
		if (this.loaded) return this.data;
		this.loaded = true;
		try {
			if (await this.app.vault.adapter.exists(this.path)) {
				const d = JSON.parse(await this.app.vault.adapter.read(this.path)) as AuthorityDecisions;
				this.data = { confirmed: Array.isArray(d.confirmed) ? d.confirmed : [], merges: d.merges && typeof d.merges === 'object' ? d.merges : {} };
			}
		} catch {
			console.error('Could not read the authorities file');
		}
		return this.data;
	}

	async confirm(key: string): Promise<void> {
		if (!this.data.confirmed.includes(key)) this.data.confirmed.push(key);
		await this.save();
	}

	async merge(from: string, into: string): Promise<void> {
		this.data.merges[from] = into;
		await this.save();
	}

	private save(): Promise<void> {
		return this.app.vault.adapter.write(this.path, JSON.stringify(this.data, null, '\t'));
	}
}
