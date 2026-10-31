import { unzipSync, strFromU8 } from 'fflate';
import type { CSSProperties } from 'react';
import { BUILTIN_FORMATS, formatCellValue, isDateFormat } from './numberFormat';
import { scanElements, scanRows, scanSharedStrings } from './xmlScan';

/**
 * Minimal, read-only XLSX (Office Open XML SpreadsheetML) reader.
 *
 * Reads: sheet list & visibility, shared/inline strings, cached values of
 * formula cells, number formats, fonts, fills, borders, alignment, merged
 * cells, column widths, row heights and hidden rows/columns.
 * It never evaluates formulas and has no write path.
 */

export interface SheetInfo {
  name: string;
  state: 'visible' | 'hidden' | 'veryHidden';
  path: string;
}

export interface XlsxCell {
  /** Raw (cached) value. */
  value: string | number | boolean | null;
  /** Formatted display text. */
  text: string;
  formula?: string;
  style?: CSSProperties;
  error?: boolean;
}

export interface XlsxSheet {
  name: string;
  rowCount: number;
  colCount: number;
  rows: Map<number, Map<number, XlsxCell>>;
  merges: Array<{ r1: number; c1: number; r2: number; c2: number }>;
  /** Column widths in px at 100%. */
  colWidths: Map<number, number>;
  rowHeights: Map<number, number>;
  defaultColWidth: number;
  defaultRowHeight: number;
}

export interface XlsxWorkbook {
  sheets: SheetInfo[];
  date1904: boolean;
  readSheet(index: number): XlsxSheet;
}

interface Xf {
  numFmt: string;
  font?: FontStyle;
  fill?: string;
  border?: CSSProperties;
  align?: { horizontal?: string; vertical?: string; wrap?: boolean; indent?: number };
}

interface FontStyle {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  size?: number;
  color?: string;
  name?: string;
}

const MAX_CELLS = 5_000_000;

/** Standard indexed colour palette (indexes 0-63). */
const INDEXED = [
  '000000',
  'FFFFFF',
  'FF0000',
  '00FF00',
  '0000FF',
  'FFFF00',
  'FF00FF',
  '00FFFF',
  '000000',
  'FFFFFF',
  'FF0000',
  '00FF00',
  '0000FF',
  'FFFF00',
  'FF00FF',
  '00FFFF',
  '800000',
  '008000',
  '000080',
  '808000',
  '800080',
  '008080',
  'C0C0C0',
  '808080',
  '9999FF',
  '993366',
  'FFFFCC',
  'CCFFFF',
  '660066',
  'FF8080',
  '0066CC',
  'CCCCFF',
  '000080',
  'FF00FF',
  'FFFF00',
  '00FFFF',
  '800080',
  '800000',
  '008080',
  '0000FF',
  '00CCFF',
  'CCFFFF',
  'CCFFCC',
  'FFFF99',
  '99CCFF',
  'FF99CC',
  'CC99FF',
  'FFCC99',
  '3366FF',
  '33CCCC',
  '99CC00',
  'FFCC00',
  'FF9900',
  'FF6600',
  '666699',
  '969696',
  '003366',
  '339966',
  '003300',
  '333300',
  '993300',
  '993366',
  '333399',
  '333333',
];

function parseXmlDoc(xml: string): Document {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('Malformed workbook XML.');
  return doc;
}

function els(parent: Element | Document, local: string): Element[] {
  return Array.from(parent.getElementsByTagNameNS('*', local));
}

function child(parent: Element, local: string): Element | undefined {
  for (const c of Array.from(parent.children)) if (c.localName === local) return c;
  return undefined;
}

function children(parent: Element, local: string): Element[] {
  return Array.from(parent.children).filter((c) => c.localName === local);
}

/** "AB12" → { row: 11, col: 27 } (zero-based). */
export function parseRef(ref: string): { row: number; col: number } {
  const m = /^\$?([A-Z]+)\$?(\d+)$/i.exec(ref.trim());
  if (!m) return { row: -1, col: -1 };
  let col = 0;
  for (const ch of m[1]!.toUpperCase()) col = col * 26 + (ch.charCodeAt(0) - 64);
  return { row: Number(m[2]) - 1, col: col - 1 };
}

function resolvePath(base: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  const parts = base.split('/').slice(0, -1);
  for (const seg of target.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg !== '.') parts.push(seg);
  }
  return parts.join('/');
}

