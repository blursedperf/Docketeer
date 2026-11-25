import { describe, expect, it } from 'vitest';
import { addColumn, addRow, allTables, cellStart, columnAt, deleteColumn, deleteRow, formatTable, parseTable, splitRow, tableAt } from '../src/tables';

const doc = ['Intro', '', '| Case | Year |', '| --- | ---: |', '| Mabo | 1992 |', '| Wik | 1996 |', '', 'After | not a table'];

describe('tables', () => {
	it('splits rows into cells, keeping escaped pipes', () => {
		expect(splitRow('| a | b |')).toEqual(['a', 'b']);
		expect(splitRow('a | b')).toEqual(['a', 'b']);
		expect(splitRow('| a \\| b | c |')).toEqual(['a \\| b', 'c']);
	});
	it('finds the table a line is in, and every table', () => {
		expect(tableAt(doc, 4)).toEqual({ from: 2, to: 5 });
		expect(tableAt(doc, 2)).toEqual({ from: 2, to: 5 });
		expect(tableAt(doc, 7)).toBeNull();
		expect(tableAt(doc, 0)).toBeNull();
		expect(allTables(doc)).toEqual([{ from: 2, to: 5 }]);
		expect(allTables(['| a | b |', '| --- |'])).toEqual([]);
	});
	it('reads header, alignment and rows, padding short rows', () => {
		const t = parseTable(['| Case | Year | Court |', '| :-- | ---: | :-: |', '| Mabo | 1992 |']);
		expect(t.header).toEqual(['Case', 'Year', 'Court']);
		expect(t.aligns).toEqual(['left', 'right', 'center']);
		expect(t.rows).toEqual([['Mabo', '1992', '']]);
	});
	it('writes it back lined up, keeping alignment', () => {
		expect(formatTable(parseTable(doc.slice(2, 6)))).toEqual([
			'| Case | Year |',
			'| ---- | ---: |',
			'| Mabo | 1992 |',
			'| Wik  | 1996 |',
		]);
	});
	it('adds and deletes rows and columns', () => {
		const t = parseTable(doc.slice(2, 6));
		expect(addRow(t, 0).rows).toEqual([['Mabo', '1992'], ['', ''], ['Wik', '1996']]);
		expect(addRow(t, -1).rows[0]).toEqual(['', '']);
		const c = addColumn(t, 0, 'Court');
		expect(c.header).toEqual(['Case', 'Court', 'Year']);
		expect(c.aligns).toEqual([null, null, 'right']);
		expect(c.rows[0]).toEqual(['Mabo', '', '1992']);
		expect(deleteRow(t, 0).rows).toEqual([['Wik', '1996']]);
		expect(deleteColumn(t, 1).header).toEqual(['Case']);
		expect(deleteColumn(deleteColumn(t, 1), 0).header).toEqual(['Case']);
	});
	it('knows the column at a position and where a cell starts', () => {
		const line = '| Mabo | 1992 |';
		expect(columnAt(line, 2)).toBe(0);
		expect(columnAt(line, 9)).toBe(1);
		expect(cellStart(line, 0)).toBe(2);
		expect(cellStart(line, 1)).toBe(9);
		expect(cellStart(line, 5)).toBe(line.length);
	});
});
