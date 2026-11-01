import type { PreviewLabels } from '../../types';
import { DEFAULT_LABELS } from '../../core/config';
import { textIncludes } from '../../core/search';

const NUMERIC = /^[-+]?(\d{1,3}(,\d{3})+|\d+)?(\.\d+)?([eE][-+]?\d+)?%?$/;

export function looksNumeric(value: string): boolean {
  const v = value.trim().replace(/^[$€£₹¥]/, '');
  return v.length > 0 && NUMERIC.test(v);
}

/**
 * Heuristic header detection: the first row is a header when every cell is
 * non-empty, non-numeric and unique, and the file has more rows below it.
 */
export function detectHeader(rows: string[][]): boolean {
  const first = rows[0];
  if (!first || rows.length < 2 || first.length === 0) return false;
  const seen = new Set<string>();
  for (const cell of first) {
    const c = cell.trim();
    if (!c || looksNumeric(c) || seen.has(c.toLowerCase())) return false;
    seen.add(c.toLowerCase());
  }
  return true;
}

export function delimiterLabel(
  d: string,
  names: PreviewLabels['csvDelimiters'] = DEFAULT_LABELS.csvDelimiters,
): string {
  switch (d) {
    case ',':
      return names.comma;
    case ';':
      return names.semicolon;
    case '\t':
      return names.tab;
    case '|':
      return names.pipe;
    default:
      return JSON.stringify(d);
  }
}

/** Finds matching cells in reading order. */
export function searchRows(
  rows: string[][],
  startRow: number,
  query: string,
  caseSensitive: boolean,
  limit = 10_000,
): Array<{ row: number; col: number }> {
  if (!query.trim()) return [];
  const out: Array<{ row: number; col: number }> = [];
  for (let r = startRow; r < rows.length; r += 1) {
    const row = rows[r]!;
    for (let c = 0; c < row.length; c += 1) {
      if (textIncludes(row[c]!, query, caseSensitive)) {
        out.push({ row: r - startRow, col: c });
        if (out.length >= limit) return out;
      }
    }
  }
  return out;
}
