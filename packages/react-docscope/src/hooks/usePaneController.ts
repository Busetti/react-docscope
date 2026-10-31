import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { ComponentType } from 'react';
import type {
  FitMode,
  PreviewCallbacks,
  PreviewDocument,
  PreviewError,
  PreviewErrorCode,
  RendererDefinition,
  RendererHost,
  RendererProps,
  ViewState,
} from '../types';
import type { PreviewEnvironment } from '../components/context';
import { DocumentPreviewError, defaultMessage, isAbortError, toPreviewError } from '../core/errors';
import { downloadDocument } from '../core/download';
import { loadDocumentSource, type ManagedSource } from '../core/source';
import { clamp } from '../core/format';
import { wrapIndex } from '../core/search';
import { useDebouncedValue } from './utils';

export type PaneStatus = 'idle' | 'loading' | 'rendering' | 'ready' | 'error' | 'unsupported';

const componentCache = new Map<string, Promise<ComponentType<RendererProps>>>();

function loadComponent(def: RendererDefinition): Promise<ComponentType<RendererProps>> {
  let p = componentCache.get(def.id);
  if (!p) {
    p = def.load().then((m) => m.default);
    componentCache.set(def.id, p);
    p.catch(() => componentCache.delete(def.id));
  }
  return p;
}

/** Clears the lazy component cache (tests / hot reload). */
export function clearRendererComponentCache(): void {
  componentCache.clear();
}

interface LoadState {
  status: PaneStatus;
  definition?: RendererDefinition;
  Component?: ComponentType<RendererProps>;
  source?: ManagedSource;
  error?: PreviewError;
  pageCount: number;
  effectiveZoom: number | null;
  searchCount: number;
}

type LoadAction =
  | { type: 'start'; definition?: RendererDefinition }
  | { type: 'unsupported' }
  | { type: 'loaded'; Component: ComponentType<RendererProps>; source: ManagedSource }
  | { type: 'ready' }
  | { type: 'error'; error: PreviewError }
  | { type: 'pageCount'; count: number }
  | { type: 'effectiveZoom'; zoom: number }
  | { type: 'searchCount'; count: number };

const initialLoad: LoadState = {
  status: 'idle',
  pageCount: 0,
  effectiveZoom: null,
  searchCount: 0,
};

function loadReducer(state: LoadState, action: LoadAction): LoadState {
  switch (action.type) {
    case 'start':
      return {
        ...initialLoad,
        status: 'loading',
        ...(action.definition ? { definition: action.definition } : {}),
      };
    case 'unsupported':
      return { ...state, status: 'unsupported' };
    case 'loaded':
      return { ...state, status: 'rendering', Component: action.Component, source: action.source };
    case 'ready':
      return state.status === 'rendering' ? { ...state, status: 'ready' } : state;
    case 'error':
      return { ...state, status: 'error', error: action.error };
    case 'pageCount':
      return state.pageCount === action.count ? state : { ...state, pageCount: action.count };
    case 'effectiveZoom':
      return state.effectiveZoom !== null && Math.abs(state.effectiveZoom - action.zoom) < 0.001
        ? state
        : { ...state, effectiveZoom: action.zoom };
    case 'searchCount':
      return state.searchCount === action.count ? state : { ...state, searchCount: action.count };
  }
}

function initialView(def: RendererDefinition | undefined, env: PreviewEnvironment): ViewState {
  const fits = def?.capabilities.fitModes ?? [];
  const preferred = env.config.zoom.defaultFit;
  const fitMode: FitMode = fits.includes(preferred) ? preferred : (fits[0] ?? 'none');
  return {
    zoom: env.config.zoom.default,
    fitMode,
    rotation: 0,
    page: 1,
    scrollMode: env.config.pdf.scrollMode,
    rawView: false,
    showThumbnails: def?.id === 'pdf' ? env.config.pdf.thumbnails : false,
  };
}

export interface PaneOptions extends Pick<PreviewCallbacks, 'onError' | 'onLoad' | 'onDownload'> {
  /** Called whenever the view state changes (used by compare mode to sync zoom). */
  onViewChange?: (view: ViewState, displayZoom: number) => void;
}

