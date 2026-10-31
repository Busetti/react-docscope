import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { PDFDocumentProxy, PDFPageProxy, PageViewport } from 'pdfjs-dist';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { PreviewErrorCode, RendererProps } from '../../types';
import { errorFromStatus, isAbortError } from '../../core/errors';
import { useElementSize, useLatest, useWheelZoom } from '../shared/hooks';
import { collectTextNodes } from '../../core/highlight';
import { enableMainThreadFallback, ensurePdfWorker } from './pdfWorker';
import {
  buildPageText,
  canvasScale,
  findPdfMatches,
  matchRects,
  pageAtOffset,
  toCssRect,
  type PdfMatch,
  type PdfPageText,
} from './pdfText';

type PdfjsLib = typeof import('pdfjs-dist');
const GAP = 16;

interface PageSize {
  width: number;
  height: number;
}

function classifyPdfError(error: unknown): { code: PreviewErrorCode; message: string } {
  const e = error as { name?: string; status?: number; message?: string };
  if (e?.name === 'PasswordException') {
    return {
      code: 'RENDER_FAILED',
      message: 'This PDF is password protected and cannot be previewed.',
    };
  }
  if (e?.name === 'InvalidPDFException' || /invalid pdf|corrupt/i.test(e?.message ?? '')) {
    return {
      code: 'MALFORMED_DOCUMENT',
      message: 'This PDF appears to be damaged or is not a valid PDF file.',
    };
  }
  if (typeof e?.status === 'number' && e.status >= 400) {
    const mapped = errorFromStatus(e.status);
    return { code: mapped.code, message: mapped.message };
  }
  if (
    e?.name === 'ResponseException' ||
    e?.name === 'UnexpectedResponseException' ||
    e?.name === 'MissingPDFException'
  ) {
    return { code: 'FETCH_FAILED', message: 'The PDF could not be downloaded.' };
  }
  return { code: 'RENDER_FAILED', message: 'The PDF could not be displayed.' };
}