function applyTint(hex: string, tint: number): string {
  if (!tint) return hex;
  const r = parseInt(hex.slice(0, 2), 16) / 255;
  const g = parseInt(hex.slice(2, 4), 16) / 255;
  const b = parseInt(hex.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  let l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h /= 6;
  }
  l = tint < 0 ? l * (1 + tint) : l * (1 - tint) + tint;
  const hue2rgb = (p: number, q: number, t: number) => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  let rr = l;
  let gg = l;
  let bb = l;
  if (s !== 0) {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    rr = hue2rgb(p, q, h + 1 / 3);
    gg = hue2rgb(p, q, h);
    bb = hue2rgb(p, q, h - 1 / 3);
  }
  const hex2 = (v: number) =>
    Math.round(v * 255)
      .toString(16)
      .padStart(2, '0');
  return `${hex2(rr)}${hex2(gg)}${hex2(bb)}`.toUpperCase();
}

function readColor(el: Element | undefined, theme: string[]): string | undefined {
  if (!el) return undefined;
  const rgb = el.getAttribute('rgb');
  const tint = Number(el.getAttribute('tint') ?? 0);
  let hex: string | undefined;
  if (rgb) hex = rgb.length === 8 ? rgb.slice(2) : rgb;
  else if (el.hasAttribute('theme')) hex = theme[Number(el.getAttribute('theme'))];
  else if (el.hasAttribute('indexed')) {
    const i = Number(el.getAttribute('indexed'));
    if (i === 64 || i === 65) return undefined; // system foreground/background
    hex = INDEXED[i];
  }
  if (!hex || !/^[0-9a-f]{6}$/i.test(hex)) return undefined;
  return `#${applyTint(hex, tint)}`;
}

function readTheme(files: Record<string, Uint8Array>, workbookRels: Map<string, string>): string[] {
  const themePath =
    [...workbookRels.values()].find((p) => /theme\/theme\d*\.xml$/.test(p)) ??
    'xl/theme/theme1.xml';
  const bytes = files[themePath];
  if (!bytes) return [];
  const doc = parseXmlDoc(strFromU8(bytes));
  const scheme = els(doc, 'clrScheme')[0];
  if (!scheme) return [];
  const colors = Array.from(scheme.children).map((c) => {
    const srgb = child(c, 'srgbClr')?.getAttribute('val');
    const sys = child(c, 'sysClr')?.getAttribute('lastClr');
    return (srgb || sys || '000000').toUpperCase();
  });
  // Theme index order used by cells: lt1, dk1, lt2, dk2, accent1..6, hlink, folHlink.
  const [dk1, lt1, dk2, lt2, ...rest] = colors;
  return [lt1 ?? 'FFFFFF', dk1 ?? '000000', lt2 ?? 'E7E6E6', dk2 ?? '44546A', ...rest];
}

const BORDER_WIDTH: Record<string, string> = {
  thin: '1px solid',
  hair: '1px dotted',
  dotted: '1px dotted',
  dashed: '1px dashed',
  dashDot: '1px dashed',
  dashDotDot: '1px dashed',
  medium: '2px solid',
  mediumDashed: '2px dashed',
  mediumDashDot: '2px dashed',
  mediumDashDotDot: '2px dashed',
  slantDashDot: '2px dashed',
  thick: '3px solid',
  double: '3px double',
};

