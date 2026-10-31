import { memo, useEffect, useMemo, useRef } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { RendererProps } from '../../types';
import { toPreviewError } from '../../core/errors';
import { useAsync, useDomSearch, useLineSearch, useWheelZoom } from '../shared/hooks';
import { TextLines } from '../shared/TextLines';
import { splitLines } from '../text/TextRenderer';

const components: Components = {
  a: ({ node: _node, href, children, ...rest }) => (
    <a {...rest} href={href} target="_blank" rel="noopener noreferrer nofollow">
      {children}
    </a>
  ),
  img: ({ node: _node, src, alt, ...rest }) =>
    typeof src === 'string' && /^(https?:|data:image\/(png|jpe?g|gif|webp|avif);)/i.test(src) ? (
      <img {...rest} src={src} alt={alt ?? ''} loading="lazy" referrerPolicy="no-referrer" />
    ) : (
      <span className="dsc-md-img-blocked">[image: {alt || 'blocked'}]</span>
    ),
};

/**
 * Raw HTML in Markdown is *not* rendered (react-markdown skips it unless
 * rehype-raw is added), and `javascript:` URLs are stripped by the default
 * URL transform, so untrusted Markdown is safe to display.
 */
const MarkdownBody = memo(function MarkdownBody({ text }: { text: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components} skipHtml>
      {text}
    </ReactMarkdown>
  );
});

export default function MarkdownRenderer({ document, source, search, view, host }: RendererProps) {
  const { value: text, error } = useAsync(() => source.getText(), [source]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const raw = view.rawView;
  const lines = useMemo(() => (text !== undefined && raw ? splitLines(text) : []), [text, raw]);

  useEffect(() => {
    if (error) {
      const e = toPreviewError(error, 'FETCH_FAILED');
      host.setError(e.code, e.message);
    } else if (text !== undefined) host.setReady();
  }, [error, text, host]);

  useWheelZoom(scrollRef, view.zoom, host);
  useDomSearch(contentRef, scrollRef, search, host, raw ? null : text, false);
  const rawSearch = useLineSearch(lines, raw ? search : { ...search, query: '' }, raw ? host : noopHost);

  if (text === undefined) return null;
  if (raw) {
    return (
      <TextLines
        lines={lines}
        matches={rawSearch.byLine}
        activeMatch={rawSearch.active}
        activeIndex={search.activeIndex}
        zoom={view.zoom}
        label={`${document.name} (source)`}
      />
    );
  }
  return (
    <div ref={scrollRef} className="dsc-scroll" data-dsc-scroll-container="" tabIndex={0}>
      <article
        ref={contentRef}
        className="dsc-markdown"
        aria-label={document.name}
        style={{ fontSize: `${15 * view.zoom}px` }}
      >
        <MarkdownBody text={text} />
      </article>
    </div>
  );
}

const noop = () => undefined;
const noopHost = {
  setPageCount: noop,
  setCurrentPage: noop,
  setSearchResults: noop,
  setEffectiveZoom: noop,
  requestZoom: noop,
  setReady: noop,
  setError: noop,
};
