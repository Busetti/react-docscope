import { memo, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { RendererProps } from '../../types';
import { isAbortError, toPreviewError } from '../../core/errors';
import { useAsync, useDomSearch, useElementSize, useLatest, useWheelZoom } from '../shared/hooks';
import {
  borderOf,
  fillToCss,
  safeContent,
  slideText,
  transformOf,
  type PptxDeck,
  type PptxElement,
  type PptxSlide,
} from './slideModel';

const GAP = 24;
const PT_TO_PX = 96 / 72;

/**
 * Best-effort PPTX preview built on pptxtojson (MIT): text, shapes (with
 * preset/custom geometry paths), images, tables, groups and backgrounds.
 * Charts, SmartArt styling, animations, embedded media and some effects are
 * not rendered faithfully — supply `document.fallback` (e.g. a PDF export) for
 * pixel-perfect output.
 */
export default function PptxRenderer({ document, source, search, view, host }: RendererProps) {
  const hostRef = useLatest(host);
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const size = useElementSize(scrollRef);

  const { value: deck, error } = useAsync<PptxDeck>(async () => {
    const [buffer, lib] = await Promise.all([source.getArrayBuffer(), import('pptxtojson')]);
    try {
      const parsed = await lib.parse(buffer, {
        imageMode: 'base64',
        videoMode: 'none',
        audioMode: 'none',
      });
      return parsed as unknown as PptxDeck;
    } catch (e) {
      throw Object.assign(
        new Error('This presentation could not be read. It may be damaged or not a .pptx file.'),
        { cause: e, malformed: true },
      );
    }
  }, [source]);

  useEffect(() => {
    if (!error) return;
    if (isAbortError(error)) return;
    const malformed = (error as { malformed?: boolean }).malformed;
    const e = toPreviewError(error, malformed ? 'MALFORMED_DOCUMENT' : 'FETCH_FAILED');
    hostRef.current.setError(malformed ? 'MALFORMED_DOCUMENT' : e.code, e.message);
  }, [error, hostRef]);

  useEffect(() => {
    if (!deck) return;
    if (!deck.slides?.length)
      hostRef.current.setError('EMPTY_DOCUMENT', 'This presentation has no slides.');
    else {
      hostRef.current.setPageCount(deck.slides.length);
      hostRef.current.setReady();
    }
  }, [deck, hostRef]);

  const slideW = (deck?.size.width ?? 960) * PT_TO_PX;
  const slideH = (deck?.size.height ?? 540) * PT_TO_PX;
  const availW = Math.max(100, size.width - GAP * 2);
  const availH = Math.max(100, size.height - GAP * 2);
  const fitZoom =
    view.fitMode === 'width'
      ? availW / slideW
      : view.fitMode === 'page'
        ? Math.min(availW / slideW, availH / slideH)
        : null;
  const zoom = Math.max(0.05, fitZoom ?? view.zoom);
  useEffect(() => {
    if (deck) hostRef.current.setEffectiveZoom(zoom);
  }, [zoom, deck, hostRef]);
  useWheelZoom(scrollRef, zoom, host);
  useDomSearch(
    contentRef,
    scrollRef,
    search,
    host,
    deck ? `${deck.slides.length}:${zoom}` : null,
    false,
  );

  // Track the slide in view and react to page requests.
  const lastReported = useRef(0);
  useEffect(() => {
    const root = scrollRef.current;
    if (!root || !deck) return;
    const onScroll = () => {
      const pageH = slideH * zoom + GAP;
      const current = Math.min(
        deck.slides.length,
        Math.max(1, Math.floor((root.scrollTop + root.clientHeight / 3) / pageH) + 1),
      );
      if (current !== lastReported.current) {
        lastReported.current = current;
        hostRef.current.setCurrentPage(current);
      }
    };
    root.addEventListener('scroll', onScroll, { passive: true });
    return () => root.removeEventListener('scroll', onScroll);
  }, [deck, slideH, zoom, hostRef]);

  useEffect(() => {
    const root = scrollRef.current;
    if (!root || !deck || view.page === lastReported.current) return;
    lastReported.current = view.page;
    const target = root.querySelector<HTMLElement>(`[data-slide="${view.page}"]`);
    if (target) root.scrollTo({ top: target.offsetTop - GAP });
  }, [view.page, deck]);

  if (!deck?.slides?.length) return null;
  return (
    <div className="dsc-paged">
      {view.showThumbnails && (
        <nav className="dsc-thumbs" aria-label="Slide thumbnails" data-dsc-search-ignore="">
          {deck.slides.map((slide, i) => (
            <button
              key={i}
              type="button"
              className="dsc-thumb"
              aria-current={view.page === i + 1 ? 'true' : undefined}
              aria-label={`Slide ${i + 1}: ${slideText(slide).slice(0, 80)}`}
              onClick={() => hostRef.current.setCurrentPage(i + 1)}
            >
              <LazySlide
                slide={slide}
                width={slideW}
                height={slideH}
                zoom={140 / slideW}
                root={null}
                index={i}
              />
              <span className="dsc-thumb-label">{i + 1}</span>
            </button>
          ))}
        </nav>
      )}
      <div
        ref={scrollRef}
        className="dsc-scroll dsc-slides"
        data-dsc-scroll-container=""
        tabIndex={0}
        aria-label={document.name}
      >
        <div ref={contentRef} className="dsc-slides-inner" style={{ padding: GAP, gap: GAP }}>
          {deck.slides.map((slide, i) => (
            <LazySlide
              key={i}
              slide={slide}
              width={slideW}
              height={slideH}
              zoom={zoom}
              root={scrollRef.current}
              index={i}
              eager={i < 2}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

/** Renders the slide only when it is near the viewport. */
function LazySlide({
  slide,
  width,
  height,
  zoom,
  root,
  index,
  eager = false,
}: {
  slide: PptxSlide;
  width: number;
  height: number;
  zoom: number;
  root: HTMLElement | null;
  index: number;
  eager?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(eager);
  useEffect(() => {
    if (visible || !ref.current || typeof IntersectionObserver === 'undefined') {
      if (typeof IntersectionObserver === 'undefined') setVisible(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { root, rootMargin: '600px 0px' },
    );
    io.observe(ref.current);
    return () => io.disconnect();
  }, [visible, root]);

  return (
    <div
      ref={ref}
      className="dsc-slide-frame"
      data-slide={index + 1}
      role="group"
      aria-roledescription="slide"
      aria-label={`Slide ${index + 1}`}
      style={{ width: width * zoom, height: height * zoom }}
    >
      {visible && <SlideView slide={slide} width={width} height={height} zoom={zoom} />}
    </div>
  );
}

const SlideView = memo(function SlideView({
  slide,
  width,
  height,
  zoom,
}: {
  slide: PptxSlide;
  width: number;
  height: number;
  zoom: number;
}) {
  return (
    <div
      className="dsc-slide"
      style={{
        width: `${width / PT_TO_PX}pt`,
        height: `${height / PT_TO_PX}pt`,
        transform: `scale(${zoom})`,
        ...fillToCss(slide.fill),
      }}
    >
      {(slide.layoutElements ?? []).map((el, i) => (
        <SlideElement key={`l${i}`} el={el} />
      ))}
      {slide.elements.map((el, i) => (
        <SlideElement key={i} el={el} />
      ))}
    </div>
  );
});

function box(el: PptxElement): CSSProperties {
  return {
    left: `${el.left}pt`,
    top: `${el.top}pt`,
    width: `${el.width}pt`,
    height: `${el.height}pt`,
    transform: transformOf(el),
  };
}

const VALIGN: Record<string, CSSProperties['justifyContent']> = {
  up: 'flex-start',
  top: 'flex-start',
  mid: 'center',
  middle: 'center',
  down: 'flex-end',
  bottom: 'flex-end',
};

export function SlideElement({ el }: { el: PptxElement }) {
  switch (el.type) {
    case 'text':
    case 'shape': {
      const usePath = el.type === 'shape' && el.path && el.pathViewBox && el.shapType !== 'rect';
      const css: CSSProperties = {
        ...box(el),
        ...(usePath ? {} : fillToCss(el.fill)),
        ...(usePath ? {} : borderOf(el)),
        justifyContent: VALIGN[el.vAlign ?? 'up'] ?? 'flex-start',
        writingMode: el.isVertical ? 'vertical-rl' : undefined,
      };
      if (!usePath && el.shapType === 'ellipse') css.borderRadius = '50%';
      if (!usePath && el.shapType === 'roundRect') css.borderRadius = '12%';
      const fill = fillToCss(el.fill);
      return (
        <div className="dsc-slide-el dsc-slide-text" style={css}>
          {usePath && (
            <svg
              className="dsc-slide-shape"
              viewBox={`${el.pathViewBox!.x} ${el.pathViewBox!.y} ${el.pathViewBox!.width} ${el.pathViewBox!.height}`}
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <path
                d={el.path}
                fill={
                  typeof fill.background === 'string' && !fill.background.includes('gradient')
                    ? fill.background
                    : el.fill
                      ? '#ccc'
                      : 'none'
                }
                stroke={el.borderWidth ? el.borderColor : 'none'}
                strokeWidth={el.borderWidth ? el.borderWidth : 0}
                vectorEffect="non-scaling-stroke"
              />
            </svg>
          )}
          {el.content && (
            <div
              className="dsc-slide-content"
              dangerouslySetInnerHTML={{ __html: safeContent(el.content) }}
            />
          )}
        </div>
      );
    }
    case 'image':
      return el.base64?.startsWith('data:image/') ? (
        <img
          className="dsc-slide-el"
          style={{ ...box(el), ...borderOf(el), objectFit: 'fill' }}
          src={el.base64}
          alt=""
          draggable={false}
        />
      ) : null;
    case 'math':
      return el.picBase64?.startsWith('data:image/') ? (
        <img className="dsc-slide-el" style={box(el)} src={el.picBase64} alt={el.latex ?? ''} />
      ) : (
        <div className="dsc-slide-el dsc-slide-text" style={box(el)}>
          {el.text ?? el.latex}
        </div>
      );
    case 'table':
      return <SlideTable el={el} />;
    case 'group':
    case 'diagram':
      return (
        <div className="dsc-slide-el" style={box(el)}>
          {(el.elements ?? []).map((child, i) => (
            <SlideElement key={i} el={child} />
          ))}
        </div>
      );
    case 'chart':
      return (
        <div className="dsc-slide-el dsc-slide-placeholder" style={box(el)}>
          Chart ({el.chartType ?? 'chart'}) — not rendered in preview
        </div>
      );
    case 'video':
    case 'audio':
      return (
        <div className="dsc-slide-el dsc-slide-placeholder" style={box(el)}>
          Embedded {el.type} — not played in preview
        </div>
      );
    default:
      return null;
  }
}

interface TableCell {
  text?: string;
  rowSpan?: number;
  colSpan?: number;
  vMerge?: number;
  hMerge?: number;
  fillColor?: string;
  fontColor?: string;
  fontBold?: boolean;
}

function SlideTable({ el }: { el: PptxElement }) {
  const data = (Array.isArray(el.data) ? el.data : []) as TableCell[][];
  const widths = useMemo(() => el.colWidths ?? [], [el.colWidths]);
  return (
    <div className="dsc-slide-el" style={box(el)}>
      <table className="dsc-slide-table">
        <colgroup>
          {widths.map((w, i) => (
            <col key={i} style={{ width: `${w}pt` }} />
          ))}
        </colgroup>
        <tbody>
          {data.map((row, r) => (
            <tr
              key={r}
              style={{ height: el.rowHeights?.[r] ? `${el.rowHeights[r]}pt` : undefined }}
            >
              {row.map((cell, c) =>
                cell.hMerge || cell.vMerge ? null : (
                  <td
                    key={c}
                    rowSpan={cell.rowSpan}
                    colSpan={cell.colSpan}
                    style={{
                      background: cell.fillColor,
                      color: cell.fontColor,
                      fontWeight: cell.fontBold ? 700 : undefined,
                    }}
                    dangerouslySetInnerHTML={{ __html: safeContent(cell.text) }}
                  />
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
