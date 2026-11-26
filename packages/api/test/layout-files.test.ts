import { describe, expect, it } from 'vitest';
import { layoutFiles } from '../src/workspace';

describe('the pane layout, per kind of device', () => {
	it('desktop keeps workspace.json, as before', () => {
		expect(layoutFiles('.quire')).toEqual({ save: '.quire/workspace.json', read: ['.quire/workspace.json'] });
		expect(layoutFiles('.quire', 'desktop')).toEqual({ save: '.quire/workspace.json', read: ['.quire/workspace.json'] });
	});
	it('an iPad and an iPhone keep their own, and start from the desktop one', () => {
		expect(layoutFiles('.quire', 'tablet')).toEqual({ save: '.quire/workspace.ipad.json', read: ['.quire/workspace.ipad.json', '.quire/workspace.json'] });
		expect(layoutFiles('.quire', 'phone')).toEqual({ save: '.quire/workspace.iphone.json', read: ['.quire/workspace.iphone.json', '.quire/workspace.json'] });
	});
});
