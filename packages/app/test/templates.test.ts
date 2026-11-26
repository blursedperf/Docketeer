import { describe, expect, it } from 'vitest';
import { fillTemplate, formatDate } from '../src/renderer/templates';
import { CURSOR } from '../src/renderer/slash';

const now = new Date(2026, 10, 26, 9, 5, 7); // Thursday 26 November 2026, 09:05:07

describe('templates', () => {
	it('formats dates and times', () => {
		expect(formatDate(now, 'YYYY-MM-DD')).toBe('2026-11-26');
		expect(formatDate(now, 'dddd D MMMM YYYY')).toBe('Thursday 26 November 2026');
		expect(formatDate(now, 'ddd D MMM, HH:mm:ss')).toBe('Thu 26 Nov, 09:05:07');
	});
	it('fills title, date, time and the cursor; leaves unknown names', () => {
		expect(fillTemplate('# {{title}}\n{{date}} {{time}}\n{{date:D MMMM}}\n{{cursor}}\n{{other}}', { title: 'Smith v Jones', now }))
			.toBe(`# Smith v Jones\n2026-11-26 09:05\n26 November\n${CURSOR}\n{{other}}`);
	});
	it('marks only the first {{cursor}}', () => {
		expect(fillTemplate('{{cursor}}a{{ cursor }}', { title: '', now })).toBe(`${CURSOR}a`);
	});
});
