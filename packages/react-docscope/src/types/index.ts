import type { ComponentType, ReactNode } from 'react';

/* -------------------------------------------------------------------------- */
/*                                  Documents                                 */
/* -------------------------------------------------------------------------- */

/** Metadata shown in the metadata panel. Any extra keys are allowed. */
export interface PreviewDocumentMetadata {
  /** Size in bytes. */
  size?: number;
  /** ISO-8601 timestamp. */
  uploadedAt?: string;
  uploadedBy?: string;
  description?: string;
  [key: string]: unknown;
}

/**
 * A document the consumer wants to preview. Only `id` and `name` are required:
 * the format is detected from `type` (MIME), `extension` or the file name.
 */
export interface PreviewDocument {
  id: string;
  name: string;
  /** MIME type, e.g. `application/pdf`. */
  type?: string;
  /** File extension without the dot, e.g. `pdf`. */
  extension?: string;
  /** Direct URL. Used by the default resolver when no resolver is supplied. */
  url?: string;
  metadata?: PreviewDocumentMetadata;
  /** Set to `false` to hide the download action for this document. */
  downloadable?: boolean;
  /**
   * Optional alternative representation, e.g. a PDF conversion of a PPTX that
   * the renderer for the original format cannot display faithfully.
   */
  fallback?: Omit<PreviewDocument, 'fallback' | 'id'> & { id?: string };
}

/* -------------------------------------------------------------------------- */
/*                                  Resolver                                  */
/* -------------------------------------------------------------------------- */

export type ResolvedDocument =
  | {
      kind: 'url';
      url: string;
      /** Extra request headers, e.g. `Authorization`. Never logged. */
      headers?: Record<string, string>;
      /** Fetch credentials mode. Defaults to `same-origin`. */
      credentials?: RequestCredentials;
      /** Overrides the MIME type reported by the document. */
      mimeType?: string;
    }
  | {
      kind: 'blob';
      blob: Blob;
      mimeType?: string;
    };

export type ResolvePurpose = 'preview' | 'download';

export interface ResolverContext {
  /** Aborted when the document is closed or switched. Pass it to `fetch`. */
  signal: AbortSignal;
  purpose: ResolvePurpose;
  /**
   * 0 on the first attempt. Incremented when the previous resolution failed
   * with an authorization error (e.g. an expired signed URL) or when the user
   * presses "Retry". Resolvers can use this to bypass their own caches.
   */
  attempt: number;
  /** Why the resolver is being called. */
  reason: 'initial' | 'expired' | 'retry';
}

/**
 * Consumer-owned document acquisition. Return a URL (optionally with headers)
 * or a Blob. The library never talks to storage providers itself.
 */
export type DocumentResolver = (
  document: PreviewDocument,
  context: ResolverContext,
) => Promise<ResolvedDocument>;

/* -------------------------------------------------------------------------- */
/*                                   Errors                                   */
/* -------------------------------------------------------------------------- */

export type PreviewErrorCode =
  | 'RESOLVE_FAILED'
  | 'FETCH_FAILED'
  | 'ACCESS_DENIED'
  | 'NOT_FOUND'
  | 'UNSUPPORTED_FORMAT'
  | 'TOO_LARGE'
  | 'EMPTY_DOCUMENT'
  | 'MALFORMED_DOCUMENT'
  | 'RENDER_FAILED'
  /** An encrypted PDF whose password prompt was dismissed. */
  | 'PASSWORD_REQUIRED'
  | 'DOWNLOAD_FAILED';

/* -------------------------------------------------------------------------- */
/*                                 Renderers                                  */
/* -------------------------------------------------------------------------- */

export type FitMode = 'none' | 'width' | 'page' | 'original';

export interface RendererCapabilities {
  zoom?: boolean;
  /** Fit modes offered in the toolbar. */
  fitModes?: FitMode[];
  rotate?: boolean;
  /** Pan by dragging when zoomed in. */
  pan?: boolean;
  /** Paged content (PDF pages, slides). */
  pages?: boolean;
  thumbnails?: boolean;
  search?: boolean;
  /** Toggle between formatted and raw source view. */
  rawView?: boolean;
  /** Continuous vs single page scrolling. */
  scrollModes?: boolean;
  /** Native media controls (video). Hides zoom/search controls. */
  media?: boolean;
  /** The renderer exposes a scroll container that can be synchronised in compare mode. */
  syncScroll?: boolean;
}

/**
 * How the preview pane should obtain the document data before handing it to
 * the renderer.
 * - `url`: the renderer can stream from a URL (video, images, PDF range requests).
 * - `blob` / `arrayBuffer` / `text`: the full file is downloaded first.
 */
export type LoadingStrategy = 'url' | 'blob' | 'arrayBuffer' | 'text';