function readStyles(files: Record<string, Uint8Array>, theme: string[]): Xf[] {
  const bytes = files['xl/styles.xml'];
  if (!bytes) return [];
  const doc = parseXmlDoc(strFromU8(bytes));
  const numFmts = new Map<number, string>();
  for (const nf of els(doc, 'numFmt'))
    numFmts.set(Number(nf.getAttribute('numFmtId')), nf.getAttribute('formatCode') ?? 'General');

  const fontsEl = els(doc, 'fonts')[0];
  const fonts: FontStyle[] = (fontsEl ? children(fontsEl, 'font') : []).map((f) => {
    const val = (name: string) => child(f, name);
    const flag = (name: string) => {
      const e = val(name);
      return e
        ? e.getAttribute('val') !== '0' &&
            e.getAttribute('val') !== 'false' &&
            e.getAttribute('val') !== 'none'
        : undefined;
    };
    const size = Number(val('sz')?.getAttribute('val'));
    return {
      bold: flag('b'),
      italic: flag('i'),
      underline: flag('u'),
      strike: flag('strike'),
      size: Number.isFinite(size) && size > 0 ? size : undefined,
      color: readColor(val('color'), theme),
      name: val('name')?.getAttribute('val') ?? undefined,
    };
  });

  const fillsEl = els(doc, 'fills')[0];
  const fills: Array<string | undefined> = (fillsEl ? children(fillsEl, 'fill') : []).map((f) => {
    const pf = child(f, 'patternFill');
    if (pf && pf.getAttribute('patternType') && pf.getAttribute('patternType') !== 'none') {
      return readColor(child(pf, 'fgColor'), theme) ?? readColor(child(pf, 'bgColor'), theme);
    }
    const gf = child(f, 'gradientFill');
    if (gf) return readColor(els(gf, 'color')[0], theme);
    return undefined;
  });

  const bordersEl = els(doc, 'borders')[0];
  const borders: Array<CSSProperties | undefined> = (
    bordersEl ? children(bordersEl, 'border') : []
  ).map((b) => {
    const css: CSSProperties = {};
    for (const side of ['left', 'right', 'top', 'bottom'] as const) {
      const e = child(b, side);
      const style = e?.getAttribute('style');
      if (!e || !style || !BORDER_WIDTH[style]) continue;
      const color = readColor(child(e, 'color'), theme) ?? '#000';
      const key = `border${side[0]!.toUpperCase()}${side.slice(1)}` as 'borderLeft';
      css[key] = `${BORDER_WIDTH[style]} ${color}`;
    }
    return Object.keys(css).length ? css : undefined;
  });

  const cellXfsEl = els(doc, 'cellXfs')[0];
  return (cellXfsEl ? children(cellXfsEl, 'xf') : []).map((xf) => {
    const numFmtId = Number(xf.getAttribute('numFmtId') ?? 0);
    const al = child(xf, 'alignment');
    return {
      numFmt: numFmts.get(numFmtId) ?? BUILTIN_FORMATS[numFmtId] ?? 'General',
      font: fonts[Number(xf.getAttribute('fontId') ?? 0)],
      fill: fills[Number(xf.getAttribute('fillId') ?? 0)],
      border: borders[Number(xf.getAttribute('borderId') ?? 0)],
      align: al
        ? {
            horizontal: al.getAttribute('horizontal') ?? undefined,
            vertical: al.getAttribute('vertical') ?? undefined,
            wrap: al.getAttribute('wrapText') === '1' || al.getAttribute('wrapText') === 'true',
            indent: Number(al.getAttribute('indent') ?? 0) || undefined,
          }
        : undefined,
    };
  });
}

function styleToCss(
  xf: Xf | undefined,
  baseFontSize: number,
  isNumber: boolean,
): CSSProperties | undefined {
  const css: CSSProperties = {};
  if (xf?.font) {
    const f = xf.font;
    if (f.bold) css.fontWeight = 700;
    if (f.italic) css.fontStyle = 'italic';
    const deco = [f.underline && 'underline', f.strike && 'line-through'].filter(Boolean).join(' ');
    if (deco) css.textDecoration = deco;
    if (f.color && f.color.toUpperCase() !== '#000000') css.color = f.color;
    if (f.size && Math.abs(f.size - baseFontSize) > 0.1)
      css.fontSize = `${(f.size / baseFontSize).toFixed(3)}em`;
  }
  if (xf?.fill) css.backgroundColor = xf.fill;
  if (xf?.border) Object.assign(css, xf.border);
  const h = xf?.align?.horizontal;
  if (h === 'center' || h === 'centerContinuous') css.justifyContent = 'center';
  else if (h === 'right') css.justifyContent = 'flex-end';
  else if (h === 'left' || h === 'fill' || h === 'justify') css.justifyContent = 'flex-start';
  else if (isNumber) css.justifyContent = 'flex-end';
  const v = xf?.align?.vertical;
  if (v === 'center') css.alignItems = 'center';
  else if (v === 'top') css.alignItems = 'flex-start';
  if (xf?.align?.wrap) {
    css.whiteSpace = 'pre-wrap';
    css.overflowWrap = 'anywhere';
  }
  if (xf?.align?.indent) css.paddingInlineStart = `${xf.align.indent}em`;
  return Object.keys(css).length ? css : undefined;
}

