import { useEffect, useRef, useState } from 'react';
import type { RendererProps } from '../../types';
import { isAbortError, toPreviewError } from '../../core/errors';
import { neutralizeLinks } from '../../core/sanitize';
import { useDomSearch, useElementSize, useLatest, useWheelZoom } from '../shared/hooks';

const PAGE_PADDING = 32;

/**
 * Read-only DOCX rendering via docx-preview (Apache-2.0). Output is written to
 * a renderer-owned container (not React-managed). Alt-chunks (embedded HTML)
 * and comments are disabled, images are inlined as data URLs so no blob URLs
 * leak, and links are neutralised after rendering.
 */
export default function DocxRenderer({ document, source, search, view, host }: RendererProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const styleRef = useRef<HTMLDivElement>(null);
  const [version, setVersion] = useState<number | null>(null);
  const [pageWidth, setPageWidth] = useState(0);
  const hostRef = useLatest(host);
  const size = useElementSize(scrollRef);

  useEffect(() => {
    let cancelled = false;
    const body = bodyRef.current!;
    const styles = styleRef.current!;
    (async () => {
      try {
        const [buffer, lib] = await Promise.all([source.getArrayBuffer(), import('docx-preview')]);
        if (cancelled) return;
        await lib.renderAsync(buffer, body, styles, {
          className: 'dsc-docx',
          inWrapper: true,
          breakPages: true,
          ignoreLastRenderedPageBreak: true,
          renderHeaders: true,
          renderFooters: true,
          renderFootnotes: true,
          renderEndnotes: true,
          renderComments: false,
          renderChanges: false,
          renderAltChunks: false,
          useBase64URL: true,
          experimental: false,
        });
        if (cancelled) return;
        neutralizeLinks(body);
        const page = body.querySelector<HTMLElement>('section.dsc-docx');
        setPageWidth(page?.offsetWidth || 816);
        setVersion((v) => (v ?? 0) + 1);
        hostRef.current.setReady();
      } catch (error) {
        if (cancelled || isAbortError(error)) return;
        const e = toPreviewError(error, 'MALFORMED_DOCUMENT');
        const code =
          e.code === 'ACCESS_DENIED' || e.code === 'FETCH_FAILED' || e.code === 'NOT_FOUND'
            ? e.code
            : 'MALFORMED_DOCUMENT';
        hostRef.current.setError(
          code,
          code === 'MALFORMED_DOCUMENT'
            ? 'This Word document could not be read. It may be damaged or not a .docx file.'
            : e.message,
        );
      }
    })();
    return () => {
      cancelled = true;
      body.replaceChildren();
      styles.replaceChildren();
    };
  }, [source, hostRef]);

  const fitZoom =
    view.fitMode === 'width' && pageWidth && size.width
      ? Math.max(0.1, Math.min(4, (size.width - PAGE_PADDING) / pageWidth))
      : null;
  const zoom = fitZoom ?? view.zoom;
  useEffect(() => {
    if (version !== null) hostRef.current.setEffectiveZoom(zoom);
  }, [zoom, version, hostRef]);
  useWheelZoom(scrollRef, zoom, host);
  useDomSearch(bodyRef, scrollRef, search, host, version, true);

  return (
    <div
      ref={scrollRef}
      className="dsc-scroll dsc-docx-scroll"
      data-dsc-scroll-container=""
      tabIndex={0}
      aria-label={document.name}
      role="document"
    >
      <div ref={styleRef} hidden />
      <div ref={bodyRef} className="dsc-docx-body" style={{ zoom }} />
    </div>
  );
}
