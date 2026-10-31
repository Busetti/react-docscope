import type {
  PreviewConfig,
  PreviewLabels,
  ResolvedPreviewConfig,
  ShortcutAction,
  ShortcutMap,
} from '../types';

export const DEFAULT_LABELS: PreviewLabels = {
  previous: 'Previous document',
  next: 'Next document',
  previousPage: 'Previous page',
  nextPage: 'Next page',
  zoomIn: 'Zoom in',
  zoomOut: 'Zoom out',
  fitWidth: 'Fit width',
  fitPage: 'Fit page',
  originalSize: 'Original size',
  rotate: 'Rotate',
  search: 'Search',
  searchPlaceholder: 'Search in document',
  matchCase: 'Match case',
  nextMatch: 'Next match',
  previousMatch: 'Previous match',
  clearSearch: 'Clear search',
  download: 'Download',
  fullscreen: 'Fullscreen',
  exitFullscreen: 'Exit fullscreen',
  close: 'Close',
  compare: 'Compare',
  exitCompare: 'Exit compare',
  swap: 'Swap documents',
  syncScroll: 'Synchronise scrolling',
  syncZoom: 'Synchronise zoom',
  sideBySide: 'Side by side',
  stacked: 'Stacked',
  attachments: 'Attachments',
  details: 'Details',
  thumbnails: 'Thumbnails',
  rawView: 'Show source',
  formattedView: 'Show formatted',
  singlePage: 'Single page',
  continuous: 'Continuous scroll',
  retry: 'Retry',
  noDocuments: 'No documents to preview',
  loading: 'Loading document',
  unsupported: 'Preview not available',
};

export const DEFAULT_SHORTCUTS: Record<ShortcutAction, string[]> = {
  search: ['mod+f'],
  nextMatch: ['F3'],
  prevMatch: ['shift+F3'],
  zoomIn: ['mod+=', 'mod++', '+', '='],
  zoomOut: ['mod+-', '-'],
  resetZoom: ['mod+0', '0'],
  nextPage: ['PageDown'],
  prevPage: ['PageUp'],
  nextDocument: ['alt+ArrowRight', ']'],
  prevDocument: ['alt+ArrowLeft', '['],
  rotate: ['r'],
  fullscreen: ['f'],
  download: ['mod+s'],
  toggleSidebar: ['mod+b'],
};

const MB = 1024 * 1024;

export const DEFAULT_CONFIG: ResolvedPreviewConfig = {
  theme: 'system',
  width: '100%',
  height: 600,
  modal: { width: 'min(1200px, 94vw)', height: 'min(860px, 92vh)', closeOnBackdrop: true },
  toolbar: true,
  sidebar: 'auto',
  search: true,
  download: true,
  compare: true,
  fullscreen: true,
  metadata: true,
  metadataFields: ['type', 'size', 'uploadedAt', 'uploadedBy', 'description'],
  zoom: { default: 1, min: 0.1, max: 8, step: 0.25, defaultFit: 'width' },
  pdf: { scrollMode: 'continuous', overscan: 2, thumbnails: false },
  csv: { header: 'auto' },
  searchDebounce: 200,
  maxFileSize: 100 * MB,
  retryOnAuthError: true,
  prefetch: 'adjacent',
  prefetchMaxSize: 5 * MB,
  cacheSize: 64 * MB,
  shortcuts: DEFAULT_SHORTCUTS,
  labels: DEFAULT_LABELS,
};

function resolveShortcuts(
  input: ShortcutMap | false | undefined,
): Record<ShortcutAction, string[]> {
  if (input === false) {
    return Object.fromEntries(
      Object.keys(DEFAULT_SHORTCUTS).map((k) => [k, []]),
    ) as unknown as Record<ShortcutAction, string[]>;
  }
  const result = { ...DEFAULT_SHORTCUTS };
  if (input) {
    for (const [action, combos] of Object.entries(input) as Array<
      [ShortcutAction, string[] | false]
    >) {
      if (!(action in DEFAULT_SHORTCUTS)) continue;
      result[action] = combos === false ? [] : [...combos];
    }
  }
  return result;
}

function clampNumber(value: unknown, fallback: number, min: number, max = Infinity): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;
}

/**
 * Merges partial configs (later wins) onto the defaults. Invalid values fall
 * back to defaults so a bad config never breaks rendering.
 */