export interface RendererDefinition {
  /** Unique id. Registering a renderer with an existing id replaces it. */
  id: string;
  /** Human readable name, e.g. "PDF". */
  label: string;
  mimeTypes: string[];
  extensions: string[];
  capabilities: RendererCapabilities;
  loadingStrategy: LoadingStrategy;
  /** Lazy component import. Heavy renderers are code-split this way. */
  load: () => Promise<{ default: ComponentType<RendererProps> }>;
  /** Optional custom matcher evaluated before MIME / extension matching. */
  match?: (document: PreviewDocument) => boolean;
  /** Higher priority wins when several renderers match. Default 0. */
  priority?: number;
  /** Upper bound in bytes for fully-downloaded formats. Overrides `config.maxFileSize`. */
  maxFileSize?: number;
  /**
   * Called when the renderer is unmounted or the document is switched, after
   * the component's own cleanup. Use it to release module-level resources.
   */
  cleanup?: () => void;
}

/** Data handed to renderers. All getters are lazy and cached. */
export interface DocumentSource {
  /** `url` when the consumer resolved to a URL, `blob` otherwise. */
  kind: 'url' | 'blob';
  /** Effective MIME type (resolver override → document type → detected). */
  mimeType: string;
  /** Size in bytes when known. */
  size?: number;
  /**
   * A URL suitable for `src` attributes. For URL sources without headers this
   * is the original URL (streaming); otherwise a managed `blob:` URL that is
   * revoked automatically.
   */
  getUrl(): Promise<string>;
  /** URL + headers for renderers that can stream with custom headers (PDF). */
  getRequest(): {
    url: string;
    headers?: Record<string, string>;
    credentials?: RequestCredentials;
  } | null;
  getBlob(): Promise<Blob>;
  getArrayBuffer(): Promise<ArrayBuffer>;
  getText(): Promise<string>;
}

export interface ViewState {
  /** Zoom factor, 1 = 100%. */
  zoom: number;
  fitMode: FitMode;
  /** Degrees, multiple of 90. */
  rotation: number;
  /** 1-based page / slide number. */
  page: number;
  scrollMode: 'continuous' | 'single';
  rawView: boolean;
  showThumbnails: boolean;
}

export interface SearchState {
  query: string;
  caseSensitive: boolean;
  /** Index of the active match, -1 when there are none. */
  activeIndex: number;
}

/** Callbacks a renderer uses to inform the surrounding UI. */
export interface RendererHost {
  setPageCount(count: number): void;
  /** Report the page currently in view (1-based). */
  setCurrentPage(page: number): void;
  setSearchResults(count: number): void;
  /** Report the effective zoom when using a fit mode. */
  setEffectiveZoom(zoom: number): void;
  /** Request a zoom change, e.g. ctrl+wheel inside the renderer. */
  requestZoom(zoom: number): void;
  /** Mark the document as rendered. Removes the loading skeleton. */
  setReady(): void;
  /** Report a fatal error (malformed document, etc.). */
  setError(code: PreviewErrorCode, message: string): void;
}

export interface RendererProps {
  document: PreviewDocument;
  source: DocumentSource;
  view: ViewState;
  search: SearchState;
  host: RendererHost;
  config: ResolvedPreviewConfig;
  /** Aborted when the renderer should stop work. */
  signal: AbortSignal;
}

/* -------------------------------------------------------------------------- */
/*                                Configuration                               */
/* -------------------------------------------------------------------------- */

export type ThemeMode = 'light' | 'dark' | 'system';

export type ShortcutAction =
  | 'search'
  | 'nextMatch'
  | 'prevMatch'
  | 'zoomIn'
  | 'zoomOut'
  | 'resetZoom'
  | 'nextPage'
  | 'prevPage'
  | 'nextDocument'
  | 'prevDocument'
  | 'rotate'
  | 'fullscreen'
  | 'download'
  | 'toggleSidebar';

/** A shortcut such as `mod+f`, `alt+ArrowRight`, `+` or `F3`. `mod` = Ctrl/⌘. */
export type ShortcutMap = Partial<Record<ShortcutAction, string[] | false>>;

export interface MetadataField {
  key: string;
  label?: string;
  format?: (value: unknown, document: PreviewDocument) => ReactNode;
}

export interface PreviewConfig {
  theme?: ThemeMode;
  /** Extra class on the root element. */
  className?: string;

  /** Inline preview dimensions. Numbers are px. */
  width?: number | string;
  height?: number | string;

  modal?: {
    width?: number | string;
    height?: number | string;
    /** Close when clicking the backdrop. Default true. */
    closeOnBackdrop?: boolean;
  };

