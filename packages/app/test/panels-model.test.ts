import { describe, expect, it } from 'vitest';
import { describeElement, elementHeading, moveItem, newPanelId, parsePanelsConfig } from '../src/renderer/docket/panels-model';

describe('panels.json', () => {
	it('reads panels, elements, order and hidden', () => {
		const c = parsePanelsConfig(JSON.stringify({
			panels: [{ id: 'my-week', title: ' My week ', icon: 'calendar', elements: [
				{ type: 'notes', rule: { kind: 'tag', tag: '#week' }, limit: 5 },
				{ type: 'commands', commands: ['app:new-note', 3, 'media:insert-timestamp'] },
				{ type: 'files', folder: '/Torts/' },
				{ type: 'section', panel: 'core:outline' },
			] }],
			order: ['core:units', 'custom:my-week', 'core:units'],
			hidden: ['core:cite'],
		}));
		expect(c.panels).toEqual([{ id: 'my-week', title: 'My week', icon: 'calendar', elements: [
			{ type: 'notes', rule: { kind: 'tag', tag: 'week' }, limit: 5 },
			{ type: 'commands', commands: ['app:new-note', 'media:insert-timestamp'] },
			{ type: 'files', folder: 'Torts' },
			{ type: 'section', panel: 'core:outline' },
		] }]);
		expect(c.order).toEqual(['core:units', 'custom:my-week']);
		expect(c.hidden).toEqual(['core:cite']);
	});
	it('leaves out what it does not understand, and survives a broken file', () => {
		const c = parsePanelsConfig(JSON.stringify({ panels: [
			{ id: 'Bad Id', title: 'x' }, { id: 'ok', title: '' }, { id: 'dup', title: 'A' }, { id: 'dup', title: 'B' },
			{ id: 'el', title: 'Elements', elements: [{ type: 'chart' }, { type: 'section', panel: 'custom:loop' }, { type: 'notes', rule: { kind: 'search', query: '  ' } }, { type: 'notes', rule: { kind: 'recent' } }] },
		] }));
		expect(c.panels.map((p) => p.id)).toEqual(['dup', 'el']);
		expect(c.panels[1]!.elements).toEqual([{ type: 'notes', rule: { kind: 'recent' } }]);
		expect(parsePanelsConfig('{nope')).toEqual({ panels: [], order: [], hidden: [] });
	});
});

describe('panel helpers', () => {
	it('makes ids from titles, not taken', () => {
		expect(newPanelId('My week', [])).toBe('my-week');
		expect(newPanelId('My week', ['my-week', 'my-week-2'])).toBe('my-week-3');
		expect(newPanelId('Café ☕', [])).toBe('cafe');
		expect(newPanelId('!!!', [])).toBe('panel');
	});
	it('describes elements in words', () => {
		const title = (id: string) => (id === 'core:outline' ? 'Outline' : null);
		expect(describeElement({ type: 'commands', commands: ['a'] }, title)).toBe('Commands: 1 command');
		expect(describeElement({ type: 'files', folder: 'Torts/Negligence' }, title)).toBe('File tree: Torts › Negligence');
		expect(describeElement({ type: 'notes', rule: { kind: 'tag', tag: 'week' }, limit: 5 }, title)).toBe('Note list: Notes tagged #week (up to 5)');
		expect(elementHeading({ type: 'section', panel: 'core:outline' }, title)).toBe('Outline');
		expect(elementHeading({ type: 'files', folder: 'Torts/Negligence', title: 'Cases' }, title)).toBe('Cases');
	});
	it('moves items within bounds', () => {
		expect(moveItem(['a', 'b', 'c'], 0, 1)).toEqual(['b', 'a', 'c']);
		expect(moveItem(['a', 'b', 'c'], 2, 5)).toEqual(['a', 'b', 'c']);
		expect(moveItem(['a', 'b', 'c'], 2, -1)).toEqual(['a', 'c', 'b']);
	});
});
