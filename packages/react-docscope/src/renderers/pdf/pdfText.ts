import { findTextMatches } from '../../core/search';

/** A positioned run of text from `page.getTextContent()`. */
export interface PdfTextItem {
  str: string;
  /** PDF transform [a, b, c, d, e, f]. */
  transform: number[];
  width: number;
  height: number;
  start: number;
  end: number;
}

export interface PdfPageText {
  text: string;
  items: PdfTextItem[];
}

export interface PdfMatch {
  /** 1-based page number. */
  page: number;
  start: number;
  end: number;
}

interface RawItem {
  str?: string;
  transform?: number[];
  width?: number;
  height?: number;
  hasEOL?: boolean;
}

/** Builds a searchable string for a page while remembering where each item lives. */
export function buildPageText(rawItems: RawItem[]): PdfPageText {
  let text = '';
  const items: PdfTextItem[] = [];
  for (const it of rawItems) {
    if (typeof it.str !== 'string' || !it.transform) continue;
    const start = text.length;
    text += it.str;
    items.push({
      str: it.str,
      transform: it.transform,
      width: it.width ?? 0,
      height: it.height ?? 0,
      start,
      end: text.length,
    });
    if (it.hasEOL) text += '\n';
  }
  return { text, items };
}

export function findPdfMatches(pages: Map<number, PdfPageText>, pageCount: number, query: string, caseSensitive: boolean, limit = 10_000): PdfMatch[] {
  const out: PdfMatch[] = [];
  if (!query.trim()) return out;
  for (let p = 1; p <= pageCount; p += 1) {
    const page = pages.get(p);
    if (!page) continue;
    for (const m of findTextMatches(page.text, query, caseSensitive, limit - out.length)) out.push({ page: p, ...m });
    if (out.length >= limit) break;
  }
  return out;
}

/** Rectangles in PDF user space ([x1, y1, x2, y2]) covering `[start, end)` of the page text. */
export function matchRects(page: PdfPageText, start: number, end: number): number[][] {
  const rects: number[][] = [];
  for (const item of page.items) {
    if (item.end <= start || item.start >= end) continue;
    const len = Math.max(1, item.str.length);
    const a = Math.max(start, item.start) - item.start;
    const b = Math.min(end, item.end) - item.start;
    const [, , c = 0, d = 0, e = 0, f = 0] = item.transform;
    const fontHeight = item.height || Math.hypot(c, d) || 10;
    const x1 = e + (item.width * a) / len;
    const x2 = e + (item.width * b) / len;
    rects.push([x1, f - fontHeight * 0.22, x2, f + fontHeight * 0.88]);
  }
  return rects;
}

/** Normalises a viewport rectangle to { left, top, width, height } in CSS px. */
export function toCssRect(r: number[]): { left: number; top: number; width: number; height: number } {
  const [x1 = 0, y1 = 0, x2 = 0, y2 = 0] = r;
  return { left: Math.min(x1, x2), top: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) };
}

/** Index of the first page whose bottom edge is below `y` (binary search over cumulative offsets). */
export function pageAtOffset(offsets: number[], heights: number[], y: number): number {
  let lo = 0;
  let hi = offsets.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (offsets[mid]! + heights[mid]! < y) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Caps the canvas pixel ratio so very large pages stay within browser canvas limits. */
export function canvasScale(cssWidth: number, cssHeight: number, dpr: number, maxPixels = 16_000_000): number {
  const area = cssWidth * cssHeight * dpr * dpr;
  return area > maxPixels ? Math.sqrt(maxPixels / (cssWidth * cssHeight)) : dpr;
}
