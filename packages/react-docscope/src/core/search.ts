export interface TextMatch {
  start: number;
  end: number;
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Finds all non-overlapping occurrences of `query` in `text`. Whitespace in
 * the query matches any run of whitespace so that searches survive line
 * wrapping in extracted text.
 */
export function findTextMatches(
  text: string,
  query: string,
  caseSensitive = false,
  limit = 10_000,
): TextMatch[] {
  const q = query.trim();
  if (!q || !text) return [];
  const pattern = q.split(/\s+/).map(escapeRegExp).join('\\s+');
  const re = new RegExp(pattern, caseSensitive ? 'g' : 'gi');
  const matches: TextMatch[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    matches.push({ start: m.index, end: m.index + m[0].length });
    // The trimmed, non-empty query can never produce zero-length matches.
    if (matches.length >= limit) break;
  }
  return matches;
}

/** True when `value` contains `query` (used for cell / node search). */
export function textIncludes(value: string, query: string, caseSensitive = false): boolean {
  const q = query.trim();
  if (!q) return false;
  return caseSensitive ? value.includes(q) : value.toLowerCase().includes(q.toLowerCase());
}

/** Wraps `index` into `[0, count)`; returns -1 when there is nothing to select. */
export function wrapIndex(index: number, count: number): number {
  if (count <= 0) return -1;
  return ((index % count) + count) % count;
}

/** Splits a string into plain / matched segments for rendering highlights. */
export function segmentText(
  text: string,
  matches: TextMatch[],
): Array<{ text: string; match: number | null }> {
  if (!matches.length) return [{ text, match: null }];
  const out: Array<{ text: string; match: number | null }> = [];
  let pos = 0;
  matches.forEach((m, i) => {
    if (m.start > pos) out.push({ text: text.slice(pos, m.start), match: null });
    out.push({ text: text.slice(m.start, m.end), match: i });
    pos = m.end;
  });
  if (pos < text.length) out.push({ text: text.slice(pos), match: null });
  return out;
}
