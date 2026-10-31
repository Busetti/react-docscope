import { render, screen, waitFor } from '@testing-library/react';
import { zipSync, strToU8 } from 'fflate';
import { readWorkbook } from '../xlsx/xlsxReader';
import { SlideElement } from '../pptx/PptxRenderer';
import CsvRenderer from '../csv/CsvRenderer';
import DocxRenderer from '../docx/DocxRenderer';
import XlsxRenderer from '../xlsx/XlsxRenderer';
import PptxRenderer from '../pptx/PptxRenderer';
import JsonRenderer from '../json/JsonRenderer';
import XmlRenderer from '../xml/XmlRenderer';
import MarkdownRenderer from '../markdown/MarkdownRenderer';
import { metadataRows } from '../../components/MetadataPanel';
import { FileIcon } from '../../components/fileIcons';
import { createDefaultRegistry } from '../definitions';
import { renderRenderer } from '../../../../../tests/setup/renderer-harness';

function workbook(parts: Record<string, string>): Uint8Array {
  const files: Record<string, Uint8Array> = {};
  for (const [k, v] of Object.entries(parts)) files[k] = strToU8(v);
  return zipSync(files);
}

const WB = `<workbook xmlns="m" xmlns:r="rel"><workbookPr date1904="false"/><sheets>
  <sheet name="Data" sheetId="1" r:id="rId1"/><sheet name="VeryHidden" sheetId="2" state="veryHidden" r:id="rId2"/>
  <sheet name="NoRel" sheetId="3"/><sheet name="Chart" sheetId="4" r:id="rId4"/></sheets></workbook>`;
const RELS = `<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="/xl/worksheets/sheet2.xml"/>
  <Relationship Id="rId4" Target="./chartsheets/../chartsheets/sheet4.xml"/><Relationship Id="rId9" Target="theme/theme1.xml"/></Relationships>`;
const THEME = `<a:theme xmlns:a="t"><a:themeElements><a:clrScheme>
  <a:dk1><a:sysClr val="windowText" lastClr="111111"/></a:dk1><a:lt1><a:sysClr val="window"/></a:lt1>
  <a:dk2><a:srgbClr val="222222"/></a:dk2><a:lt2><a:srgbClr val="EEEEEE"/></a:lt2><a:accent1><a:srgbClr val="4472C4"/></a:accent1>
  </a:clrScheme></a:themeElements></a:theme>`;
const STYLES = `<styleSheet><numFmts><numFmt numFmtId="164" formatCode="0.0"/></numFmts>
  <fonts><font><sz val="11"/></font><font><b val="0"/><color indexed="64"/></font><font><color rgb="FF00FF00"/></font></fonts>
  <fills><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><bgColor theme="4"/></patternFill></fill><fill><gradientFill><stop><color rgb="FF123456"/></stop></gradientFill></fill></fills>
  <borders><border/><border><left style="unknown"/></border></borders>
  <cellXfs><xf numFmtId="0"/><xf numFmtId="164" fontId="1" fillId="2"/><xf numFmtId="14" fontId="2" fillId="3" borderId="1"><alignment horizontal="fill" vertical="center"/></xf><xf numFmtId="49"/></cellXfs></styleSheet>`;
const SHEET1 = `<x:worksheet xmlns:x="m"><x:sheetData>
  <x:row r="1"><x:c r="A1" t="s"><x:v>0</x:v></x:c><x:c r="B1" t="s"/><x:c t="str"><x:f>"a"&amp;"b"</x:f><x:v>ab</x:v></x:c><x:c t="b"><x:v>0</x:v></x:c></x:row>
  <x:row><x:c r="A2" t="e"><x:v>#DIV/0!</x:v></x:c><x:c r="B2" t="d" s="2"><x:v>2026-02-03T00:00:00Z</x:v></x:c><x:c r="C2" t="d"><x:v>not a date</x:v></x:c><x:c r="D2" s="1"><x:v>2.25</x:v></x:c></x:row>
  <x:row r="3"><x:c r="A3"><x:v>abc</x:v></x:c><x:c r="B3" t="e"/><x:c r="C3" t="str"/><x:c r="D3" s="3" t="s"><x:v>1</x:v></x:c><x:c r="E3" s="1"/><x:c r="F3"><x:f t="shared" si="0"/></x:c></x:row>
  </x:sheetData><x:mergeCells><x:mergeCell ref="A5"/><x:mergeCell ref="B9:A1"/></x:mergeCells></x:worksheet>`;
const SST = `<sst><si><r><t>run1</t></r><rPh><t>ruby</t></rPh><r><t>run2</t></r></si><si><t>second &amp; last</t></si></sst>`;

