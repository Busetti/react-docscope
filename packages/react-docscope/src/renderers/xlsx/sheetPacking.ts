import type { CSSProperties } from 'react';
import type { XlsxCell, XlsxSheet } from './xlsxReader';

/**
 * Wire format for sending a parsed sheet out of the worker. Structured-cloning
 * a Map of Maps with one object per cell costs over a second for 240k cells;
 * one JSON string with columnar arrays and a deduplicated style table clones
 * almost for free and parses in tens of milliseconds.
 */
interface Packed {
  name: string;
  rowCount: number;
  colCount: number;
  merges: XlsxSheet['merges'];
  colWidths: Array<[number, number]>;
  rowHeights: Array<[number, number]>;
  defaultColWidth: number;
  defaultRowHeight: number;
  styles: CSSProperties[];
  /** Per cell: row, col, style index (-1 = none). */
  r: number[];
  c: number[];
  s: number[];
  t: string[];
  /** Raw value; `0` in `same` marks "same as text". */
  v: Array<string | number | boolean | null>;
  same: Array<0 | 1>;
  f: Record<number, string>;
  e: number[];
}

export function packSheet(sheet: XlsxSheet): string {
  const styleIds = new Map<CSSProperties, number>();
  const p: Packed = {
    name: sheet.name,
    rowCount: sheet.rowCount,
    colCount: sheet.colCount,
    merges: sheet.merges,
    colWidths: [...sheet.colWidths],
    rowHeights: [...sheet.rowHeights],
    defaultColWidth: sheet.defaultColWidth,
    defaultRowHeight: sheet.defaultRowHeight,
    styles: [],
    r: [],
    c: [],
    s: [],
    t: [],
    v: [],
    same: [],
    f: {},
    e: [],
  };
  let i = 0;
  for (const [row, cells] of sheet.rows) {
    for (const [col, cell] of cells) {
      p.r.push(row);
      p.c.push(col);
      let sid = -1;
      if (cell.style) {
        sid = styleIds.get(cell.style) ?? -1;
        if (sid === -1) {
          sid = p.styles.length;
          styleIds.set(cell.style, sid);
          p.styles.push(cell.style);
        }
      }
      p.s.push(sid);
      p.t.push(cell.text);
      const same = cell.value === cell.text;
      p.same.push(same ? 1 : 0);
      p.v.push(same ? null : cell.value);
      if (cell.formula !== undefined) p.f[i] = cell.formula;
      if (cell.error) p.e.push(i);
      i += 1;
    }
  }
  return JSON.stringify(p);
}

export function unpackSheet(json: string): XlsxSheet {
  const p = JSON.parse(json) as Packed;
  const rows = new Map<number, Map<number, XlsxCell>>();
  const errors = new Set(p.e);
  let current: Map<number, XlsxCell> | undefined;
  let currentRow = -1;
  for (let i = 0; i < p.r.length; i += 1) {
    const row = p.r[i]!;
    if (row !== currentRow || !current) {
      currentRow = row;
      current = rows.get(row);
      if (!current) rows.set(row, (current = new Map()));
    }
    const text = p.t[i]!;
    const cell: XlsxCell = { value: p.same[i] ? text : p.v[i]!, text };
    const sid = p.s[i]!;
    if (sid !== -1) cell.style = p.styles[sid];
    const formula = p.f[i];
    if (formula !== undefined) cell.formula = formula;
    if (errors.has(i)) cell.error = true;
    current.set(p.c[i]!, cell);
  }
  return {
    name: p.name,
    rowCount: p.rowCount,
    colCount: p.colCount,
    rows,
    merges: p.merges,
    colWidths: new Map(p.colWidths),
    rowHeights: new Map(p.rowHeights),
    defaultColWidth: p.defaultColWidth,
    defaultRowHeight: p.defaultRowHeight,
  };
}
