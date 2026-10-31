import { fixtureBuffer } from '../../../../../tests/setup/fixtures';
import { excelSerialToDate, formatCellValue, isDateFormat, splitSections } from './numberFormat';
import { parseRef, readWorkbook } from './xlsxReader';

describe('number formats', () => {
  it.each([
    [1234.5, 'General', '1234.5'],
    [1234, 'General', '1234'],
    [0.1 + 0.2, 'General', '0.3'],
    [123456789012345, 'General', '1.23457E+14'],
    [1234.567, '0', '1235'],
    [1234.567, '0.00', '1234.57'],
    [1234567.891, '#,##0', '1,234,568'],
    [1234567.891, '#,##0.00', '1,234,567.89'],
    [0.256, '0%', '26%'],
    [0.2567, '0.0%', '25.7%'],
    [12345, '0.00E+00', '1.23E+04'],
    [0.00012, '0.00E+00', '1.20E-04'],
    [0, '0.00E+00', '0.00E+00'],
    [1234.5, '"$"#,##0.00', '$1,234.50'],
    [1234.5, '\\$#,##0.00', '$1,234.50'],
    [-1234.5, '#,##0.00;(#,##0.00)', '(1,234.50)'],
    [-1234.5, '#,##0.00', '-1,234.50'],
    [0, '#,##0.00;(#,##0.00);"-"', '-'],
    [1500000, '#,##0,', '1,500'],
    [1500000, '0.0,,"M"', '1.5M'],
    [42.5, '[$€-407] #,##0.00', '€ 42.50'],
    [5, '[Red]0;[Blue]-0', '5'],
    [3.14159, '#.##', '3.14'],
    [3, '#.##', '3.'],
    [0.5, '#.00', '.50'],
    [7, '000', '007'],
    [46037, 'yyyy-mm-dd', '2026-01-15'],
    [46037, 'yyyy\\-mm\\-dd', '2026-01-15'],
    [46037, 'm/d/yyyy', '1/15/2026'],
    [46037, 'd-mmm-yy', '15-Jan-26'],
    [46037, 'dddd, mmmm d', 'Thursday, January 15'],
    [46037.75, 'h:mm AM/PM', '6:00 PM'],
    [46037.5, 'hh:mm:ss', '12:00:00'],
    [46037.0007, 'h:mm', '0:01'],
    [1.5, '[h]:mm:ss', '36:00:00'],
    [46037, 'mmmmm', 'J'],
  ])('%p with %p → %p', (value, fmt, expected) => {
    expect(formatCellValue(value, fmt)).toBe(expected);
  });

  it('handles text, booleans and sections', () => {
    expect(formatCellValue('abc', '@')).toBe('abc');
    expect(formatCellValue('abc', '0;0;0;"Text: "@')).toBe('Text: abc');
    expect(formatCellValue('abc', '0.00')).toBe('abc');
    expect(formatCellValue(true, 'General')).toBe('TRUE');
    expect(formatCellValue(false, 'General')).toBe('FALSE');
    expect(formatCellValue(null, 'General')).toBe('');
    expect(formatCellValue(5, '"fixed"')).toBe('fixed');
    expect(formatCellValue(Infinity, '0')).toBe('Infinity');
    expect(splitSections('0;"a;b";[>1]0')).toEqual(['0', '"a;b"', '[>1]0']);
    expect(isDateFormat('General')).toBe(false);
    expect(isDateFormat('"Day" 0')).toBe(false);
    expect(isDateFormat('[h]:mm')).toBe(true);
    expect(isDateFormat('0.00E+00')).toBe(false);
    expect(excelSerialToDate(1, true).toISOString()).toBe('1904-01-02T00:00:00.000Z');
    expect(excelSerialToDate(59).toISOString()).toBe('1900-02-28T00:00:00.000Z');
  });
});

describe('xlsx reader', () => {
  it('reads the budget fixture', () => {
    const wb = readWorkbook(fixtureBuffer('budget.xlsx'));
    expect(wb.sheets.map((s) => [s.name, s.state])).toEqual([
      ['Budget', 'visible'],
      ['Timeline', 'visible'],
      ['Hidden', 'hidden'],
      ['Grid', 'visible'],
    ]);
    const budget = wb.readSheet(0);
    expect(budget.rows.get(0)!.get(0)!.text).toBe('FY2026 Budget');
    expect(budget.rows.get(0)!.get(0)!.style).toMatchObject({ fontWeight: 700, color: '#FFFFFF', backgroundColor: '#1E3A8A' });
    expect(budget.merges).toContainEqual({ r1: 0, c1: 0, r2: 0, c2: 3 });
    const variance = budget.rows.get(2)!.get(3)!;
    expect(variance.formula).toBe('C3-B3');
    expect(variance.text).toBe('-$1,500.00');
    expect(budget.rows.get(7)!.get(1)!.text).toBe('$177,000.00');
    expect(budget.rows.get(9)!.get(1)!.text).toBe('100.9%');
    expect(budget.colWidths.get(0)).toBeGreaterThan(100);
    expect(wb.readSheet(0)).toBe(budget); // cached

    const timeline = wb.readSheet(1);
    expect(timeline.rows.get(1)!.get(1)!.text).toBe('2026-01-15');
    expect(timeline.rows.get(1)!.get(2)!.text).toBe('TRUE');
    expect(timeline.merges).toContainEqual({ r1: 6, c1: 0, r2: 7, c2: 2 });

    const grid = wb.readSheet(3);
    expect(grid.rowCount).toBe(200);
    expect(grid.colCount).toBe(26);
    expect(grid.rows.get(4)!.get(2)!.text).toBe('needle');
    expect(() => wb.readSheet(9)).toThrow(/does not exist/);
  });

  it('rejects malformed archives', () => {
    expect(() => readWorkbook(fixtureBuffer('malformed.xlsx'))).toThrow(/not a valid XLSX/);
    expect(() => readWorkbook(fixtureBuffer('proposal.docx'))).toThrow(/does not contain a workbook/);
  });

  it('parses cell references', () => {
    expect(parseRef('A1')).toEqual({ row: 0, col: 0 });
    expect(parseRef('$AB$12')).toEqual({ row: 11, col: 27 });
    expect(parseRef('bad')).toEqual({ row: -1, col: -1 });
  });
});