export interface PaneController {
  document: PreviewDocument | null;
  /** The document actually rendered (fallback when active). */
  renderedDocument: PreviewDocument | null;
  status: PaneStatus;
  error?: PreviewError;
  definition?: RendererDefinition;
  Component?: ComponentType<RendererProps>;
  source?: ManagedSource;
  host: RendererHost;
  view: ViewState;
  pageCount: number;
  /** Zoom shown in the toolbar (effective zoom when fitting). */
  displayZoom: number;
  usingFallback: boolean;
  canUseFallback: boolean;
  search: {
    open: boolean;
    input: string;
    query: string;
    caseSensitive: boolean;
    activeIndex: number;
    count: number;
  };
  rendererSearch: RendererProps['search'];
  generation: number;
  actions: {
    zoomIn(): void;
    zoomOut(): void;
    resetZoom(): void;
    setZoom(zoom: number): void;
    setFitMode(fit: FitMode): void;
    rotate(delta?: number): void;
    goToPage(page: number): void;
    nextPage(): void;
    prevPage(): void;
    toggleThumbnails(): void;
    toggleRawView(): void;
    toggleScrollMode(): void;
    openSearch(): void;
    closeSearch(): void;
    setSearchInput(value: string): void;
    toggleCaseSensitive(): void;
    nextMatch(): void;
    prevMatch(): void;
    clearSearch(): void;
    retry(): void;
    download(): Promise<void>;
    toggleFallback(): void;
  };
  downloading: boolean;
  downloadError: string | null;
}

function fallbackDocument(doc: PreviewDocument): PreviewDocument | null {
  if (!doc.fallback) return null;
  return {
    ...doc.fallback,
    id: doc.fallback.id ?? `${doc.id}::fallback`,
    name: doc.fallback.name || doc.name,
    downloadable: doc.downloadable,
  } as PreviewDocument;
}

/**
 * State machine for previewing one document: resolve → load renderer → fetch
 * data → render, with cancellation, auth-retry, fallback and view state.
 * Each compare pane owns an independent controller.
 */
