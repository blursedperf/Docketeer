import { describe, expect, it } from 'vitest';
import { cycleHeading, toggleTask } from '../src/renderer/line-edits';

describe('toggleTask', () => {
	it('makes a line a task, then done, then open again', () => {
		expect(toggleTask('Read Donoghue')).toBe('- [ ] Read Donoghue');
		expect(toggleTask('- [ ] Read Donoghue')).toBe('- [x] Read Donoghue');
		expect(toggleTask('- [x] Read Donoghue')).toBe('- [ ] Read Donoghue');
		expect(toggleTask('- [X] Read Donoghue')).toBe('- [ ] Read Donoghue');
	});
	it('keeps indents and bullets, and turns a list item into a task', () => {
		expect(toggleTask('\t* Brief it')).toBe('\t* [ ] Brief it');
		expect(toggleTask('  - [ ] Brief it')).toBe('  - [x] Brief it');
		expect(toggleTask('  Brief it')).toBe('  - [ ] Brief it');
		expect(toggleTask('')).toBe('- [ ] ');
	});
});

describe('cycleHeading', () => {
	it('goes one level deeper each time, then back to text', () => {
		expect(cycleHeading('Duty of care')).toBe('# Duty of care');
		expect(cycleHeading('# Duty of care')).toBe('## Duty of care');
		expect(cycleHeading('## Duty of care')).toBe('### Duty of care');
		expect(cycleHeading('### Duty of care')).toBe('Duty of care');
		expect(cycleHeading('###### Deep')).toBe('Deep');
		expect(cycleHeading('#hashtag')).toBe('# #hashtag');
	});
});