export default function PdfRenderer({
  document,
  source,
  view,
  search,
  host,
  config,
}: RendererProps) {
  const hostRef = useLatest(host);
  const scrollRef = useRef<HTMLDivElement>(null);
  const container = useElementSize(scrollRef);
  const [pdf, setPdf] = useState<{ lib: PdfjsLib; doc: PDFDocumentProxy } | null>(null);
  const [sizes, setSizes] = useState<PageSize[]>([]);

  /* ----------------------------------------------------------- loading */
  useEffect(() => {
    let cancelled = false;
    let task: { destroy(): Promise<void>; promise: Promise<PDFDocumentProxy> } | null = null;
    (async () => {
      const lib = await import('pdfjs-dist');
      await ensurePdfWorker(lib, config.pdf.workerSrc);
      const request = source.getRequest();
      const common = {
        enableXfa: false,
        disableAutoFetch: true,
        ...(config.pdf.cMapUrl ? { cMapUrl: config.pdf.cMapUrl, cMapPacked: true } : {}),
        ...(config.pdf.standardFontDataUrl
          ? { standardFontDataUrl: config.pdf.standardFontDataUrl }
          : {}),
        ...(config.pdf.wasmUrl ? { wasmUrl: config.pdf.wasmUrl } : {}),
      };
      const open = async () => {
        const params =
          request && source.kind === 'url'
            ? {
                ...common,
                url: request.url,
                ...(request.headers ? { httpHeaders: request.headers } : {}),
                withCredentials: request.credentials === 'include',
              }
            : { ...common, data: new Uint8Array(await source.getArrayBuffer()) };
        task = lib.getDocument(params) as unknown as typeof task;
        return task!.promise;
      };
      let doc: PDFDocumentProxy;
      try {
        doc = await open();
      } catch (error) {
        if (cancelled) return;
        // A worker that failed to boot (e.g. strict CSP) → retry on the main thread once.
        if (/worker/i.test((error as Error)?.message ?? '')) {
          await enableMainThreadFallback(lib);
          doc = await open();
        } else throw error;
      }
      if (cancelled) return;
      const first = await doc.getPage(1);
      const vp = first.getViewport({ scale: 1 });
      if (cancelled) return;
      setSizes(
        Array.from({ length: doc.numPages }, () => ({ width: vp.width, height: vp.height })),
      );
      setPdf({ lib, doc });
      hostRef.current.setPageCount(doc.numPages);
    })().catch((error: unknown) => {
      if (cancelled || isAbortError(error)) return;
      const { code, message } = classifyPdfError(error);
      hostRef.current.setError(code, message);
    });
    return () => {
      cancelled = true;
      // Destroying the loading task also destroys the document and its worker-side resources.
      void (task as { destroy(): Promise<void> } | null)?.destroy();
    };
  }, [
    source,
    config.pdf.workerSrc,
    config.pdf.cMapUrl,
    config.pdf.standardFontDataUrl,
    config.pdf.wasmUrl,
    hostRef,
  ]);

  const onPageSize = useCallback((index: number, size: PageSize) => {
    setSizes((prev) => {
      const cur = prev[index];
      if (
        !cur ||
        (Math.abs(cur.width - size.width) < 0.5 && Math.abs(cur.height - size.height) < 0.5)
      )
        return prev;
      const next = prev.slice();
      next[index] = size;
      return next;
    });
  }, []);

  /* ----------------------------------------------------------- layout */
  const rotated = Math.abs(view.rotation % 180) === 90;
  const pageCount = sizes.length;
  const refIndex = Math.min(Math.max(0, view.page - 1), Math.max(0, pageCount - 1));
  const ref = sizes[refIndex] ?? { width: 612, height: 792 };
  const refW = rotated ? ref.height : ref.width;
  const refH = rotated ? ref.width : ref.height;
  const availW = Math.max(50, container.width - GAP * 2);
  const availH = Math.max(50, container.height - GAP * 2);
  const fitScale =
    view.fitMode === 'width'
      ? availW / refW
      : view.fitMode === 'page'
        ? Math.min(availW / refW, availH / refH)
        : null;
  const scale = Math.max(0.05, Math.min(10, fitScale ?? view.zoom));
  useEffect(() => {
    if (pdf) hostRef.current.setEffectiveZoom(scale);
  }, [scale, pdf, hostRef]);
  useWheelZoom(scrollRef, scale, host);

  const single = view.scrollMode === 'single';
  const { offsets, heights, total, maxWidth } = useMemo(() => {
    const o: number[] = [];
    const h: number[] = [];
    let y = GAP;
    let mw = 0;
    sizes.forEach((s, i) => {
      const ph = (rotated ? s.width : s.height) * scale;
      const pw = (rotated ? s.height : s.width) * scale;
      if (pw > mw) mw = pw;
      o[i] = y;
      h[i] = ph;
      y += ph + GAP;
    });
    return { offsets: o, heights: h, total: y, maxWidth: mw };
  }, [sizes, scale, rotated]);

  /* ----------------------------------------------- visible window & page tracking */
  const [range, setRange] = useState<[number, number]>([0, 1]);
  const lastReportedPage = useRef(1);
  const overscan = config.pdf.overscan;
  const updateRange = useCallback(() => {
    const el = scrollRef.current;
    if (!el || !pageCount) return;
    if (single) {
      setRange([refIndex, refIndex]);
      return;
    }
    const top = el.scrollTop;
    const bottom = top + (el.clientHeight || 800);
    const first = pageAtOffset(offsets, heights, top);
    const last = pageAtOffset(offsets, heights, bottom);
    const a = Math.max(0, first - overscan);
    const b = Math.min(pageCount - 1, last + overscan);
    setRange((r) => (r[0] === a && r[1] === b ? r : [a, b]));
    const center = pageAtOffset(offsets, heights, top + (el.clientHeight || 800) / 3) + 1;
    if (center !== lastReportedPage.current) {
      lastReportedPage.current = center;
      hostRef.current.setCurrentPage(center);
    }
  }, [pageCount, single, refIndex, offsets, heights, overscan, hostRef]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(updateRange);
    };
    updateRange();
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      el.removeEventListener('scroll', onScroll);
    };
  }, [updateRange]);

  // Keep the current page anchored when the scale changes.
  const prevScale = useRef(scale);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || single || prevScale.current === scale) return;
    const ratio = scale / prevScale.current;
    prevScale.current = scale;
    el.scrollTop = el.scrollTop * ratio;
  }, [scale, single]);

  // Navigate when the page is changed from the toolbar / thumbnails.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !pageCount || single) return;
    if (view.page === lastReportedPage.current) return;
    lastReportedPage.current = view.page;
    el.scrollTo({ top: (offsets[view.page - 1] ?? 0) - GAP });
  }, [view.page, pageCount, single, offsets]);

  /* ----------------------------------------------------------- search */
  const textCache = useRef(new Map<number, PdfPageText>());
  const [extracted, setExtracted] = useState(0);
  const wantsText = search.query.trim().length > 0;
  useEffect(() => {
    if (!pdf || !wantsText || extracted >= pdf.doc.numPages) return;
    let cancelled = false;
    (async () => {
      const doc = pdf.doc;
      let done = textCache.current.size;
      for (let p = 1; p <= doc.numPages && !cancelled; p += 1) {
        if (textCache.current.has(p)) continue;
        const page = await doc.getPage(p);
        const content = await page.getTextContent();
        textCache.current.set(p, buildPageText(content.items as never));
        done += 1;
        if (done % 10 === 0 || done === doc.numPages) setExtracted(done);
      }
    })().catch(() => {
      /* text extraction failures only disable search */
    });
    return () => {
      cancelled = true;
    };
  }, [pdf, wantsText, extracted]);

  const matches = useMemo<PdfMatch[]>(
    () =>
      pdf
        ? findPdfMatches(textCache.current, pdf.doc.numPages, search.query, search.caseSensitive)
        : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pdf, search.query, search.caseSensitive, extracted],
  );
  useEffect(() => {
    hostRef.current.setSearchResults(matches.length);
  }, [matches, hostRef]);
  const active = search.activeIndex >= 0 ? matches[search.activeIndex] : undefined;
  const matchesByPage = useMemo(() => {
    const map = new Map<number, Array<PdfMatch & { index: number }>>();
    matches.forEach((m, index) => {
      const list = map.get(m.page) ?? [];
      list.push({ ...m, index });
      map.set(m.page, list);
    });
    return map;
  }, [matches]);

  // Bring the active match into view.
  useEffect(() => {
    if (!active) return;
    if (single) {
      if (view.page !== active.page) hostRef.current.setCurrentPage(active.page);
      return;
    }
    const el = scrollRef.current;
    const pageText = textCache.current.get(active.page);
    if (!el || !pageText || !pdf) return;
    const rect = matchRects(pageText, active.start, active.end)[0];
    const size = sizes[active.page - 1];
    if (!rect || !size) return;
    // Approximate: PDF y grows upwards.
    const yFromTop = rotated ? rect[0]! : size.height - rect[3]!;
    lastReportedPage.current = active.page;
    hostRef.current.setCurrentPage(active.page);
    el.scrollTo({
      top: Math.max(0, (offsets[active.page - 1] ?? 0) + yFromTop * scale - el.clientHeight / 2),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.page, active?.start, search.activeIndex]);

  useEffect(() => {
    if (pdf && pageCount) hostRef.current.setReady();
  }, [pdf, pageCount, hostRef]);

  const pagesToRender: number[] = [];
  if (pdf) {
    if (single) pagesToRender.push(refIndex);
    else
      for (let i = range[0]; i <= Math.min(range[1], pageCount - 1); i += 1) pagesToRender.push(i);
  }

  return (
    <div className="dsc-paged">
      {view.showThumbnails && pdf && (
        <PdfThumbnails
          doc={pdf.doc}
          sizes={sizes}
          current={view.page}
          rotation={view.rotation}
          onSelect={(p) => hostRef.current.setCurrentPage(p)}
        />
      )}
      <div
        ref={scrollRef}
        className="dsc-scroll dsc-pdf"
        data-dsc-scroll-container=""
        tabIndex={0}
        role="document"
        aria-label={document.name}
      >
        <div
          className="dsc-pdf-canvas"
          style={{
            height: single ? (heights[refIndex] ?? 0) + GAP * 2 : total,
            width: Math.max(maxWidth + GAP * 2, 0),
          }}
        >
          {pdf &&
            pagesToRender.map((i) => (
              <PdfPage
                key={i}
                doc={pdf.doc}
                lib={pdf.lib}
                index={i}
                top={single ? GAP : offsets[i]!}
                scale={scale}
                rotation={view.rotation}
                estimated={sizes[i]!}
                onSize={onPageSize}
                pageText={textCache.current.get(i + 1)}
                matches={matchesByPage.get(i + 1)}
                activeIndex={search.activeIndex}
              />
            ))}
        </div>
      </div>
    </div>
  );
}

interface PdfPageProps {
  doc: PDFDocumentProxy;
  lib: PdfjsLib;
  index: number;
  top: number;
  scale: number;
  rotation: number;
  estimated: PageSize;
  onSize: (index: number, size: PageSize) => void;
  pageText: PdfPageText | undefined;
  matches: Array<PdfMatch & { index: number }> | undefined;
  activeIndex: number;
}

const PdfPage = memo(function PdfPage({
  doc,
  lib,
  index,
  top,
  scale,
  rotation,
  estimated,
  onSize,
  pageText,
  matches,
  activeIndex,
}: PdfPageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState<PDFPageProxy | null>(null);
  const [viewport, setViewport] = useState<PageViewport | null>(null);
  const [rendered, setRendered] = useState(false);
  const [textReady, setTextReady] = useState(0);
  const pageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    let loaded: PDFPageProxy | null = null;
    doc.getPage(index + 1).then(
      (p) => {
        loaded = p;
        if (cancelled) return;
        const base = p.getViewport({ scale: 1 });
        onSize(index, { width: base.width, height: base.height });
        setPage(p);
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
      loaded?.cleanup();
    };
  }, [doc, index, onSize]);

  useEffect(() => {
    if (!page) return;
    const vp = page.getViewport({ scale, rotation: (page.rotate + rotation) % 360 });
    setViewport(vp);
    const canvas = canvasRef.current;
    const textDiv = textRef.current;
    if (!canvas || !textDiv) return;
    let cancelled = false;
    const dpr = canvasScale(
      vp.width,
      vp.height,
      typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1,
    );
    canvas.width = Math.floor(vp.width * dpr);
    canvas.height = Math.floor(vp.height * dpr);
    canvas.style.width = `${Math.floor(vp.width)}px`;
    canvas.style.height = `${Math.floor(vp.height)}px`;
    const renderTask = page.render({
      canvas,
      viewport: vp,
      ...(dpr !== 1 ? { transform: [dpr, 0, 0, dpr, 0, 0] } : {}),
    } as never);
    renderTask.promise.then(
      () => {
        if (!cancelled) setRendered(true);
      },
      () => undefined,
    );

    textDiv.replaceChildren();
    textDiv.style.setProperty('--total-scale-factor', String(scale));
    textDiv.style.setProperty('--scale-round-x', '1px');
    textDiv.style.setProperty('--scale-round-y', '1px');
    let textLayer: { render(): Promise<unknown>; cancel(): void } | null = null;
    page
      .getTextContent()
      .then((content) => {
        if (cancelled) return;
        textLayer = new lib.TextLayer({
          textContentSource: content,
          container: textDiv,
          viewport: vp,
        });
        return textLayer.render().then(() => {
          if (!cancelled) setTextReady((n) => n + 1);
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      renderTask.cancel();
      textLayer?.cancel();
    };
  }, [page, scale, rotation, lib]);

  const rotated = Math.abs(rotation % 180) === 90;
  const width = viewport?.width ?? (rotated ? estimated.height : estimated.width) * scale;
  const height = viewport?.height ?? (rotated ? estimated.width : estimated.height) * scale;

  // Precise highlight boxes measured from the rendered text layer (matches the
  // real glyph widths). Falls back to geometry from the text content items.
  const [measured, setMeasured] = useState<Array<{
    key: string;
    active: boolean;
    left: number;
    top: number;
    width: number;
    height: number;
  }> | null>(null);
  useLayoutEffect(() => {
    const textDiv = textRef.current;
    const pageEl = pageRef.current;
    if (
      !textReady ||
      !textDiv ||
      !pageEl ||
      !pageText ||
      !matches?.length ||
      typeof Range.prototype.getClientRects !== 'function'
    ) {
      setMeasured(null);
      return;
    }
    const nodes = collectTextNodes(textDiv);
    const items = pageText.items.filter((i) => i.str.length > 0);
    if (nodes.length !== items.length || nodes.some((n, k) => n.nodeValue !== items[k]!.str)) {
      setMeasured(null);
      return;
    }
    const box = pageEl.getBoundingClientRect();
    const range = document.createRange();
    const out: NonNullable<typeof measured> = [];
    for (const m of matches) {
      items.forEach((item, k) => {
        if (item.end <= m.start || item.start >= m.end) return;
        range.setStart(nodes[k]!, Math.max(m.start, item.start) - item.start);
        range.setEnd(nodes[k]!, Math.min(m.end, item.end) - item.start);
        Array.from(range.getClientRects()).forEach((r, j) => {
          if (r.width === 0 && r.height === 0) return;
          out.push({
            key: `${m.index}-${k}-${j}`,
            active: m.index === activeIndex,
            left: r.left - box.left,
            top: r.top - box.top,
            width: r.width,
            height: r.height,
          });
        });
      });
    }
    setMeasured(out.length ? out : null);
  }, [textReady, pageText, matches, activeIndex]);

  const highlights =
    measured ??
    (viewport && pageText && matches
      ? matches.flatMap((m) =>
          matchRects(pageText, m.start, m.end).map((r, k) => ({
            key: `${m.index}-${k}`,
            active: m.index === activeIndex,
            ...toCssRect([
              ...viewport.convertToViewportPoint(r[0]!, r[1]!),
              ...viewport.convertToViewportPoint(r[2]!, r[3]!),
            ] as number[]),
          })),
        )
      : []);

  return (
    <div
      ref={pageRef}
      className="dsc-pdf-page"
      data-page={index + 1}
      role="region"
      aria-label={`Page ${index + 1}`}
      style={{ top, width, height }}
    >
      <canvas ref={canvasRef} aria-hidden="true" data-rendered={rendered ? 'true' : 'false'} />
      <div ref={textRef} className="textLayer dsc-pdf-text" />
      {highlights.length > 0 && (
        <div className="dsc-pdf-highlights" aria-hidden="true">
          {highlights.map((h) => (
            <div
              key={h.key}
              className={h.active ? 'dsc-pdf-hl dsc-pdf-hl--active' : 'dsc-pdf-hl'}
              style={{ left: h.left, top: h.top, width: h.width, height: h.height }}
            />
          ))}
        </div>
      )}
    </div>
  );
});

const THUMB_W = 120;

function PdfThumbnails({
  doc,
  sizes,
  current,
  rotation,
  onSelect,
}: {
  doc: PDFDocumentProxy;
  sizes: PageSize[];
  current: number;
  rotation: number;
  onSelect: (page: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const rotated = Math.abs(rotation % 180) === 90;
  const virtualizer = useVirtualizer({
    count: sizes.length,
    getScrollElement: () => ref.current,
    estimateSize: (i) => {
      const s = sizes[i]!;
      const ratio = rotated ? s.width / s.height : s.height / s.width;
      return Math.round(THUMB_W * ratio) + 30;
    },
    overscan: 3,
    initialRect: { width: 160, height: 600 },
  });
  useEffect(() => {
    virtualizer.scrollToIndex(current - 1, { align: 'auto' });
  }, [current, virtualizer]);
  return (
    <nav ref={ref} className="dsc-thumbs" aria-label="Page thumbnails">
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {virtualizer.getVirtualItems().map((item) => (
          <button
            key={item.key}
            type="button"
            className="dsc-thumb"
            aria-label={`Page ${item.index + 1}`}
            aria-current={current === item.index + 1 ? 'true' : undefined}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              transform: `translateY(${item.start}px)`,
            }}
            onClick={() => onSelect(item.index + 1)}
          >
            <PdfThumb doc={doc} index={item.index} rotation={rotation} />
            <span className="dsc-thumb-label">{item.index + 1}</span>
          </button>
        ))}
      </div>
    </nav>
  );
}

function PdfThumb({
  doc,
  index,
  rotation,
}: {
  doc: PDFDocumentProxy;
  index: number;
  rotation: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let cancelled = false;
    let task: { cancel(): void; promise: Promise<void> } | null = null;
    doc.getPage(index + 1).then(
      (page) => {
        const canvas = canvasRef.current;
        if (cancelled || !canvas) return;
        const base = page.getViewport({ scale: 1, rotation: (page.rotate + rotation) % 360 });
        const vp = page.getViewport({
          scale: THUMB_W / base.width,
          rotation: (page.rotate + rotation) % 360,
        });
        canvas.width = Math.floor(vp.width);
        canvas.height = Math.floor(vp.height);
        task = page.render({ canvas, viewport: vp } as never) as unknown as typeof task;
        task!.promise.catch(() => undefined);
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [doc, index, rotation]);
  return <canvas ref={canvasRef} className="dsc-thumb-canvas" aria-hidden="true" />;
}
