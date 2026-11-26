import { describe, expect, it } from 'vitest';
import { editFrontmatter } from '../src/properties-editor';
import { propertyType } from '../src/metadata';

describe('editing properties keeps the YAML as written', () => {
	const yaml = '# where it came from\ntitle: Duty of care\ntags:\n  - torts\n  - negligence\ndue: 2026-11-30\n';
	it('sets a value in its place, keeping comments and order', () => {
		expect(editFrontmatter(yaml, { op: 'set', key: 'title', value: 'Breach' })).toBe('# where it came from\ntitle: Breach\ntags:\n  - torts\n  - negligence\ndue: 2026-11-30\n');
	});
	it('adds a property at the end; an empty value is written as nothing', () => {
		expect(editFrontmatter(yaml, { op: 'set', key: 'status', value: null })).toBe(`${yaml}status:\n`);
		expect(editFrontmatter('', { op: 'set', key: 'tags', value: ['a'] })).toBe('tags:\n  - a\n');
	});
	it('renames in place, and refuses a name already used', () => {
		expect(editFrontmatter(yaml, { op: 'rename', from: 'due', to: 'deadline' })).toBe(yaml.replace('due:', 'deadline:'));
		expect(() => editFrontmatter(yaml, { op: 'rename', from: 'due', to: 'title' })).toThrow();
	});
	it('removes a property; removing the last leaves nothing', () => {
		expect(editFrontmatter(yaml, { op: 'delete', key: 'tags' })).toBe('# where it came from\ntitle: Duty of care\ndue: 2026-11-30\n');
		expect(editFrontmatter('a: 1\n', { op: 'delete', key: 'a' })).toBe('');
	});
	it('refuses YAML that does not parse', () => {
		expect(() => editFrontmatter('a: [1, 2\n', { op: 'set', key: 'b', value: 1 })).toThrow();
	});
	it('knows a value by its kind', () => {
		expect([propertyType(['x']), propertyType(true), propertyType(3), propertyType('2026-01-02'), propertyType('text'), propertyType(null)])
			.toEqual(['list', 'checkbox', 'number', 'date', 'text', 'text']);
	});
});