  toolbar?: boolean;
  /** Attachment sidebar. `auto` shows it when there are 2+ documents. */
  sidebar?: boolean | 'auto';
  search?: boolean;
  download?: boolean;
  compare?: boolean;
  fullscreen?: boolean;
  /** Show the metadata panel toggle (and open it initially when `'open'`). */
  metadata?: boolean | 'open';
  /** Which metadata fields to show, in order. */
  metadataFields?: Array<string | MetadataField>;

  zoom?: {
    default?: number;
    min?: number;
    max?: number;
    step?: number;
    defaultFit?: FitMode;
  };

  pdf?: {
    scrollMode?: 'continuous' | 'single';
    /** Explicit worker URL. By default a bundled worker is created from a Blob. */
    workerSrc?: string;
    /** Base URL of pdf.js CMaps (needed for some CJK PDFs), e.g. `/pdfjs/cmaps/`. */
    cMapUrl?: string;
    /** Base URL of pdf.js standard fonts, e.g. `/pdfjs/standard_fonts/`. */
    standardFontDataUrl?: string;
    /** Base URL of pdf.js wasm decoders (JPEG2000 / JBIG2), e.g. `/pdfjs/wasm/`. */
    wasmUrl?: string;
    /** Pages rendered above/below the viewport. */
    overscan?: number;
    thumbnails?: boolean;
  };

  csv?: {
    /** `auto` detects a header row heuristically. */
    header?: boolean | 'auto';
    delimiter?: string;
  };

  /**
   * Parse XLSX workbooks in a Web Worker so large files never block the UI.
   * (CSV already streams in small chunks on the main thread.)
   * Falls back to the main thread automatically when a worker cannot start
   * (e.g. a CSP without `worker-src blob:`). Default true.
   */
  workers?: boolean;

  /** Search debounce in ms. */
  searchDebounce?: number;
  /** Maximum size (bytes) for formats that must be fully downloaded. Default 100 MB. */
  maxFileSize?: number;
  /** Retry once with a fresh resolution when a URL returns 401/403. Default true. */
  retryOnAuthError?: boolean;
  /** Prefetch neighbouring documents in multi-document mode. */
  prefetch?: 'none' | 'adjacent';
  /** Only prefetch documents whose `metadata.size` is known and below this. Default 5 MB. */
  prefetchMaxSize?: number;
  /** Memory budget for cached document data. Default 64 MB. */
  cacheSize?: number;

  shortcuts?: ShortcutMap | false;

  /** Text overrides for i18n. */
  labels?: PreviewLabelsInput;
}

/**
 * Label overrides: any subset of `PreviewLabels`; grouped labels
 * (`errorTitles`, `chartTypes`, `csvDelimiters`) may also be partial.
 */
export type PreviewLabelsInput = {
  [K in keyof PreviewLabels]?: NonNullable<PreviewLabels[K]> extends string
    ? PreviewLabels[K]
    : Partial<NonNullable<PreviewLabels[K]>>;
};

export interface PreviewLabels {
  previous: string;
  next: string;
  previousPage: string;
  nextPage: string;
  zoomIn: string;
  zoomOut: string;
  fitWidth: string;
  fitPage: string;
  originalSize: string;
  rotate: string;
  search: string;
  searchPlaceholder: string;
  matchCase: string;
  nextMatch: string;
  previousMatch: string;
  clearSearch: string;
  download: string;
  fullscreen: string;
  exitFullscreen: string;
  close: string;
  compare: string;
  exitCompare: string;
  swap: string;
  syncScroll: string;
  syncZoom: string;
  sideBySide: string;
  stacked: string;
  attachments: string;
  details: string;
  thumbnails: string;
  rawView: string;
  formattedView: string;
  singlePage: string;
  continuous: string;
  retry: string;
  noDocuments: string;
  loading: string;
  unsupported: string;
  /** PDF password prompt. */
  passwordTitle: string;
  passwordPrompt: string;
  password: string;
  passwordIncorrect: string;
  unlock: string;
  cancel: string;

  /*
   * Strings below may contain `{placeholders}`, which are filled in at render
   * time (e.g. "Page {page} of {count}"). Keep the placeholders when translating.
   */

  /** Workspace chrome. */
  /** {name} */
  unsupportedDetail: string;
  documentTools: string;
  pagesGroup: string;
  zoomGroup: string;
  /** {percent} */
  zoomStatus: string;
  resetZoom: string;
  fitWindow: string;
  showOriginal: string;
  showConverted: string;
  convertedNotice: string;
  tryOriginal: string;
  /** {page} {count} */
  pageOf: string;
  /** {index} {count} */
  documentCounter: string;
  modalDescription: string;
  compareTools: string;
  resizePanes: string;
  leftDocument: string;
  rightDocument: string;
  searching: string;
  noResults: string;
  /** {current} {total} */
  matchOf: string;

