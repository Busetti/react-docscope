import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import CsvRenderer from '../csv/CsvRenderer';
import XlsxRenderer from '../xlsx/XlsxRenderer';
import { DataGrid, columnLabel } from '../shared/DataGrid';
import { delimiterLabel, detectHeader, looksNumeric, searchRows } from '../csv/csvModel';
import {
  decodeXml,
  parseAttrs,
  richText,
  scanElements,
  scanRows,
  scanSharedStrings,
} from '../xlsx/xmlScan';
import { lastCall, renderRenderer } from '../../../../../tests/setup/renderer-harness';

describe('CsvRenderer', () => {
  it('parses with header detection, numeric alignment and status bar', async () => {
    const r = renderRenderer(CsvRenderer, { name: 'customers.csv', fixture: 'customers.csv' });
    await r.ready();
    const grid = await screen.findByRole('grid', { name: 'customers.csv' });
    expect(within(grid).getByRole('columnheader', { name: 'email' })).toBeInTheDocument();
    expect(within(grid).getByText('customer1@example.com')).toBeInTheDocument();
    const amount = within(grid).getByText('13.75');
    expect(amount).toHaveStyle({ justifyContent: 'flex-end' });
    await waitFor(() =>
      expect(screen.getByText(/251 rows · 5 columns · comma delimited/)).toBeInTheDocument(),
    );
    // quoted delimiter inside a field
    r.update({}, { query: 'quote, inc', activeIndex: 0 });
    await waitFor(() => expect(lastCall(r.host.setSearchResults)[0]).toBe(1));
    r.update({}, { query: 'customer3@', activeIndex: 0 });
    await waitFor(() =>
      expect(grid.querySelector('.dsc-cell--active')).toHaveTextContent('customer3@example.com'),
    );
    // header toggle
    fireEvent.click(screen.getByRole('checkbox', { name: 'First row is header' }));
    expect(within(grid).getByRole('columnheader', { name: 'A' })).toBeInTheDocument();
    expect(screen.getByText(/252 rows/)).toBeInTheDocument();
  });

  it('detects semicolons and honours tsv / configured delimiters', async () => {
    const r = renderRenderer(CsvRenderer, {
      name: 'orders-semicolon.csv',
      fixture: 'orders-semicolon.csv',
    });
    await r.ready();
    await waitFor(() => expect(screen.getByText(/semicolon delimited/)).toBeInTheDocument());
    r.unmount();
    const t = renderRenderer(CsvRenderer, { name: 'metrics.tsv', fixture: 'metrics.tsv' });
    await t.ready();
    await waitFor(() => expect(screen.getByText(/tab delimited/)).toBeInTheDocument());
    t.unmount();
    const c = renderRenderer(CsvRenderer, {
      name: 'x.csv',
      blob: new Blob(['a|b\n1|2\n']),
      config: { csv: { delimiter: '|', header: false } },
    });
    await c.ready();
    await waitFor(() => expect(screen.getByText(/pipe delimited/)).toBeInTheDocument());
    expect(screen.getByRole('columnheader', { name: 'A' })).toBeInTheDocument();
  });

  it('reports empty files', async () => {
    const r = renderRenderer(CsvRenderer, { name: 'empty.csv', blob: new Blob([]) });
    await r.failed();
    expect(r.host.setError).toHaveBeenCalledWith('EMPTY_DOCUMENT', expect.any(String));
    const ws = renderRenderer(CsvRenderer, { name: 'ws.csv', blob: new Blob(['\n\n']) });
    await ws.failed();
  });

  it('csv helpers', () => {
    expect(looksNumeric('1,234.50')).toBe(true);
    expect(looksNumeric('$12')).toBe(true);
    expect(looksNumeric('12%')).toBe(true);
    expect(looksNumeric('abc')).toBe(false);
    expect(looksNumeric('')).toBe(false);
    expect(
      detectHeader([
        ['a', 'b'],
        ['1', '2'],
      ]),
    ).toBe(true);
    expect(
      detectHeader([
        ['a', 'a'],
        ['1', '2'],
      ]),
    ).toBe(false);
    expect(
      detectHeader([
        ['1', 'b'],
        ['1', '2'],
      ]),
    ).toBe(false);
    expect(detectHeader([['a', '']])).toBe(false);
    expect(detectHeader([])).toBe(false);
    expect(delimiterLabel('|')).toBe('pipe');
    expect(delimiterLabel('#')).toBe('"#"');
    expect(searchRows([['h'], ['x'], ['xx']], 1, 'x', false, 1)).toEqual([{ row: 0, col: 0 }]);
    expect(searchRows([['x']], 0, ' ', false)).toEqual([]);
  });
});

