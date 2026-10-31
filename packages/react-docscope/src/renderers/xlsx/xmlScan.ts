/**
 * Fast string scanners for the large, regular parts of SpreadsheetML
 * (worksheet cells and shared strings). Building a DOM for a 20 MB worksheet
 * takes seconds in browsers; scanning the string is roughly 10× faster and
 * allocates far less. Smaller parts (workbook, styles, theme) still use
 * DOMParser.
 */

const ENTITY = /&(?:#(\d+)|#x([0-9a-f]+)|(amp|lt|gt|quot|apos));/gi;
const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

export function decodeXml(text: string): string {
  if (!text.includes('&')) return text;
  return text.replace(
    ENTITY,
    (_m, dec: string | undefined, hex: string | undefined, name: string | undefined) => {
      if (dec) return String.fromCodePoint(Number(dec));
      if (hex) return String.fromCodePoint(parseInt(hex, 16));
      return NAMED[name!.toLowerCase()] ?? _m;
    },
  );
}

const ATTR = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

/** Parses `a="1" b='2'` into an object. Namespace prefixes are kept (`r:id`). */
export function parseAttrs(source: string): Record<string, string> {
  const out: Record<string, string> = {};
  ATTR.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ATTR.exec(source)) !== null) out[m[1]!] = decodeXml(m[2] ?? m[3] ?? '');
  return out;
}

const RPH = /<(?:\w+:)?rPh\b[\s\S]*?<\/(?:\w+:)?rPh>/g;
const T = /<(?:\w+:)?t\b[^>]*?(?:\/>|>([\s\S]*?)<\/(?:\w+:)?t>)/g;

/** Concatenated text of `<t>` runs, ignoring phonetic (`rPh`) runs. */
export function richText(inner: string): string {
  const clean = inner.includes('rPh') ? inner.replace(RPH, '') : inner;
  let out = '';
  T.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = T.exec(clean)) !== null) out += decodeXml(m[1] ?? '');
  return out;
}

export function scanSharedStrings(xml: string): string[] {
  const out: string[] = [];
  const re = /<(?:\w+:)?si\b[^>]*?(?:\/>|>([\s\S]*?)<\/(?:\w+:)?si>)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) out.push(m[1] ? richText(m[1]) : '');
  return out;
}

export interface ScannedCell {
  attrs: Record<string, string>;
  value: string | null;
  /** Formula text; '' for shared-formula references without text; null when absent. */
  formula: string | null;
  inline: string | null;
}

export interface ScannedRow {
  attrs: Record<string, string>;
  cells: ScannedCell[];
}

const ROW = /<(?:\w+:)?row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?row>)/g;
const CELL = /<(?:\w+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g;
const V = /<(?:\w+:)?v\b[^>]*>([\s\S]*?)<\/(?:\w+:)?v>/;
const F = /<(?:\w+:)?f\b[^>]*?(?:\/>|>([\s\S]*?)<\/(?:\w+:)?f>)/;
const IS = /<(?:\w+:)?is\b[^>]*>([\s\S]*?)<\/(?:\w+:)?is>/;

/** Iterates over `<row>` elements of `<sheetData>`. */
export function* scanRows(xml: string): Generator<ScannedRow> {
  const start = xml.search(/<(?:\w+:)?sheetData\b/);
  if (start < 0) return;
  const endMatch = /<\/(?:\w+:)?sheetData>/.exec(xml.slice(start));
  const data = endMatch ? xml.slice(start, start + endMatch.index) : xml.slice(start);
  ROW.lastIndex = 0;
  let row: RegExpExecArray | null;
  while ((row = ROW.exec(data)) !== null) {
    const cells: ScannedCell[] = [];
    const body = row[2];
    if (body) {
      CELL.lastIndex = 0;
      let c: RegExpExecArray | null;
      while ((c = CELL.exec(body)) !== null) {
        const inner = c[2] ?? '';
        const v = inner ? V.exec(inner) : null;
        const f = inner ? F.exec(inner) : null;
        const is = inner ? IS.exec(inner) : null;
        cells.push({
          attrs: parseAttrs(c[1] ?? ''),
          value: v ? decodeXml(v[1] ?? '') : null,
          formula: f ? decodeXml(f[1] ?? '') : null,
          inline: is ? richText(is[1] ?? '') : null,
        });
      }
    }
    yield { attrs: parseAttrs(row[1] ?? ''), cells };
  }
}

/** All attribute sets of a (self-closing or empty) element, e.g. `col` or `mergeCell`. */
export function scanElements(xml: string, local: string): Array<Record<string, string>> {
  const re = new RegExp(`<(?:\\w+:)?${local}\\b([^>]*?)\\/?>`, 'g');
  const out: Array<Record<string, string>> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) out.push(parseAttrs(m[1] ?? ''));
  return out;
}