export function resolveConfig(...configs: Array<PreviewConfig | undefined>): ResolvedPreviewConfig {
  const merged: PreviewConfig = {};
  let shortcuts: ShortcutMap | false | undefined;
  for (const c of configs) {
    if (!c) continue;
    Object.assign(merged, c, {
      modal: { ...merged.modal, ...c.modal },
      zoom: { ...merged.zoom, ...c.zoom },
      pdf: { ...merged.pdf, ...c.pdf },
      csv: { ...merged.csv, ...c.csv },
      labels: { ...merged.labels, ...c.labels },
    });
    if (c.shortcuts === false) shortcuts = false;
    else if (c.shortcuts) shortcuts = { ...(shortcuts || {}), ...c.shortcuts };
  }
  const d = DEFAULT_CONFIG;
  const zoomMin = clampNumber(merged.zoom?.min, d.zoom.min, 0.01, 100);
  const zoomMax = clampNumber(merged.zoom?.max, d.zoom.max, zoomMin, 100);
  const theme =
    merged.theme === 'light' || merged.theme === 'dark' || merged.theme === 'system'
      ? merged.theme
      : d.theme;
  const prefetch =
    merged.prefetch === 'none' || merged.prefetch === 'adjacent' ? merged.prefetch : d.prefetch;
  const scrollMode =
    merged.pdf?.scrollMode === 'single' || merged.pdf?.scrollMode === 'continuous'
      ? merged.pdf.scrollMode
      : d.pdf.scrollMode;
  const defaultFit = merged.zoom?.defaultFit ?? d.zoom.defaultFit;

  const resolved: ResolvedPreviewConfig = {
    theme,
    width: merged.width ?? d.width,
    height: merged.height ?? d.height,
    modal: {
      width: merged.modal?.width ?? d.modal.width,
      height: merged.modal?.height ?? d.modal.height,
      closeOnBackdrop: merged.modal?.closeOnBackdrop ?? d.modal.closeOnBackdrop,
    },
    toolbar: merged.toolbar ?? d.toolbar,
    sidebar: merged.sidebar ?? d.sidebar,
    search: merged.search ?? d.search,
    download: merged.download ?? d.download,
    compare: merged.compare ?? d.compare,
    fullscreen: merged.fullscreen ?? d.fullscreen,
    metadata: merged.metadata ?? d.metadata,
    metadataFields: merged.metadataFields ?? d.metadataFields,
    zoom: {
      min: zoomMin,
      max: zoomMax,
      default: clampNumber(merged.zoom?.default, d.zoom.default, zoomMin, zoomMax),
      step: clampNumber(merged.zoom?.step, d.zoom.step, 0.01, 10),
      defaultFit: ['none', 'width', 'page', 'original'].includes(defaultFit)
        ? defaultFit
        : d.zoom.defaultFit,
    },
    pdf: {
      scrollMode,
      overscan: Math.round(clampNumber(merged.pdf?.overscan, d.pdf.overscan, 0, 20)),
      thumbnails: merged.pdf?.thumbnails ?? d.pdf.thumbnails,
      ...(merged.pdf?.workerSrc ? { workerSrc: merged.pdf.workerSrc } : {}),
      ...(merged.pdf?.cMapUrl ? { cMapUrl: merged.pdf.cMapUrl } : {}),
      ...(merged.pdf?.standardFontDataUrl
        ? { standardFontDataUrl: merged.pdf.standardFontDataUrl }
        : {}),
      ...(merged.pdf?.wasmUrl ? { wasmUrl: merged.pdf.wasmUrl } : {}),
    },
    csv: {
      header: merged.csv?.header ?? d.csv.header,
      ...(merged.csv?.delimiter ? { delimiter: merged.csv.delimiter } : {}),
    },
    searchDebounce: clampNumber(merged.searchDebounce, d.searchDebounce, 0, 5000),
    maxFileSize: clampNumber(merged.maxFileSize, d.maxFileSize, 1),
    retryOnAuthError: merged.retryOnAuthError ?? d.retryOnAuthError,
    prefetch,
    prefetchMaxSize: clampNumber(merged.prefetchMaxSize, d.prefetchMaxSize, 0),
    cacheSize: clampNumber(merged.cacheSize, d.cacheSize, 0),
    shortcuts: resolveShortcuts(shortcuts),
    labels: { ...DEFAULT_LABELS, ...merged.labels },
  };
  if (merged.className) resolved.className = merged.className;
  return resolved;
}
