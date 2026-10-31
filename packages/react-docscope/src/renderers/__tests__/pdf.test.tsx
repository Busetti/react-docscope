import { fireEvent, screen, waitFor } from '@testing-library/react';
import PdfRenderer from '../pdf/PdfRenderer';
import {
  enableMainThreadFallback,
  ensurePdfWorker,
  resetPdfWorkerForTests,
} from '../pdf/pdfWorker';
import {
  buildPageText,
  canvasScale,
  findPdfMatches,
  matchRects,
  pageAtOffset,
  toCssRect,
} from '../pdf/pdfText';
import { lastCall, renderRenderer } from '../../../../../tests/setup/renderer-harness';
import * as pdfjs from '../../../../../tests/setup/pdfjs-mock';

const mock = pdfjs as unknown as typeof import('../../../../../tests/setup/pdfjs-mock');

beforeEach(() => {
  mock.__setMockPdf({ numPages: 5 });
  resetPdfWorkerForTests();
  pdfjs.GlobalWorkerOptions.workerPort = null;
  pdfjs.GlobalWorkerOptions.workerSrc = '';
});

describe('PdfRenderer', () => {
  it('loads from a URL with headers (range requests) and renders visible pages', async () => {
    const r = renderRenderer(PdfRenderer, {
      name: 'a.pdf',
      resolved: {
        kind: 'url',
        url: 'https://x/a.pdf',
        headers: { Authorization: 'Bearer t' },
        credentials: 'include',
      },
      view: { fitMode: 'width' },
    });
    await r.ready();
    expect(r.host.setPageCount).toHaveBeenCalledWith(5);
    expect(mock.__mockPdfState().calls[0]).toMatchObject({
      url: 'https://x/a.pdf',
      httpHeaders: { Authorization: 'Bearer t' },
      withCredentials: true,
      enableXfa: false,
    });
    await waitFor(() =>
      expect(screen.getAllByRole('region', { name: /^Page \d$/ }).length).toBeGreaterThan(0),
    );
    expect(r.host.setEffectiveZoom).toHaveBeenCalled();
    // text layer for selection
    await waitFor(() => expect(document.querySelector('.textLayer span')).not.toBeNull());
  });

  it('loads blobs as data, supports single-page mode, rotation and thumbnails', async () => {
    const r = renderRenderer(PdfRenderer, {
      name: 'b.pdf',
      blob: new Blob(['%PDF-1.4 fake']),
      view: { scrollMode: 'single', page: 2, rotation: 90, showThumbnails: true },
      config: { pdf: { cMapUrl: '/cmaps/', standardFontDataUrl: '/fonts/', wasmUrl: '/wasm/' } },
    });
    await r.ready();
    expect(mock.__mockPdfState().calls[0]).toMatchObject({
      cMapUrl: '/cmaps/',
      cMapPacked: true,
      standardFontDataUrl: '/fonts/',
      wasmUrl: '/wasm/',
    });
    expect(mock.__mockPdfState().calls[0]!.data).toBeInstanceOf(Uint8Array);
    await waitFor(() => expect(screen.getAllByRole('region', { name: /^Page/ })).toHaveLength(1));
    expect(screen.getByRole('region', { name: 'Page 2' })).toBeInTheDocument();
    const thumbs = screen.getByRole('navigation', { name: 'Page thumbnails' });
    fireEvent.click(thumbs.querySelector('button[aria-label="Page 4"]')!);
    expect(r.host.setCurrentPage).toHaveBeenCalledWith(4);
  });

  it('searches extracted text across pages', async () => {
    mock.__setMockPdf({
      numPages: 3,
      pageText: (p) => [`Invoice ${p}`, p === 2 ? 'second invoice here' : 'nothing'],
    });
    const r = renderRenderer(PdfRenderer, {
      name: 'c.pdf',
      blob: new Blob(['x']),
      view: { fitMode: 'page' },
    });
    await r.ready();
    r.update({ fitMode: 'page' }, { query: 'invoice', activeIndex: 0 });
    await waitFor(() => expect(lastCall(r.host.setSearchResults)[0]).toBe(4));
    r.update({ fitMode: 'page' }, { query: 'invoice', activeIndex: 3 });
    await waitFor(() => expect(r.host.setCurrentPage).toHaveBeenCalledWith(3));
    await waitFor(() => expect(document.querySelector('.dsc-pdf-hl--active')).not.toBeNull());
    r.update({ fitMode: 'page', scrollMode: 'single' }, { query: 'invoice', activeIndex: 1 });
    r.update({ fitMode: 'page' }, { query: 'INVOICE', caseSensitive: true, activeIndex: -1 });
    await waitFor(() => expect(lastCall(r.host.setSearchResults)[0]).toBe(0));
  });

  it('navigates when the page changes externally and supports ctrl+wheel zoom', async () => {
    const r = renderRenderer(PdfRenderer, { name: 'd.pdf', blob: new Blob(['x']) });
    await r.ready();
    const scroller = screen.getByRole('document', { name: 'd.pdf' });
    r.update({ page: 4 });
    await waitFor(() => expect(scroller.scrollTop).toBeGreaterThan(0));
    fireEvent.scroll(scroller);
    fireEvent.wheel(scroller, { deltaY: 100, ctrlKey: true });
    expect(r.host.requestZoom).toHaveBeenCalled();
    r.update({ page: 4, zoom: 2 });
    r.unmount();
    expect(mock.__mockPdfState().destroyed).toBeGreaterThan(0);
  });

  it.each([
    [{ name: 'InvalidPDFException' }, 'MALFORMED_DOCUMENT'],
    [{ name: 'PasswordException' }, 'RENDER_FAILED'],
    [{ name: 'ResponseException', status: 403 }, 'ACCESS_DENIED'],
    [{ name: 'ResponseException', status: 404 }, 'NOT_FOUND'],
    [{ name: 'MissingPDFException' }, 'FETCH_FAILED'],
    [{ name: 'Error', message: 'boom' }, 'RENDER_FAILED'],
  ])('classifies %p as %s', async (fail, code) => {
    mock.__setMockPdf({ fail });
    const r = renderRenderer(PdfRenderer, {
      name: 'e.pdf',
      resolved: { kind: 'url', url: 'https://x/e.pdf' },
    });
    await r.failed();
    expect(r.host.setError).toHaveBeenCalledWith(code, expect.any(String));
  });
});

