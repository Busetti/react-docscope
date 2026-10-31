import { memo, useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { TextMatch } from '../../core/search';

export interface Token {
  text: string;
  /** CSS class suffix: `dsc-tok-${type}`. */
  type?: string;
}

export interface TextLinesProps {
  lines: string[];
  matches: Map<number, Array<TextMatch & { index: number }>>;
  activeMatch?: { line: number; start: number } | undefined;
  activeIndex: number;
  zoom: number;
  wrap?: boolean;
  lineNumbers?: boolean;
  tokenize?: (line: string) => Token[];
  label: string;
  onReady?: () => void;
}

/**
 * Virtualized, selectable text view with search highlights and optional
 * syntax tokens. Used by TXT, raw Markdown, JSON and XML views.
 */
export function TextLines({
  lines,
  matches,
  activeMatch,
  activeIndex,
  zoom,
  wrap = true,
  lineNumbers = true,
  tokenize,
  label,
  onReady,
}: TextLinesProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const lineHeight = Math.round(20 * zoom);
  const virtualizer = useVirtualizer({
    count: lines.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => lineHeight,
    overscan: 20,
    initialRect: { width: 800, height: 600 },
  });

  useEffect(() => {
    virtualizer.measure();
  }, [zoom, wrap, virtualizer]);

  useEffect(() => {
    onReady?.();
  }, [onReady]);

  useEffect(() => {
    if (activeMatch) virtualizer.scrollToIndex(activeMatch.line, { align: 'center' });
  }, [activeMatch, virtualizer]);

  const gutterChars = String(lines.length).length;

  return (
    <div
      ref={scrollRef}
      className="dsc-scroll dsc-text-lines"
      data-dsc-scroll-container=""
      data-wrap={wrap ? 'true' : 'false'}
      tabIndex={0}
      role="document"
      aria-label={label}
      style={{ fontSize: `${13 * zoom}px`, ['--dsc-gutter' as string]: `${gutterChars + 2}ch` }}
    >
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative', minWidth: '100%' }}>
        {virtualizer.getVirtualItems().map((item) => (
          <div
            key={item.key}
            data-index={item.index}
            ref={wrap ? virtualizer.measureElement : undefined}
            className="dsc-line"
            style={{ transform: `translateY(${item.start}px)`, minHeight: lineHeight }}
          >
            {lineNumbers && (
              <span className="dsc-line-no" aria-hidden="true">
                {item.index + 1}
              </span>
            )}
            <span className="dsc-line-text">
              <Line
                text={lines[item.index]!}
                matches={matches.get(item.index)}
                activeIndex={activeIndex}
                tokenize={tokenize}
              />
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

interface LineProps {
  text: string;
  matches: Array<TextMatch & { index: number }> | undefined;
  activeIndex: number;
  tokenize: ((line: string) => Token[]) | undefined;
}

/** Renders a line, splitting syntax tokens at match boundaries. */
const Line = memo(function Line({ text, matches, activeIndex, tokenize }: LineProps) {
  if (!text) return <>{'​'}</>;
  const tokens: Token[] = tokenize ? tokenize(text) : [{ text }];
  if (!matches?.length) return <>{tokens.map(renderToken)}</>;
  const out: ReactNode[] = [];
  let pos = 0;
  let mi = 0;
  let key = 0;
  for (const tok of tokens) {
    const tokStart = pos;
    const tokEnd = pos + tok.text.length;
    let cursor = tokStart;
    while (cursor < tokEnd) {
      // skip matches that ended before cursor
      while (mi < matches.length && matches[mi]!.end <= cursor) mi += 1;
      const m = matches[mi];
      if (!m || m.start >= tokEnd) {
        out.push(renderToken({ text: text.slice(cursor, tokEnd), type: tok.type }, key++));
        cursor = tokEnd;
      } else if (m.start > cursor) {
        out.push(renderToken({ text: text.slice(cursor, m.start), type: tok.type }, key++));
        cursor = m.start;
      } else {
        const end = Math.min(m.end, tokEnd);
        out.push(
          <mark
            key={key++}
            className={m.index === activeIndex ? 'dsc-mark dsc-mark--active' : 'dsc-mark'}
            data-dsc-match={m.index}
          >
            {renderToken({ text: text.slice(cursor, end), type: tok.type }, 0)}
          </mark>,
        );
        cursor = end;
      }
    }
    pos = tokEnd;
  }
  return <>{out}</>;
});

function renderToken(tok: Token, key: number): ReactNode {
  if (!tok.type) return <span key={key}>{tok.text}</span>;
  return (
    <span key={key} className={`dsc-tok-${tok.type}`}>
      {tok.text}
    </span>
  );
}