describe('xlsx reader edge cases', () => {
  const wb = readWorkbook(
    workbook({
      'xl/workbook.xml': WB,
      'xl/_rels/workbook.xml.rels': RELS,
      'xl/theme/theme1.xml': THEME,
      'xl/styles.xml': STYLES,
      'xl/sharedStrings.xml': SST,
      'xl/worksheets/sheet1.xml': SHEET1,
      'xl/chartsheets/sheet4.xml': '<chartsheet/>',
    }),
  );

  it('parses every cell type', () => {
    expect(wb.sheets.map((s) => [s.name, s.state, s.path])).toEqual([
      ['Data', 'visible', 'xl/worksheets/sheet1.xml'],
      ['VeryHidden', 'veryHidden', 'xl/worksheets/sheet2.xml'],
      ['NoRel', 'visible', 'xl/worksheets/sheet3.xml'],
      ['Chart', 'visible', 'xl/chartsheets/sheet4.xml'],
    ]);
    const s = wb.readSheet(0);
    const t = (r: number, c: number) => s.rows.get(r)?.get(c);
    expect(t(0, 0)!.text).toBe('run1run2');
    expect(t(0, 2)).toMatchObject({ text: 'ab', formula: '"a"&"b"' });
    expect(t(0, 3)!.text).toBe('FALSE');
    expect(t(1, 0)).toMatchObject({ text: '#DIV/0!', error: true, style: { color: '#c00' } });
    expect(t(1, 1)!.text).toBe('2/3/2026');
    expect(t(1, 2)!.text).toBe('not a date');
    expect(t(1, 3)).toMatchObject({
      text: '2.3',
      style: { backgroundColor: '#4472C4', justifyContent: 'flex-end' },
    });
    expect(t(2, 0)!.text).toBe('abc');
    expect(t(2, 1)!.text).toBe('#ERROR');
    expect(t(2, 3)!.text).toBe('second & last');
    expect(t(2, 5)!.formula).toBeUndefined();
    expect(t(1, 1)!.style).toMatchObject({
      color: '#00FF00',
      backgroundColor: '#123456',
      justifyContent: 'flex-start',
      alignItems: 'center',
    });
    expect(s.merges).toEqual([{ r1: 4, c1: 0, r2: 4, c2: 0 }]);
    expect(s.rowCount).toBe(5);
  });

  it('reports missing and non-worksheet sheets', () => {
    expect(() => wb.readSheet(1)).toThrow(/missing/);
    expect(() => wb.readSheet(3)).toThrow(/not a worksheet/);
  });

  it('handles bare workbooks without styles, theme or shared strings', () => {
    const bare = readWorkbook(
      workbook({
        'xl/workbook.xml': '<workbook><sheets><sheet/></sheets></workbook>',
        'xl/worksheets/sheet1.xml':
          '<worksheet><sheetData><row><c><v>1</v></c></row></sheetData></worksheet>',
      }),
    );
    expect(bare.sheets[0]!.name).toBe('Sheet1');
    expect(bare.readSheet(0).rows.get(0)!.get(0)!.text).toBe('1');
    expect(() => readWorkbook(workbook({ 'xl/workbook.xml': '<workbook><oops' }))).toThrow(
      /Malformed/,
    );
  });
});

describe('slide elements', () => {
  const base = { left: 0, top: 0, width: 100, height: 50 };
  it.each([
    [{ ...base, type: 'chart', chartType: 'barChart' }, /Chart \(barChart\)/],
    [{ ...base, type: 'chart' }, /Chart \(chart\)/],
    [{ ...base, type: 'video' }, /Embedded video/],
    [{ ...base, type: 'audio' }, /Embedded audio/],
    [{ ...base, type: 'math', latex: 'x^2' }, /x\^2/],
    [{ ...base, type: 'math', text: 'plain' }, /plain/],
  ])('renders placeholder for %p', (el, text) => {
    render(<SlideElement el={el as never} />);
    expect(screen.getByText(text)).toBeInTheDocument();
  });

  it('renders math images, groups, custom shapes and ignores unknown elements', () => {
    const { container } = render(
      <div>
        <SlideElement
          el={{ ...base, type: 'math', picBase64: 'data:image/png;base64,AA', latex: 'y' } as never}
        />
        <SlideElement el={{ ...base, type: 'image', base64: 'javascript:alert(1)' } as never} />
        <SlideElement
          el={
            {
              ...base,
              type: 'group',
              elements: [{ ...base, type: 'text', content: '<p>in group</p>' }],
            } as never
          }
        />
        <SlideElement el={{ ...base, type: 'diagram' } as never} />
        <SlideElement
          el={
            {
              ...base,
              type: 'shape',
              shapType: 'star5',
              path: 'M0 0L10 10',
              pathViewBox: { x: 0, y: 0, width: 10, height: 10 },
              fill: { type: 'color', value: '#f00' },
              borderWidth: 1,
              borderColor: '#000',
            } as never
          }
        />
        <SlideElement
          el={
            {
              ...base,
              type: 'shape',
              shapType: 'star5',
              path: 'M0 0',
              pathViewBox: { x: 0, y: 0, width: 1, height: 1 },
              fill: { type: 'gradient', value: { colors: [{ pos: '0%', color: 'red' }] } },
            } as never
          }
        />
        <SlideElement
          el={
            {
              ...base,
              type: 'shape',
              shapType: 'roundRect',
              vAlign: 'down',
              isVertical: true,
            } as never
          }
        />
        <SlideElement
          el={
            {
              ...base,
              type: 'table',
              data: [
                [
                  { text: 'a', colSpan: 2 },
                  { text: 'x', hMerge: 1 },
                ],
              ],
              colWidths: [10, 10],
              rowHeights: [20],
            } as never
          }
        />
        <SlideElement el={{ ...base, type: 'table' } as never} />
        <SlideElement el={{ ...base, type: 'unknown' } as never} />
      </div>,
    );
    expect(container.querySelector('img[alt="y"]')).not.toBeNull();
    expect(container.querySelectorAll('img')).toHaveLength(1);
    expect(screen.getByText('in group')).toBeInTheDocument();
    expect(container.querySelectorAll('svg path')[0]).toHaveAttribute('fill', '#f00');
    expect(container.querySelectorAll('svg path')[1]).toHaveAttribute('fill', '#ccc');
    expect(container.querySelector('td[colspan="2"]')).toHaveTextContent('a');
    expect(container.querySelectorAll('td')).toHaveLength(1);
  });
});