  /** Details panel. */
  fieldName: string;
  fieldType: string;
  fieldSize: string;
  fieldUploadedAt: string;
  fieldUploadedBy: string;
  fieldDescription: string;
  yes: string;
  no: string;

  /** Error state titles, per error code. */
  errorTitles: Record<PreviewErrorCode, string>;
  /**
   * Optional per-code messages shown instead of the renderer's detailed
   * (English) message. Locale packs set these.
   */
  errorMessages?: Partial<Record<PreviewErrorCode, string>>;

  /** PDF / PPTX. {page} / {slide} */
  page: string;
  pageThumbnails: string;
  slide: string;
  slideThumbnails: string;
  /** {type} {series} */
  chartLabel: string;
  chartTypes: Record<'bar' | 'line' | 'area' | 'pie' | 'scatter' | 'radar', string>;
  /** {index} */
  chartSeries: string;

  /** XLSX. */
  worksheets: string;
  readOnly: string;
  /** {count} */
  hiddenSheet: string;
  /** {count} */
  hiddenSheets: string;

  /** CSV. {rows} {columns} {delimiter} */
  csvSummary: string;
  csvDelimiters: { comma: string; semicolon: string; tab: string; pipe: string };
  csvLoading: string;
  /** {rows} */
  csvTruncated: string;
  csvHeaderRow: string;

  /** JSON / XML / Markdown. {name} */
  sourceLabel: string;
  /** {line} {column} */
  errorPosition: string;
  invalidJson: string;
  invalidXml: string;
  copyPath: string;
  /** {path} */
  copyPathOf: string;
  copied: string;
  expand: string;
  collapse: string;
  expandAll: string;
  collapseAll: string;
  nodeDetails: string;
  attributes: string;
  attribute: string;
  value: string;
  selectNode: string;
}

export type ResolvedPreviewConfig = Required<
  Omit<
    PreviewConfig,
    'modal' | 'zoom' | 'pdf' | 'csv' | 'labels' | 'shortcuts' | 'className' | 'width' | 'height'
  >
> & {
  className?: string;
  width: number | string;
  height: number | string;
  modal: Required<NonNullable<PreviewConfig['modal']>>;
  zoom: Required<NonNullable<PreviewConfig['zoom']>>;
  pdf: Required<Pick<NonNullable<PreviewConfig['pdf']>, 'scrollMode' | 'overscan' | 'thumbnails'>> &
    Pick<
      NonNullable<PreviewConfig['pdf']>,
      'workerSrc' | 'cMapUrl' | 'standardFontDataUrl' | 'wasmUrl'
    >;
  csv: { header: boolean | 'auto'; delimiter?: string };
  labels: PreviewLabels;
  shortcuts: Record<ShortcutAction, string[]>;
};

/* -------------------------------------------------------------------------- */
/*                           Extensibility & callbacks                        */
/* -------------------------------------------------------------------------- */

export interface ToolbarActionContext {
  document: PreviewDocument;
  index: number;
  /** Close the modal (no-op inline). */
  close: () => void;
}

export interface ToolbarAction {
  id: string;
  label: string;
  icon?: ReactNode;
  onClick: (context: ToolbarActionContext) => void;
  /** Hide for some documents. */
  isVisible?: (document: PreviewDocument) => boolean;
  disabled?: boolean | ((document: PreviewDocument) => boolean);
}

export interface DownloadContext {
  /** Runs the built-in download (resolver with purpose `download`). */
  defaultDownload: () => Promise<void>;
  signal: AbortSignal;
}

/**
 * Override downloads. Return `false` (or resolve to it) to cancel. Call
 * `context.defaultDownload()` to delegate to the built-in behaviour.
 */
export type DownloadHandler = (
  document: PreviewDocument,
  context: DownloadContext,
) => void | boolean | Promise<void | boolean>;

export interface MetadataRenderContext {
  document: PreviewDocument;
  /** Fields that would be rendered by default. */
  fields: Array<{ key: string; label: string; value: ReactNode }>;
}

export interface PreviewError {
  code: PreviewErrorCode;
  /** Message safe to display and log (never contains URLs or headers). */
  message: string;
  documentId?: string;
  /** HTTP status when the failure came from a request. */
  status?: number;
  cause?: unknown;
}

export interface PreviewCallbacks {
  onDocumentChange?: (document: PreviewDocument, index: number) => void;
  onError?: (error: PreviewError, document: PreviewDocument) => void;
  onDownload?: DownloadHandler;
  /** Fired when a document has finished rendering. */
  onLoad?: (document: PreviewDocument) => void;
}

/** Built-in format identifiers. */
export type BuiltInFormat =
  | 'pdf'
  | 'image'
  | 'docx'
  | 'pptx'
  | 'markdown'
  | 'text'
  | 'video'
  | 'xlsx'
  | 'csv'
  | 'json'
  | 'xml';