describe('XlsxRenderer', () => {
  it('renders the workbook read-only with sheet tabs', async () => {
    const r = renderRenderer(XlsxRenderer, { name: 'budget.xlsx', fixture: 'budget.xlsx' });
    await r.ready();
    const grid = await screen.findByRole('grid', { name: 'budget.xlsx — Budget' });
    expect(grid).toHaveAttribute('aria-readonly', 'true');
    expect(within(grid).getByText('FY2026 Budget')).toHaveClass('dsc-cell--merged');
    expect(within(grid).getByText('$177,000.00')).toBeInTheDocument();
    expect(within(grid).getByText('-$1,500.00')).toHaveAttribute('title', '=C3-B3 → -$1,500.00');
    // no editing affordances
    expect(grid.querySelector('input, textarea, [contenteditable="true"]')).toBeNull();
    const tabs = screen.getByRole('tablist', { name: 'Worksheets' });
    expect(
      within(tabs)
        .getAllByRole('tab')
        .map((t) => t.textContent),
    ).toEqual(['Budget', 'Timeline', 'Grid']);
    expect(screen.getByText('1 hidden sheet')).toBeInTheDocument();
    expect(screen.getByText('Read-only')).toBeInTheDocument();
    fireEvent.click(within(tabs).getByRole('tab', { name: 'Grid' }));
    const grid2 = await screen.findByRole('grid', { name: 'budget.xlsx — Grid' });
    r.update({ zoom: 1.5 }, { query: 'needle', activeIndex: 0 });
    await waitFor(() => expect(lastCall(r.host.setSearchResults)[0]).toBe(1));
    expect(grid2).toHaveStyle({ fontSize: `${12.5 * 1.5}px` });
  });

  it('reports malformed workbooks', async () => {
    const r = renderRenderer(XlsxRenderer, { name: 'malformed.xlsx', fixture: 'malformed.xlsx' });
    await r.failed();
    expect(r.host.setError).toHaveBeenCalledWith(
      'MALFORMED_DOCUMENT',
      expect.stringMatching(/XLSX/),
    );
  });

  it('scans SpreadsheetML strings', () => {
    expect(decodeXml('a &amp; b &lt;c&gt; &quot;d&quot; &apos;e&apos; &#65;&#x42; &bogus;')).toBe(
      `a & b <c> "d" 'e' AB &bogus;`,
    );
    expect(decodeXml('plain')).toBe('plain');
    expect(parseAttrs(`r="A1" s='2' x:y="z"`)).toEqual({ r: 'A1', s: '2', 'x:y': 'z' });
    expect(
      richText('<r><t>a</t></r><rPh><t>skip</t></rPh><r><t xml:space="preserve"> b</t></r><t/>'),
    ).toBe('a b');
    expect(scanSharedStrings('<sst><si><t>x</t></si><si/><x:si><x:t>y</x:t></x:si></sst>')).toEqual(
      ['x', '', 'y'],
    );
    const rows = [
      ...scanRows(
        '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>hi</t></is></c><c r="B1"><f>A1</f><v>3</v></c><c r="C1"/></row><row r="2"/></sheetData></worksheet>',
      ),
    ];
    expect(rows).toHaveLength(2);
    expect(rows[0]!.cells[0]).toMatchObject({ inline: 'hi', value: null });
    expect(rows[0]!.cells[1]).toMatchObject({ formula: 'A1', value: '3' });
    expect(rows[0]!.cells[2]).toMatchObject({ formula: null, value: null });
    expect([...scanRows('<worksheet/>')]).toEqual([]);
    expect(scanElements('<cols><col min="1" max="2"/></cols>', 'col')).toEqual([
      { min: '1', max: '2' },
    ]);
  });
});

describe('DataGrid', () => {
  it('renders merges anchored outside the viewport and labels columns', () => {
    render(
      <DataGrid
        rowCount={5}
        colCount={3}
        getCell={(r, c) => (r === 0 && c === 0 ? { text: 'merged' } : { text: `${r}-${c}` })}
        colHeader={columnLabel}
        merges={[{ r1: 0, c1: 0, r2: 1, c2: 2 }]}
        matches={new Set(['2:1'])}
        activeCell={{ row: 2, col: 1 }}
        zoom={1}
        label="grid"
      />,
    );
    const grid = screen.getByRole('grid', { name: 'grid' });
    expect(within(grid).getByText('merged')).toHaveClass('dsc-cell--merged');
    expect(within(grid).queryByText('0-1')).toBeNull(); // covered by the merge
    expect(within(grid).getByText('2-1')).toHaveClass('dsc-cell--match', 'dsc-cell--active');
    expect(within(grid).getAllByRole('row').length).toBeGreaterThan(1);
    expect(columnLabel(0)).toBe('A');
    expect(columnLabel(25)).toBe('Z');
    expect(columnLabel(26)).toBe('AA');
    expect(columnLabel(701)).toBe('ZZ');
  });
});