export function usePaneController(
  document: PreviewDocument | null,
  env: PreviewEnvironment,
  options: PaneOptions = {},
): PaneController {
  const [load, dispatch] = useReducer(loadReducer, initialLoad);
  const [attempt, setAttempt] = useState<{ n: number; reason: 'initial' | 'retry' | 'expired' }>({
    n: 0,
    reason: 'initial',
  });
  const [useFallback, setUseFallback] = useState(false);
  const [view, setView] = useState<ViewState>(() => initialView(undefined, env));
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchInput, setSearchInput] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const generation = useRef(0);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const fallback = document ? fallbackDocument(document) : null;
  const rendered = document ? (useFallback && fallback ? fallback : document) : null;
  const docKey = rendered
    ? `${rendered.id}::${rendered.url ?? ''}::${rendered.type ?? ''}::${rendered.name}`
    : '';

  // Reset per-document state when the document changes.
  const lastDocId = useRef<string | null>(null);
  if ((document?.id ?? null) !== lastDocId.current) {
    lastDocId.current = document?.id ?? null;
    if (useFallback) setUseFallback(false);
    if (attempt.n !== 0) setAttempt({ n: 0, reason: 'initial' });
    if (activeIndex !== -1) setActiveIndex(-1);
  }

  const reportError = useCallback((error: PreviewError, doc: PreviewDocument, gen: number) => {
    if (gen !== generation.current) return;
    dispatch({ type: 'error', error });
    optionsRef.current.onError?.(error, doc);
  }, []);

  /* ------------------------------------------------------------ loading */
  useEffect(() => {
    if (!rendered) {
      dispatch({ type: 'start' });
      return;
    }
    const gen = ++generation.current;
    const ctrl = new AbortController();
    const def = env.registry.resolve(rendered);
    dispatch({ type: 'start', ...(def ? { definition: def } : {}) });
    setView(initialView(def, env));
    if (!def) {
      dispatch({ type: 'unsupported' });
      if (fallback && !useFallback) setUseFallback(true);
      else
        optionsRef.current.onError?.(
          {
            code: 'UNSUPPORTED_FORMAT',
            message: defaultMessage('UNSUPPORTED_FORMAT'),
            documentId: rendered.id,
          },
          rendered,
        );
      return;
    }
    let source: ManagedSource | null = null;
    (async () => {
      const [Component, src] = await Promise.all([
        loadComponent(def),
        loadDocumentSource({
          document: rendered,
          resolver: env.resolver,
          strategy: def.loadingStrategy,
          signal: ctrl.signal,
          maxFileSize: def.maxFileSize ?? env.config.maxFileSize,
          retryOnAuthError: env.config.retryOnAuthError,
          caches: env.caches,
          attempt: attempt.n,
          reason: attempt.reason,
        }),
      ]);
      source = src;
      if (ctrl.signal.aborted || gen !== generation.current) {
        src.dispose();
        return;
      }
      dispatch({ type: 'loaded', Component, source: src });
    })().catch((error: unknown) => {
      if (ctrl.signal.aborted || isAbortError(error)) return;
      const e = toPreviewError(error, 'RENDER_FAILED');
      e.documentId = rendered.id;
      reportError(e.toJSON(), rendered, gen);
    });
    return () => {
      ctrl.abort();
      source?.dispose();
      def.cleanup?.();
    };
    // `env` parts that matter are listed explicitly; view resets per document.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docKey, env.resolver, env.registry, env.caches, attempt]);

  /* ------------------------------------------------------------ renderer host */
  const loadRef = useRef(load);
  loadRef.current = load;
  const attemptRef = useRef(attempt);
  attemptRef.current = attempt;
  const envRef = useRef(env);
  envRef.current = env;
  const renderedRef = useRef(rendered);
  renderedRef.current = rendered;
  const fallbackRef = useRef({ fallback, useFallback });
  fallbackRef.current = { fallback, useFallback };

  const host = useMemo<RendererHost>(() => {
    const gen = generation.current;
    const live = () => gen === generation.current;
    return {
      setPageCount: (count) => live() && dispatch({ type: 'pageCount', count }),
      setCurrentPage: (page) => {
        if (!live()) return;
        setView((v) => (v.page === page ? v : { ...v, page }));
      },
      setSearchResults: (count) => {
        if (!live()) return;
        dispatch({ type: 'searchCount', count });
        setActiveIndex((i) => (count === 0 ? -1 : i < 0 ? 0 : i >= count ? count - 1 : i));
      },
      setEffectiveZoom: (zoom) => live() && dispatch({ type: 'effectiveZoom', zoom }),
      requestZoom: (zoom) => {
        if (!live()) return;
        const { min, max } = envRef.current.config.zoom;
        setView((v) => ({ ...v, fitMode: 'none', zoom: clamp(zoom, min, max) }));
      },
      setReady: () => {
        if (!live() || loadRef.current.status !== 'rendering') return;
        dispatch({ type: 'ready' });
        const doc = renderedRef.current;
        if (doc) optionsRef.current.onLoad?.(doc);
      },
      setError: (code: PreviewErrorCode, message: string) => {
        if (!live()) return;
        const doc = renderedRef.current;
        if (!doc) return;
        // Streaming renderers (PDF via URL) discover expired URLs late: re-resolve once.
        if (
          code === 'ACCESS_DENIED' &&
          envRef.current.config.retryOnAuthError &&
          attemptRef.current.reason !== 'expired'
        ) {
          setAttempt((a) => ({ n: a.n + 1, reason: 'expired' }));
          return;
        }
        // Fall back to the consumer-supplied alternative (e.g. PDF export of a PPTX).
        const fb = fallbackRef.current;
        if (
          fb.fallback &&
          !fb.useFallback &&
          (code === 'MALFORMED_DOCUMENT' || code === 'RENDER_FAILED')
        ) {
          setUseFallback(true);
          return;
        }
        const err = new DocumentPreviewError(code, message);
        err.documentId = doc.id;
        reportError(err.toJSON(), doc, gen);
      },
    };
    // A fresh host per load generation, so stale renderers cannot update state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load.source, load.status === 'loading', reportError]);

  /* ------------------------------------------------------------ search */
  const query = useDebouncedValue(searchOpen ? searchInput : '', env.config.searchDebounce);
  // Reset the active match during render (not in an effect): renderer effects run
  // before ours and report the new match count, which must not be overwritten.
  const searchKey = `${caseSensitive ? 1 : 0}:${query}`;
  const [lastSearchKey, setLastSearchKey] = useState(searchKey);
  if (lastSearchKey !== searchKey) {
    setLastSearchKey(searchKey);
    setActiveIndex(-1);
  }
  const rendererSearch = useMemo(
    () => ({ query, caseSensitive, activeIndex }),
    [query, caseSensitive, activeIndex],
  );

  /* ------------------------------------------------------------ actions */
  const zoomBase = () =>
    view.fitMode !== 'none' && load.effectiveZoom ? load.effectiveZoom : view.zoom;
  const actions = useMemo<PaneController['actions']>(() => {
    const { min, max, step } = env.config.zoom;
    const setZoom = (z: number) =>
      setView((v) => ({ ...v, fitMode: 'none', zoom: clamp(Math.round(z * 100) / 100, min, max) }));
    return {
      zoomIn: () => setZoom(zoomBase() + step),
      zoomOut: () => setZoom(zoomBase() - step),
      resetZoom: () => setView((v) => ({ ...v, fitMode: 'none', zoom: 1 })),
      setZoom,
      setFitMode: (fitMode) => setView((v) => ({ ...v, fitMode })),
      rotate: (delta = 90) =>
        setView((v) => ({ ...v, rotation: (((v.rotation + delta) % 360) + 360) % 360 })),
      goToPage: (page) =>
        setView((v) => ({
          ...v,
          page: clamp(Math.round(page) || 1, 1, Math.max(1, loadRef.current.pageCount)),
        })),
      nextPage: () =>
        setView((v) => ({
          ...v,
          page: Math.min(Math.max(1, loadRef.current.pageCount), v.page + 1),
        })),
      prevPage: () => setView((v) => ({ ...v, page: Math.max(1, v.page - 1) })),
      toggleThumbnails: () => setView((v) => ({ ...v, showThumbnails: !v.showThumbnails })),
      toggleRawView: () => setView((v) => ({ ...v, rawView: !v.rawView })),
      toggleScrollMode: () =>
        setView((v) => ({ ...v, scrollMode: v.scrollMode === 'single' ? 'continuous' : 'single' })),
      openSearch: () => setSearchOpen(true),
      closeSearch: () => setSearchOpen(false),
      setSearchInput,
      toggleCaseSensitive: () => setCaseSensitive((c) => !c),
      nextMatch: () => setActiveIndex((i) => wrapIndex(i + 1, loadRef.current.searchCount)),
      prevMatch: () => setActiveIndex((i) => wrapIndex(i - 1, loadRef.current.searchCount)),
      clearSearch: () => {
        setSearchInput('');
        setActiveIndex(-1);
      },
      retry: () => setAttempt((a) => ({ n: a.n + 1, reason: 'retry' })),
      toggleFallback: () => setUseFallback((u) => !u),
      download: async () => {
        const doc = document;
        if (!doc) return;
        setDownloadError(null);
        setDownloading(true);
        const ctrl = new AbortController();
        const defaultDownload = () =>
          downloadDocument({
            document: doc,
            resolver: env.resolver,
            signal: ctrl.signal,
            caches: env.caches,
          });
        try {
          const handler = optionsRef.current.onDownload;
          if (handler) await handler(doc, { defaultDownload, signal: ctrl.signal });
          else await defaultDownload();
        } catch (error) {
          if (!isAbortError(error)) {
            const e = toPreviewError(error, 'DOWNLOAD_FAILED');
            const err: PreviewError = {
              code: 'DOWNLOAD_FAILED',
              message: e.message,
              documentId: doc.id,
            };
            setDownloadError(err.message);
            optionsRef.current.onError?.(err, doc);
          }
        } finally {
          setDownloading(false);
        }
      },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [env, document, view.fitMode, view.zoom, load.effectiveZoom]);

  const displayZoom =
    view.fitMode !== 'none' && load.effectiveZoom ? load.effectiveZoom : view.zoom;
  useEffect(() => {
    optionsRef.current.onViewChange?.(view, displayZoom);
  }, [view, displayZoom]);

  return {
    document,
    renderedDocument: rendered,
    status: load.status,
    ...(load.error ? { error: load.error } : {}),
    ...(load.definition ? { definition: load.definition } : {}),
    ...(load.Component ? { Component: load.Component } : {}),
    ...(load.source ? { source: load.source } : {}),
    host,
    view,
    pageCount: load.pageCount,
    displayZoom,
    usingFallback: useFallback && !!fallback,
    canUseFallback: !!fallback,
    search: {
      open: searchOpen,
      input: searchInput,
      query,
      caseSensitive,
      activeIndex,
      count: load.searchCount,
    },
    rendererSearch,
    generation: generation.current,
    actions,
    downloading,
    downloadError,
  };
}