function readSharedStrings(files: Record<string, Uint8Array>): string[] {
  const bytes = files['xl/sharedStrings.xml'];
  return bytes ? scanSharedStrings(strFromU8(bytes)) : [];
}

function colWidthPx(width: number): number {
  return Math.round(width * 7 + 5);
}

/** Opens a workbook. Throws on non-zip / non-xlsx input. */
export function readWorkbook(data: ArrayBuffer | Uint8Array): XlsxWorkbook {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, {
      filter: (f) =>
        /^(xl\/|_rels\/|\[Content_Types\])/.test(f.name) &&
        !/\.(png|jpe?g|gif|emf|wmf|bin)$/i.test(f.name),
    });
  } catch {
    throw new Error('The file is not a valid XLSX archive.');
  }
  const wbBytes = files['xl/workbook.xml'];
  if (!wbBytes) throw new Error('The archive does not contain a workbook.');
  const wbDoc = parseXmlDoc(strFromU8(wbBytes));

  const rels = new Map<string, string>();
  const relBytes = files['xl/_rels/workbook.xml.rels'];
  if (relBytes) {
    for (const r of els(parseXmlDoc(strFromU8(relBytes)), 'Relationship')) {
      rels.set(
        r.getAttribute('Id') ?? '',
        resolvePath('xl/workbook.xml', r.getAttribute('Target') ?? ''),
      );
    }
  }
  const date1904 = ['1', 'true'].includes(
    els(wbDoc, 'workbookPr')[0]?.getAttribute('date1904') ?? '',
  );
  const sheets: SheetInfo[] = els(wbDoc, 'sheet').map((s, i) => {
    const rid =
      s.getAttribute('r:id') ??
      s.getAttributeNS(
        'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
        'id',
      ) ??
      '';
    const state = s.getAttribute('state');
    return {
      name: s.getAttribute('name') ?? `Sheet${i + 1}`,
      state: state === 'hidden' || state === 'veryHidden' ? state : 'visible',
      path: rels.get(rid) ?? `xl/worksheets/sheet${i + 1}.xml`,
    };
  });

  const theme = readTheme(files, rels);
  const xfs = readStyles(files, theme);
  const shared = readSharedStrings(files);
  const baseFont = xfs[0]?.font?.size ?? 11;
  const cache = new Map<number, XlsxSheet>();
  // Cell styles are shared objects: compute each (style, numeric) combination once.
  const styleCache = new Map<string, CSSProperties | undefined>();
  const cssFor = (s: number, isNumber: boolean): CSSProperties | undefined => {
    const key = `${s}|${isNumber ? 1 : 0}`;
    if (!styleCache.has(key)) styleCache.set(key, styleToCss(xfs[s], baseFont, isNumber));
    return styleCache.get(key);
  };

  const readSheet = (index: number): XlsxSheet => {
    const hit = cache.get(index);
    if (hit) return hit;
    const info = sheets[index];
    if (!info) throw new Error(`Sheet ${index} does not exist.`);
    const bytesForSheet = files[info.path];
    if (!bytesForSheet) throw new Error(`Sheet "${info.name}" is missing from the archive.`);
    const xml = strFromU8(bytesForSheet);
    if (!/<(?:\w+:)?worksheet\b/.test(xml))
      throw new Error(`Sheet "${info.name}" is not a worksheet (chart sheets are not supported).`);
    const rows = new Map<number, Map<number, XlsxCell>>();
    const rowHeights = new Map<number, number>();
    const colWidths = new Map<number, number>();
    let maxRow = -1;
    let maxCol = -1;
    let cellCount = 0;
    const truthy = (v: string | undefined) => v === '1' || v === 'true';

    const fmtPr = scanElements(xml, 'sheetFormatPr')[0];
    const defaultColWidth = fmtPr?.defaultColWidth ? colWidthPx(Number(fmtPr.defaultColWidth)) : 64;
    const defaultRowHeight = fmtPr?.defaultRowHeight
      ? Math.round((Number(fmtPr.defaultRowHeight) * 4) / 3)
      : 20;

    for (const col of scanElements(xml, 'col')) {
      const min = Number(col.min);
      const max = Math.min(Number(col.max), min + 16384);
      const width = Number(col.width);
      for (let c = min - 1; c < max; c += 1) {
        if (truthy(col.hidden)) colWidths.set(c, 0);
        else if (col.width !== undefined && Number.isFinite(width))
          colWidths.set(c, colWidthPx(width));
      }
    }

    let implicitRow = -1;
    for (const rowEl of scanRows(xml)) {
      const r = rowEl.attrs.r ? Number(rowEl.attrs.r) - 1 : implicitRow + 1;
      implicitRow = r;
      if (truthy(rowEl.attrs.hidden)) rowHeights.set(r, 0);
      else if (rowEl.attrs.ht && rowEl.attrs.customHeight !== '0') {
        rowHeights.set(r, Math.round((Number(rowEl.attrs.ht) * 4) / 3));
      }
      let implicitCol = -1;
      for (const c of rowEl.cells) {
        const ref = c.attrs.r;
        const pos = ref ? parseRef(ref) : { row: r, col: implicitCol + 1 };
        implicitCol = pos.col;
        const t = c.attrs.t ?? 'n';
        const s = Number(c.attrs.s ?? 0);
        const raw = c.value;
        const hasFormula = c.formula !== null;
        const xf = xfs[s];
        let value: XlsxCell['value'] = null;
        let text = '';
        let isNumber = false;
        let error = false;
        switch (t) {
          case 's':
            value = raw !== null ? (shared[Number(raw)] ?? '') : '';
            text = formatCellValue(value, xf?.numFmt ?? 'General');
            break;
          case 'inlineStr':
            value = c.inline ?? raw ?? '';
            text = value;
            break;
          case 'str':
            value = raw ?? '';
            text = value;
            break;
          case 'b':
            value = raw === '1' || raw === 'true';
            text = value ? 'TRUE' : 'FALSE';
            break;
          case 'e':
            value = raw ?? '#ERROR';
            text = value;
            error = true;
            break;
          case 'd': {
            value = raw ?? '';
            const d = new Date(value);
            if (!Number.isNaN(d.getTime()) && xf && isDateFormat(xf.numFmt)) {
              const serial = d.getTime() / 86400000 + 25569;
              text = formatCellValue(serial, xf.numFmt, date1904);
            } else text = value;
            break;
          }
          default: {
            if (raw === null || raw === '') {
              value = null;
              text = '';
            } else {
              const n = Number(raw);
              value = Number.isFinite(n) ? n : raw;
              isNumber = typeof value === 'number';
              text =
                typeof value === 'number'
                  ? formatCellValue(value, xf?.numFmt ?? 'General', date1904)
                  : String(value);
            }
          }
        }
        const style = cssFor(s, isNumber);
        if (value === null && !style && !hasFormula) continue;
        let rowMap = rows.get(pos.row);
        if (!rowMap) {
          rowMap = new Map();
          rows.set(pos.row, rowMap);
        }
        const cell: XlsxCell = { value, text };
        if (c.formula) cell.formula = c.formula;
        if (style) cell.style = error ? { ...style, color: '#c00' } : style;
        else if (error) cell.style = { color: '#c00' };
        if (error) cell.error = true;
        rowMap.set(pos.col, cell);
        if (value !== null || hasFormula) {
          if (pos.row > maxRow) maxRow = pos.row;
          if (pos.col > maxCol) maxCol = pos.col;
        }
        cellCount += 1;
        if (cellCount > MAX_CELLS) throw new Error('This worksheet is too large to preview.');
      }
    }

    const merges = scanElements(xml, 'mergeCell')
      .map((m) => {
        const [a, b] = (m.ref ?? '').split(':');
        const p1 = parseRef(a ?? '');
        const p2 = parseRef(b ?? a ?? '');
        return { r1: p1.row, c1: p1.col, r2: p2.row, c2: p2.col };
      })
      .filter((m) => m.r1 >= 0 && m.c1 >= 0 && m.r2 >= m.r1 && m.c2 >= m.c1);
    for (const m of merges) {
      if (m.r2 > maxRow) maxRow = m.r2;
      if (m.c2 > maxCol) maxCol = m.c2;
    }

    const sheet: XlsxSheet = {
      name: info.name,
      rowCount: Math.max(1, maxRow + 1),
      colCount: Math.max(1, maxCol + 1),
      rows,
      merges,
      colWidths,
      rowHeights,
      defaultColWidth,
      defaultRowHeight,
    };
    cache.set(index, sheet);
    return sheet;
  };

  return { sheets, date1904, readSheet };
}
