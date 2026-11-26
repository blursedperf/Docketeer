import { describe, expect, it } from 'vitest';
import { evaluate, formatNumber, looksLikeMath, prettyExpression } from '../src/renderer/calc';
import { calculatorItems } from '../src/renderer/slash';

describe('the / menu calculator', () => {
	it('works out arithmetic in the usual order', () => {
		expect(evaluate('12*3.5+4')).toBe(46);
		expect(evaluate('(1200-300)/3')).toBe(300);
		expect(evaluate('2^3^2')).toBe(512);
		expect(evaluate('-2^2')).toBe(-4);
		expect(evaluate('2(3+4)')).toBe(14);
		expect(evaluate('3 x 4 × 2 ÷ 6')).toBe(4);
		expect(evaluate('1,250 + 750')).toBe(2000);
		expect(evaluate('15% of 80')).toBe(12);
		expect(evaluate('sqrt(16) + abs(-2)')).toBe(6);
		expect(evaluate('2 * pi')).toBeCloseTo(6.2831853, 6);
	});
	it('refuses what is not arithmetic, or has no answer', () => {
		for (const s of ['tab', 'h2', '1/0', '2+', '(3', 'alert(1)', '3 apples', '']) expect(evaluate(s)).toBeNull();
	});
	it('offers itself only for a calculation', () => {
		expect(looksLikeMath('2+2')).toBe(true);
		expect(looksLikeMath('sqrt(2)')).toBe(true);
		expect(looksLikeMath('2026')).toBe(false);
		expect(looksLikeMath('h2')).toBe(false);
		expect(looksLikeMath('case brief')).toBe(false);
	});
	it('writes answers and working cleanly', () => {
		expect(formatNumber(0.1 + 0.2)).toBe('0.3');
		expect(formatNumber(1 / 3)).toBe('0.3333333333');
		expect(formatNumber(-0)).toBe('0');
		expect(prettyExpression('12*3.5+4')).toBe('12 × 3.5 + 4');
		expect(prettyExpression('(1200-300)/3')).toBe('(1200 - 300) ÷ 3');
		expect(prettyExpression('3*-2')).toBe('3 × -2');
	});
	it('gives the answer first, then the working', () => {
		const items = calculatorItems('12*3.5+4');
		expect(items.map((i) => i.name)).toEqual(['= 46', '12 × 3.5 + 4 = 46']);
		expect(items[0]!.text!({} as never)).toBe('46');
		expect(calculatorItems('table')).toEqual([]);
	});
});