describe('metadata and icons', () => {
  const registry = createDefaultRegistry();
  it('formats metadata values', () => {
    const rows = metadataRows(
      {
        id: '1',
        name: 'x.bin',
        type: 'application/x-custom',
        metadata: {
          size: 2048,
          approved: true,
          tags: ['a'],
          reviewedOn: '2026-01-01T00:00:00Z',
          empty: '',
          missing: null,
        },
      },
      [
        'type',
        'name',
        'size',
        'approved',
        'tags',
        'reviewedOn',
        'empty',
        'missing',
        { key: 'size', label: 'Bytes', format: (v) => `${String(v)} B` },
      ],
      registry,
    );
    const byKey = Object.fromEntries(rows.map((r) => [r.label, r.value]));
    expect(byKey).toMatchObject({
      Type: 'application/x-custom',
      Name: 'x.bin',
      Size: '2.0 KB',
      Approved: 'Yes',
      Tags: '["a"]',
      Bytes: '2048 B',
    });
    expect(byKey['Reviewed on']).toMatch(/2026|2025/);
    expect(rows.find((r) => r.key === 'empty')).toBeUndefined();
    expect(metadataRows({ id: '2', name: 'noext' }, ['type'], registry)).toEqual([]);
    expect(metadataRows({ id: '3', name: 'a.zzz' }, ['type'], registry)[0]!.value).toBe('ZZZ');
  });

  it('renders an icon per format', () => {
    const names = [
      'a.pdf',
      'a.png',
      'a.mp4',
      'a.xlsx',
      'a.csv',
      'a.pptx',
      'a.json',
      'a.xml',
      'a.docx',
      'a.md',
      'a.txt',
      'a.bin',
    ];
    const { container } = render(
      <div>
        {names.map((n) => (
          <FileIcon key={n} document={{ id: n, name: n }} registry={registry} />
        ))}
      </div>,
    );
    expect(container.querySelectorAll('svg')).toHaveLength(names.length);
    expect(container.querySelector('.dsc-file-icon--unknown')).not.toBeNull();
  });
});

describe('renderer failure paths', () => {
  const failingFetch = (status: number) => {
    (globalThis as { fetch?: unknown }).fetch = jest.fn(async () => ({
      ok: false,
      status,
      headers: { get: () => null },
    }));
  };
  it.each([
    ['csv', CsvRenderer],
    ['docx', DocxRenderer],
    ['xlsx', XlsxRenderer],
    ['pptx', PptxRenderer],
    ['json', JsonRenderer],
    ['xml', XmlRenderer],
    ['md', MarkdownRenderer],
  ])('%s reports download failures with their real code', async (ext, Component) => {
    failingFetch(404);
    const r = renderRenderer(Component as never, {
      name: `x.${ext}`,
      resolved: { kind: 'url', url: `https://x/x.${ext}` },
    });
    await r.failed();
    expect(r.host.setError).toHaveBeenCalledWith('NOT_FOUND', expect.any(String));
  });

  it('csv cancels parsing on unmount', async () => {
    const r = renderRenderer(CsvRenderer, {
      name: 'big.csv',
      blob: new Blob([Array.from({ length: 5000 }, (_, i) => `${i},x`).join('\n')]),
    });
    r.unmount();
    await new Promise((res) => setTimeout(res, 50));
    expect(r.host.setReady).not.toHaveBeenCalled();
  });

  it('docx stops when unmounted mid-render', async () => {
    const r = renderRenderer(DocxRenderer, { name: 'proposal.docx', fixture: 'proposal.docx' });
    r.unmount();
    await waitFor(() => expect(r.host.setReady).not.toHaveBeenCalled());
  });
});
