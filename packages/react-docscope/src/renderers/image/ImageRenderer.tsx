import { useEffect, useRef, useState } from 'react';
import type { PointerEvent } from 'react';
import type { RendererProps } from '../../types';
import { toPreviewError } from '../../core/errors';
import { useAsync, useElementSize, useWheelZoom } from '../shared/hooks';

const PADDING = 24;

export function computeImageScale(
  fit: RendererProps['view']['fitMode'],
  zoom: number,
  natural: { width: number; height: number },
  container: { width: number; height: number },
  rotation: number,
  allowUpscale: boolean,
): number {
  if (fit === 'original') return 1;
  if (fit !== 'page' && fit !== 'width') return zoom;
  const rotated = Math.abs(rotation % 180) === 90;
  const w = rotated ? natural.height : natural.width;
  const h = rotated ? natural.width : natural.height;
  if (!w || !h || container.width <= 0 || container.height <= 0) return 1;
  const availW = Math.max(1, container.width - PADDING * 2);
  const availH = Math.max(1, container.height - PADDING * 2);
  const s = fit === 'width' ? availW / w : Math.min(availW / w, availH / h);
  return allowUpscale ? s : Math.min(1, s);
}

export default function ImageRenderer({ document, source, view, host }: RendererProps) {
  const { value: url, error } = useAsync(() => source.getUrl(), [source]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const size = useElementSize(scrollRef);
  const [natural, setNatural] = useState({ width: 0, height: 0 });
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const isSvg = source.mimeType === 'image/svg+xml';

  useEffect(() => {
    if (error) {
      const e = toPreviewError(error, 'FETCH_FAILED');
      host.setError(e.code, e.message);
    }
  }, [error, host]);

  const scale = computeImageScale(view.fitMode, view.zoom, natural, size, view.rotation, isSvg);
  useEffect(() => {
    if (natural.width) host.setEffectiveZoom(scale);
  }, [scale, natural.width, host]);
  useWheelZoom(scrollRef, scale, host);

  const rotated = Math.abs(view.rotation % 180) === 90;
  const w = natural.width * scale;
  const h = natural.height * scale;
  const boxW = rotated ? h : w;
  const boxH = rotated ? w : h;
  const canPan = boxW + PADDING * 2 > size.width || boxH + PADDING * 2 > size.height;

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    const el = scrollRef.current;
    if (!el || !canPan || e.button !== 0) return;
    drag.current = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop };
    el.setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const el = scrollRef.current;
    const d = drag.current;
    if (!el || !d) return;
    el.scrollLeft = d.left - (e.clientX - d.x);
    el.scrollTop = d.top - (e.clientY - d.y);
  };
  const endDrag = (e: PointerEvent<HTMLDivElement>) => {
    drag.current = null;
    scrollRef.current?.releasePointerCapture?.(e.pointerId);
  };

  return (
    <div
      ref={scrollRef}
      className="dsc-scroll dsc-image"
      data-dsc-scroll-container=""
      data-pannable={canPan ? 'true' : 'false'}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      {url && (
        <div
          className="dsc-image-stage"
          style={{ width: boxW || undefined, height: boxH || undefined }}
        >
          <img
            src={url}
            alt={document.name}
            draggable={false}
            decoding="async"
            onLoad={(e) => {
              const img = e.currentTarget;
              setNatural({ width: img.naturalWidth || 300, height: img.naturalHeight || 150 });
              host.setReady();
            }}
            onError={() => host.setError('MALFORMED_DOCUMENT', 'This image could not be decoded.')}
            style={{
              width: w || undefined,
              height: h || undefined,
              transform: `translate(-50%, -50%) rotate(${view.rotation}deg)`,
              visibility: natural.width ? 'visible' : 'hidden',
            }}
          />
        </div>
      )}
    </div>
  );
}
