import { memo, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import {
  ChevronDown,
  ChevronUp,
  Code,
  Eye,
  GalleryVertical,
  LayoutGrid,
  MoveHorizontal,
  Ratio,
  RotateCw,
  Scan,
  ScrollText,
  Search,
  StickyNote,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type { PreviewLabels, RendererCapabilities, ResolvedPreviewConfig } from '../types';
import type { PaneController } from '../hooks/usePaneController';
import { IconButton, Separator } from './IconButton';
import { fillLabel } from '../core/format';

const ICON = 18;

export interface PaneToolbarProps {
  controller: PaneController;
  config: ResolvedPreviewConfig;
  labels: PreviewLabels;
  /** Compact mode for compare panes. */
  compact?: boolean;
  /** Extra items rendered at the start (document navigation). */
  start?: ReactNode;
  /** Extra items rendered at the end (download, compare, custom actions…). */
  end?: ReactNode;
}

function shortcutHint(
  config: ResolvedPreviewConfig,
  action: keyof ResolvedPreviewConfig['shortcuts'],
): string | undefined {
  const combo = config.shortcuts[action][0];
  if (!combo) return undefined;
  const apple =
    typeof navigator !== 'undefined' && /mac|iphone|ipad/i.test(navigator.platform || '');
  return combo.replace(/mod/i, apple ? '⌘' : 'Ctrl').replace(/\+(?=.)/g, apple ? '' : '+');
}

/** Capability-driven controls for one pane. Controls a renderer can't use are not shown. */
export const PaneToolbar = memo(function PaneToolbar({
  controller: c,
  config,
  labels,
  compact,
  start,
  end,
}: PaneToolbarProps) {
  const caps: RendererCapabilities =
    c.status === 'ready' || c.status === 'rendering' ? (c.definition?.capabilities ?? {}) : {};
  const fits = caps.fitModes ?? [];
  const zoomPct = Math.round(c.displayZoom * 100);

  return (
    <div
      className={`dsc-toolbar${compact ? ' dsc-toolbar--compact' : ''}`}
      role="toolbar"
      aria-label={labels.documentTools}
    >
      {start}
      {caps.pages && c.pageCount > 0 && (
        <div className="dsc-group" role="group" aria-label={labels.pagesGroup}>
          <IconButton
            label={labels.previousPage}
            icon={<ChevronUp size={ICON} />}
            onClick={c.actions.prevPage}
            disabled={c.view.page <= 1}
            shortcut={shortcutHint(config, 'prevPage')}
          />
          <PageInput
            page={c.view.page}
            count={c.pageCount}
            onChange={c.actions.goToPage}
            label={labels.pageOf}
          />
          <IconButton
            label={labels.nextPage}
            icon={<ChevronDown size={ICON} />}
            onClick={c.actions.nextPage}
            disabled={c.view.page >= c.pageCount}
            shortcut={shortcutHint(config, 'nextPage')}
          />
        </div>
      )}
      {caps.zoom && (
        <>
          {caps.pages && c.pageCount > 0 && <Separator />}
          <div className="dsc-group" role="group" aria-label={labels.zoomGroup}>
            <IconButton
              label={labels.zoomOut}
              icon={<ZoomOut size={ICON} />}
              onClick={c.actions.zoomOut}
              disabled={c.displayZoom <= config.zoom.min}
              shortcut={shortcutHint(config, 'zoomOut')}
            />
            <button
              type="button"
              className="dsc-zoom-value"
              onClick={c.actions.resetZoom}
              aria-label={fillLabel(labels.zoomStatus, { percent: zoomPct })}
              title={labels.resetZoom}
            >
              {zoomPct}%
            </button>
            <IconButton
              label={labels.zoomIn}
              icon={<ZoomIn size={ICON} />}
              onClick={c.actions.zoomIn}
              disabled={c.displayZoom >= config.zoom.max}
              shortcut={shortcutHint(config, 'zoomIn')}
            />
            {fits.includes('width') && (
              <IconButton
                label={labels.fitWidth}
                icon={<MoveHorizontal size={ICON} />}
                pressed={c.view.fitMode === 'width'}
                onClick={() => c.actions.setFitMode('width')}
              />
            )}
            {fits.includes('page') && (
              <IconButton
                label={c.definition?.id === 'image' ? labels.fitWindow : labels.fitPage}
                icon={<Scan size={ICON} />}
                pressed={c.view.fitMode === 'page'}
                onClick={() => c.actions.setFitMode('page')}
              />
            )}
            {fits.includes('original') && (
              <IconButton
                label={labels.originalSize}
                icon={<Ratio size={ICON} />}
                pressed={c.view.fitMode === 'original'}
                onClick={() => c.actions.setFitMode('original')}
              />
            )}
          </div>
        </>
      )}
      {(caps.rotate || caps.thumbnails || caps.rawView || caps.scrollModes) && <Separator />}
      {caps.rotate && (
        <IconButton
          label={labels.rotate}
          icon={<RotateCw size={ICON} />}
          onClick={() => c.actions.rotate(90)}
          shortcut={shortcutHint(config, 'rotate')}
        />
      )}
      {caps.thumbnails && !compact && (
        <IconButton
          label={labels.thumbnails}
          icon={<LayoutGrid size={ICON} />}
          pressed={c.view.showThumbnails}
          onClick={c.actions.toggleThumbnails}
        />
      )}
      {caps.scrollModes && (
        <IconButton
          label={c.view.scrollMode === 'single' ? labels.continuous : labels.singlePage}
          icon={
            c.view.scrollMode === 'single' ? <ScrollText size={ICON} /> : <StickyNote size={ICON} />
          }
          onClick={c.actions.toggleScrollMode}
        />
      )}
      {caps.rawView && (
        <IconButton
          label={c.view.rawView ? labels.formattedView : labels.rawView}
          icon={c.view.rawView ? <Eye size={ICON} /> : <Code size={ICON} />}
          pressed={c.view.rawView}
          onClick={c.actions.toggleRawView}
        />
      )}
      {c.canUseFallback && !compact && (
        <IconButton
          label={c.usingFallback ? labels.showOriginal : labels.showConverted}
          icon={<GalleryVertical size={ICON} />}
          pressed={c.usingFallback}
          onClick={c.actions.toggleFallback}
        />
      )}
      <span className="dsc-spacer" />
      {caps.search && config.search && (
        <IconButton
          label={labels.search}
          icon={<Search size={ICON} />}
          pressed={c.search.open}
          onClick={c.search.open ? c.actions.closeSearch : c.actions.openSearch}
          shortcut={shortcutHint(config, 'search')}
        />
      )}
      {end}
    </div>
  );
});

function PageInput({
  page,
  count,
  onChange,
  label,
}: {
  page: number;
  count: number;
  onChange: (p: number) => void;
  label: string;
}) {
  const [value, setValue] = useState(String(page));
  useEffect(() => setValue(String(page)), [page]);
  return (
    <span className="dsc-page-input">
      <input
        type="text"
        inputMode="numeric"
        aria-label={fillLabel(label, { page, count })}
        value={value}
        size={Math.max(2, String(count).length)}
        onChange={(e) => setValue(e.target.value.replace(/[^\d]/g, ''))}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onChange(Number(value));
        }}
        onBlur={() => onChange(Number(value) || page)}
      />
      <span aria-hidden="true">/ {count}</span>
    </span>
  );
}
