import { describe, expect, it } from 'vitest';
import { conflictCopyPath } from '../src/vault';
import { isConflict } from '../src/host';

describe('conflict copies', () => {
	const when = new Date(2026, 10, 27, 9, 5);
	it('sit beside the note, with the date and time', () => {
		expect(conflictCopyPath('Torts/Duty of care.md', when, () => false)).toBe('Torts/Duty of care (conflict 2026-11-27 09.05).md');
		expect(conflictCopyPath('Welcome.md', when, () => false)).toBe('Welcome (conflict 2026-11-27 09.05).md');
		expect(conflictCopyPath('Notes/README', when, () => false)).toBe('Notes/README (conflict 2026-11-27 09.05)');
		expect(conflictCopyPath('a.b/c.v2.md', when, () => false)).toBe('a.b/c.v2 (conflict 2026-11-27 09.05).md');
	});
	it('are numbered when the name is taken', () => {
		const taken = new Set(['A (conflict 2026-11-27 09.05).md', 'A (conflict 2026-11-27 09.05 2).md']);
		expect(conflictCopyPath('A.md', when, (p) => taken.has(p))).toBe('A (conflict 2026-11-27 09.05 3).md');
	});
	it('are made only for a write the host refused as a conflict', () => {
		expect(isConflict(Object.assign(new Error('changed'), { code: 'conflict' }))).toBe(true);
		expect(isConflict(new Error('conflict: changed'))).toBe(false);
		expect(isConflict(null)).toBe(false);
	});
});
