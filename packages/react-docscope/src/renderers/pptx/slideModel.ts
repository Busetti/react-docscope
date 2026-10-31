import type { CSSProperties } from 'react';
import { sanitizeHtml } from '../../core/sanitize';

/** Subset of the pptxtojson output used by the renderer (kept local to avoid leaking its types). */
export interface PptxFill {
  type: 'color' | 'image' | 'gradient' | 'pattern';
  value: unknown;
}

export interface PptxElement {
  type: string;
  left: number;
  top: number;
  width: number;
  height: number;
  rotate?: number;
  isFlipH?: boolean;
  isFlipV?: boolean;
  fill?: PptxFill | null;
  borderColor?: string;
  borderWidth?: number;
  borderType?: string;
  content?: string;
  vAlign?: string;
  shapType?: string;
  path?: string;
  pathViewBox?: { x: number; y: number; width: number; height: number };
  base64?: string;
  picBase64?: string;
  latex?: string;
  text?: string;
  data?: unknown;
  colWidths?: number[];
  rowHeights?: number[];
  chartType?: string;
  elements?: PptxElement[];
  name?: string;
  isVertical?: boolean;
}

export interface PptxSlide {
  fill?: PptxFill | null;
  elements: PptxElement[];
  layoutElements?: PptxElement[];
  note?: string;
}

export interface PptxDeck {
  slides: PptxSlide[];
  size: { width: number; height: number };
}

/**
 * Fixes pptxtojson 2.2.x emitting percentage paragraph spacing divided by
 * 1000 instead of 100000 (e.g. 20% → "20em" instead of "0.2em").
 */
export function fixParagraphSpacing(html: string): string {
  return html.replace(/(margin-(?:top|bottom)):\s*([\d.]+)em/g, (_m, prop: string, v: string) => {
    const n = Number(v);
    return `${prop}: ${n >= 5 ? (n / 100).toFixed(3) : v}em`;
  });
}

export function safeContent(html: string | undefined): string {
  if (!html) return '';
  // pptxtojson emits &nbsp; between all words, which prevents wrapping; the
  // container uses `white-space: pre-wrap`, so plain spaces keep the spacing.
  return sanitizeHtml(fixParagraphSpacing(html).replace(/&nbsp;|\u00a0/g, ' '));
}

export function fillToCss(fill: PptxFill | null | undefined): CSSProperties {
  if (!fill) return {};
  switch (fill.type) {
    case 'color':
      return typeof fill.value === 'string' && fill.value ? { background: fill.value } : {};
    case 'image': {
      const v = fill.value as { base64?: string; picBase64?: string };
      const src = v?.base64 || v?.picBase64;
      return src && src.startsWith('data:image/')
        ? {
            backgroundImage: `url("${src}")`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          }
        : {};
    }
    case 'gradient': {
      const v = fill.value as {
        rot?: number;
        path?: string;
        colors?: Array<{ pos: string; color: string }>;
      };
      const stops = (v?.colors ?? []).map((c) => `${c.color} ${c.pos}`).join(', ');
      if (!stops) return {};
      return v.path === 'circle' || v.path === 'rect' || v.path === 'shape'
        ? { background: `radial-gradient(${stops})` }
        : { background: `linear-gradient(${(v.rot ?? 0) + 90}deg, ${stops})` };
    }
    case 'pattern': {
      const v = fill.value as { foregroundColor?: string; backgroundColor?: string };
      return v?.backgroundColor ? { background: v.backgroundColor } : {};
    }
    default:
      return {};
  }
}

export function transformOf(el: PptxElement): string | undefined {
  const parts: string[] = [];
  if (el.rotate) parts.push(`rotate(${el.rotate}deg)`);
  if (el.isFlipH) parts.push('scaleX(-1)');
  if (el.isFlipV) parts.push('scaleY(-1)');
  return parts.length ? parts.join(' ') : undefined;
}

export function borderOf(el: PptxElement): CSSProperties {
  if (!el.borderWidth || !el.borderColor) return {};
  const type = el.borderType === 'dashed' || el.borderType === 'dotted' ? el.borderType : 'solid';
  return { border: `${el.borderWidth}pt ${type} ${el.borderColor}` };
}

/** Plain text of a slide (for thumbnails' accessible names and tests). */
export function slideText(slide: PptxSlide): string {
  const parts: string[] = [];
  const walk = (els: PptxElement[]) => {
    for (const el of els) {
      if (el.content) parts.push(el.content.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' '));
      if (el.elements) walk(el.elements);
    }
  };
  walk(slide.elements);
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}