describe('pdf worker bootstrap', () => {
  it('uses an explicit workerSrc', async () => {
    await ensurePdfWorker(pdfjs as never, '/pdf.worker.mjs');
    expect(pdfjs.GlobalWorkerOptions.workerSrc).toBe('/pdf.worker.mjs');
  });

  it('starts a blob worker when Worker exists, otherwise falls back to the main thread', async () => {
    const created: unknown[] = [];
    (globalThis as { Worker?: unknown }).Worker = class {
      constructor(...args: unknown[]) {
        created.push(args);
      }
    };
    await ensurePdfWorker(pdfjs as never);
    expect(created).toHaveLength(1);
    expect(pdfjs.GlobalWorkerOptions.workerPort).not.toBeNull();
    await ensurePdfWorker(pdfjs as never); // already configured
    expect(created).toHaveLength(1);
    delete (globalThis as { Worker?: unknown }).Worker;
    resetPdfWorkerForTests();
    pdfjs.GlobalWorkerOptions.workerPort = null;
    await ensurePdfWorker(pdfjs as never);
    expect((globalThis as { pdfjsWorker?: unknown }).pdfjsWorker).toBeDefined();
    await enableMainThreadFallback(pdfjs as never); // idempotent
    await ensurePdfWorker(pdfjs as never);
  });

  it('retries on the main thread when the worker cannot boot', async () => {
    mock.__setMockPdf({ fail: { name: 'Error', message: 'Setting up fake worker failed' } });
    const r = renderRenderer(PdfRenderer, { name: 'w.pdf', blob: new Blob(['x']) });
    await r.failed();
    expect(mock.__mockPdfState().calls).toHaveLength(2);
  });
});

describe('pdf text helpers', () => {
  const page = buildPageText([
    { str: 'Hello ', transform: [10, 0, 0, 10, 100, 700], width: 60, height: 10 },
    { str: 'world', transform: [10, 0, 0, 10, 160, 700], width: 50, height: 10, hasEOL: true },
    { str: 'next', transform: [10, 0, 0, 10, 100, 680], width: 40, height: 0 },
    { notText: true } as never,
  ]);

  it('builds searchable text with item offsets', () => {
    expect(page.text).toBe('Hello world\nnext');
    expect(page.items).toHaveLength(3);
  });

  it('finds matches and their rectangles', () => {
    const pages = new Map([
      [1, page],
      [3, page],
    ]);
    expect(findPdfMatches(pages, 3, 'world next', false)).toEqual([
      { page: 1, start: 6, end: 16 },
      { page: 3, start: 6, end: 16 },
    ]);
    expect(findPdfMatches(pages, 3, 'o', false, 2)).toHaveLength(2);
    expect(findPdfMatches(pages, 3, '', false)).toEqual([]);
    const rects = matchRects(page, 6, 16);
    expect(rects).toHaveLength(2);
    expect(rects[0]![0]).toBe(160);
    expect(rects[1]![3]).toBeGreaterThan(680); // falls back to transform-derived height
    expect(toCssRect([10, 20, 5, 2])).toEqual({ left: 5, top: 2, width: 5, height: 18 });
    expect(toCssRect([])).toEqual({ left: 0, top: 0, width: 0, height: 0 });
  });

  it('locates pages and caps canvas size', () => {
    const offsets = [0, 110, 220];
    const heights = [100, 100, 100];
    expect(pageAtOffset(offsets, heights, 0)).toBe(0);
    expect(pageAtOffset(offsets, heights, 150)).toBe(1);
    expect(pageAtOffset(offsets, heights, 9999)).toBe(2);
    expect(canvasScale(100, 100, 2)).toBe(2);
    expect(canvasScale(10000, 10000, 2)).toBeLessThan(1);
  });
});

describe('measured PDF highlights', () => {
  it('uses text-layer glyph boxes when available', async () => {
    const proto = Range.prototype as unknown as { getClientRects?: () => DOMRect[] };
    proto.getClientRects = () => [
      { left: 10, top: 20, width: 30, height: 12 } as DOMRect,
      { left: 0, top: 0, width: 0, height: 0 } as DOMRect,
    ];
    try {
      mock.__setMockPdf({ numPages: 1, pageText: () => ['find me', 'and me'] });
      const r = renderRenderer(PdfRenderer, { name: 'm.pdf', blob: new Blob(['x']) });
      await r.ready();
      r.update({}, { query: 'me', activeIndex: 0 });
      await waitFor(() => expect(document.querySelectorAll('.dsc-pdf-hl')).toHaveLength(2));
      expect(document.querySelector('.dsc-pdf-hl--active')).toHaveStyle({
        width: '30px',
        height: '12px',
      });
    } finally {
      delete proto.getClientRects;
    }
  });
});
