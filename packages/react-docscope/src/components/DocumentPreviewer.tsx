import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { CSSProperties, KeyboardEvent, ReactNode } from 'react';
import * as Tooltip from '@radix-ui/react-tooltip';
import {
  ChevronLeft,
  ChevronRight,
  Columns2,
  Download,
  Info,
  LoaderCircle,
  Maximize2,
  Minimize2,
  PanelLeft,
  X,
} from 'lucide-react';
import type {
  DocumentResolver,
  MetadataRenderContext,
  PreviewCallbacks,
  PreviewConfig,
  PreviewDocument,
  RendererDefinition,
  ShortcutAction,
  ToolbarAction,
} from '../types';
import { usePreviewEnvironment, type PreviewEnvironment } from './context';
import { usePaneController, type PaneController } from '../hooks/usePaneController';
import { cssSize, useFullscreen, useResolvedTheme } from '../hooks/utils';
import { findShortcutAction, isEditableTarget, isSingleKeyCombo } from '../core/shortcuts';
import { loadDocumentSource, cacheKey } from '../core/source';
import { formatBytes } from '../core/format';
import { IconButton, PortalContainerContext, Separator } from './IconButton';
import { PaneToolbar } from './Toolbar';
import { SearchBar } from './SearchBar';
import { PaneView } from './PaneView';
import { Sidebar } from './Sidebar';
import { MetadataPanel } from './MetadataPanel';
import { CompareView, type CompareState } from './CompareView';

export interface DocumentPreviewerProps extends PreviewCallbacks {
  /** Documents to preview. With 2+ documents attachment navigation is enabled. */
  documents?: PreviewDocument[];
  /** Shorthand for a single document. */
  document?: PreviewDocument;
  /** Controlled active document id. */
  activeDocumentId?: string;
  /** Initial active document id (uncontrolled). */
  defaultDocumentId?: string;
  resolver?: DocumentResolver;
  config?: PreviewConfig;
  /** Custom renderers (added to / overriding built-ins). */
  renderers?: RendererDefinition[];
  /** Extra toolbar buttons. */
  toolbarActions?: ToolbarAction[];
  /** Replace the metadata panel content. */
  renderMetadata?: (ctx: MetadataRenderContext) => ReactNode;
  /** Start in compare mode with these two document ids. */
  defaultCompare?: [string, string];
  onCompareChange?: (pair: [string, string] | null) => void;
  className?: string;
  style?: CSSProperties;
  /** Accessible label for the previewer region. */
  'aria-label'?: string;
}

/** Imperative handle (also used internally by the modal). */
export interface DocumentPreviewerHandle {
  /** Returns true when an Escape press was consumed (e.g. closed the search bar). */
  handleEscape(): boolean;
  compare(leftId: string, rightId: string): void;
  exitCompare(): void;
  select(id: string): void;
}

interface WorkspaceProps extends DocumentPreviewerProps {
  variant: 'inline' | 'modal';
  onClose?: () => void;
  /** Renders the title element (modal wraps it in Dialog.Title). */
  renderTitle?: (title: ReactNode) => ReactNode;
}

const ICON = 18;

function useActiveDocument(
  documents: PreviewDocument[],
  controlledId: string | undefined,
  defaultId: string | undefined,
  onDocumentChange: PreviewCallbacks['onDocumentChange'],
) {
  const [internalId, setInternalId] = useState<string | null>(
    defaultId ?? documents[0]?.id ?? null,
  );
  const requested = controlledId ?? internalId;
  const lastIndex = useRef(0);
  let index = documents.findIndex((d) => d.id === requested);
  if (index < 0 && documents.length) index = Math.min(lastIndex.current, documents.length - 1);
  if (index >= 0) lastIndex.current = index;
  const active = index >= 0 ? documents[index]! : null;

  const changeRef = useRef(onDocumentChange);
  changeRef.current = onDocumentChange;
  const prevId = useRef(active?.id ?? null);
  useEffect(() => {
    if (!active || active.id === prevId.current) return;
    prevId.current = active.id;
    changeRef.current?.(active, index);
  }, [active, index]);

  const select = useCallback((id: string) => setInternalId(id), []);
  return { active, index, select };
}

function usePrefetch(
  env: PreviewEnvironment,
  documents: PreviewDocument[],
  index: number,
  enabled: boolean,
) {
  useEffect(() => {
    if (!enabled || env.config.prefetch !== 'adjacent' || documents.length < 2 || index < 0) return;
    const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
    if (conn?.saveData) return;
    const ctrl = new AbortController();
    const candidates = [documents[index + 1], documents[index - 1]].filter(
      (d): d is PreviewDocument => !!d,
    );
    const run = () => {
      for (const doc of candidates) {
        const size = doc.metadata?.size;
        if (typeof size !== 'number' || size > env.config.prefetchMaxSize) continue;
        if (env.caches.blobs.has(cacheKey(doc))) continue;
        const def = env.registry.resolve(doc);
        if (!def || def.loadingStrategy === 'url') continue;
        void def.load().catch(() => undefined);
        loadDocumentSource({
          document: doc,
          resolver: env.resolver,
          strategy: def.loadingStrategy,
          signal: ctrl.signal,
          maxFileSize: def.maxFileSize ?? env.config.maxFileSize,
          retryOnAuthError: false,
          caches: env.caches,
        }).catch(() => undefined);
      }
    };
    const w = window as Window & {
      requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    const handle = w.requestIdleCallback
      ? w.requestIdleCallback(run, { timeout: 2000 })
      : window.setTimeout(run, 800);
    return () => {
      ctrl.abort();
      if (w.cancelIdleCallback) w.cancelIdleCallback(handle);
      else clearTimeout(handle);
    };
  }, [env, documents, index, enabled]);
}

export const PreviewWorkspace = forwardRef<DocumentPreviewerHandle, WorkspaceProps>(
  function PreviewWorkspace(props, ref) {
    const {
      documents: documentsProp,
      document: singleDocument,
      activeDocumentId,
      defaultDocumentId,
      toolbarActions,
      renderMetadata,
      defaultCompare,
      onCompareChange,
      onDocumentChange,
      onError,
      onLoad,
      onDownload,
      className,
      style,
      variant,
      onClose,
      renderTitle,
    } = props;
    const env = usePreviewEnvironment(props);
    const { config } = env;
    const labels = config.labels;
    const documents = useMemo(
      () => documentsProp ?? (singleDocument ? [singleDocument] : []),
      [documentsProp, singleDocument],
    );
    const multi = documents.length > 1;
    const { active, index, select } = useActiveDocument(
      documents,
      activeDocumentId,
      defaultDocumentId,
      onDocumentChange,
    );

    const [compare, setCompareState] = useState<CompareState | null>(() =>
      defaultCompare && documents.length > 1
        ? { left: defaultCompare[0], right: defaultCompare[1] }
        : null,
    );
    const compareChangeRef = useRef(onCompareChange);
    compareChangeRef.current = onCompareChange;
    const setCompare = useCallback((next: CompareState | null) => {
      setCompareState(next);
      compareChangeRef.current?.(next ? [next.left, next.right] : null);
    }, []);

    const [sidebarOpen, setSidebarOpen] = useState(
      config.sidebar === true || (config.sidebar === 'auto' && multi),
    );
    const [detailsOpen, setDetailsOpen] = useState(config.metadata === 'open');
    useEffect(() => {
      if (config.sidebar === 'auto') setSidebarOpen(multi);
    }, [multi, config.sidebar]);

    const pane = usePaneController(compare ? null : active, env, { onError, onLoad, onDownload });
    usePrefetch(env, documents, index, !compare);

    const rootRef = useRef<HTMLDivElement>(null);
    const [portalEl, setPortalEl] = useState<HTMLDivElement | null>(null);
    const fullscreen = useFullscreen(rootRef);
    const theme = useResolvedTheme(config.theme);
    const compareControllers = useRef(new Map<string, PaneController>());
    const focusedSlot = useRef<string | null>(null);

    const goTo = useCallback(
      (delta: number) => {
        if (!documents.length) return;
        const next = (index + delta + documents.length) % documents.length;
        select(documents[next]!.id);
      },
      [documents, index, select],
    );

    const canDownload = !!active && config.download && active.downloadable !== false;
    const canCompare = config.compare && multi;

    useImperativeHandle(
      ref,
      () => ({
        handleEscape: () => {
          const target = compare ? compareControllers.current.get(focusedSlot.current ?? '') : pane;
          if (target?.search.open) {
            target.actions.closeSearch();
            return true;
          }
          return false;
        },
        compare: (l, r) => setCompare({ left: l, right: r }),
        exitCompare: () => setCompare(null),
        select,
      }),
      [compare, pane, select, setCompare],
    );

    const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
      const action = findShortcutAction(e.nativeEvent, config.shortcuts);
      if (!action) return;
      const combo = config.shortcuts[action].find((c) => isSingleKeyCombo(c));
      if (
        isEditableTarget(e.target) &&
        (combo !== undefined ||
          !['search', 'download', 'toggleSidebar', 'nextMatch', 'prevMatch'].includes(action))
      )
        return;
      const target: PaneController | undefined = compare
        ? (compareControllers.current.get(focusedSlot.current ?? '') ??
          [...compareControllers.current.values()][0])
        : pane;
      const caps = target?.definition?.capabilities ?? {};
      const handlers: Partial<Record<ShortcutAction, () => boolean | void>> = {
        search: () => (config.search && caps.search ? target?.actions.openSearch() : false),
        nextMatch: () => target?.actions.nextMatch(),
        prevMatch: () => target?.actions.prevMatch(),
        zoomIn: () => (caps.zoom ? target?.actions.zoomIn() : false),
        zoomOut: () => (caps.zoom ? target?.actions.zoomOut() : false),
        resetZoom: () => (caps.zoom ? target?.actions.resetZoom() : false),
        nextPage: () => (caps.pages ? target?.actions.nextPage() : false),
        prevPage: () => (caps.pages ? target?.actions.prevPage() : false),
        nextDocument: () => (multi && !compare ? goTo(1) : false),
        prevDocument: () => (multi && !compare ? goTo(-1) : false),
        rotate: () => (caps.rotate ? target?.actions.rotate(90) : false),
        fullscreen: () =>
          config.fullscreen && fullscreen.supported ? void fullscreen.toggle() : false,
        download: () => (canDownload ? void pane.actions.download() : false),
        toggleSidebar: () => (multi ? setSidebarOpen((o) => !o) : false),
      };
      const result = handlers[action]?.();
      if (result !== false) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    const visibleActions = (toolbarActions ?? []).filter(
      (a) => !active || !a.isVisible || a.isVisible(active),
    );
    const customButtons =
      active &&
      visibleActions.map((a) => (
        <IconButton
          key={a.id}
          label={a.label}
          icon={a.icon ?? <span className="dsc-btn-text">{a.label}</span>}
          disabled={typeof a.disabled === 'function' ? a.disabled(active) : a.disabled}
          onClick={() =>
            a.onClick({ document: active, index, close: onClose ?? (() => undefined) })
          }
        />
      ));

    const subtitle = compare
      ? labels.compare
      : active
        ? [env.registry.resolve(active)?.label, formatBytes(active.metadata?.size)]
            .filter(Boolean)
            .join(' · ')
        : '';
    const compareTitle = compare
      ? [compare.left, compare.right]
          .map((id) => documents.find((d) => d.id === id)?.name ?? '')
          .join(' ↔ ')
      : null;
    const title = compareTitle ?? (active ? active.name : labels.noDocuments);

    const rootStyle: CSSProperties = {
      ...(variant === 'inline'
        ? { width: cssSize(config.width), height: cssSize(config.height) }
        : {}),
      ...style,
    };

    return (
      <div
        ref={(el) => {
          rootRef.current = el;
          setPortalEl(el);
        }}
        className={`dsc-root dsc-root--${variant}${fullscreen.isFullscreen ? ' dsc-root--fullscreen' : ''}${config.className ? ` ${config.className}` : ''}${className ? ` ${className}` : ''}`}
        data-dsc-theme={theme}
        style={rootStyle}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        role={variant === 'inline' ? 'region' : undefined}
        aria-label={
          variant === 'inline' ? (props['aria-label'] ?? `Document preview: ${title}`) : undefined
        }
      >
        <PortalContainerContext.Provider value={portalEl}>
          <Tooltip.Provider delayDuration={500} skipDelayDuration={200}>
            {/* Header */}
            <header className="dsc-header">
              <div className="dsc-title-block">
                {renderTitle ? renderTitle(title) : <h2 className="dsc-title">{title}</h2>}
                {subtitle && <span className="dsc-subtitle">{subtitle}</span>}
              </div>
              {multi && !compare && (
                <span className="dsc-counter" aria-live="polite">
                  {index + 1} / {documents.length}
                </span>
              )}
              <span className="dsc-spacer" />
              {config.metadata && active && !compare && (
                <IconButton
                  label={labels.details}
                  icon={<Info size={ICON} />}
                  pressed={detailsOpen}
                  onClick={() => setDetailsOpen((o) => !o)}
                />
              )}
              {canDownload && !compare && (
                <IconButton
                  label={labels.download}
                  icon={
                    pane.downloading ? (
                      <LoaderCircle size={ICON} className="dsc-spin" />
                    ) : (
                      <Download size={ICON} />
                    )
                  }
                  onClick={() => void pane.actions.download()}
                  disabled={pane.downloading}
                />
              )}
              {config.fullscreen && fullscreen.supported && (
                <IconButton
                  label={fullscreen.isFullscreen ? labels.exitFullscreen : labels.fullscreen}
                  icon={
                    fullscreen.isFullscreen ? <Minimize2 size={ICON} /> : <Maximize2 size={ICON} />
                  }
                  onClick={() => void fullscreen.toggle()}
                />
              )}
              {onClose && (
                <IconButton
                  label={labels.close}
                  icon={<X size={ICON} />}
                  onClick={onClose}
                  className="dsc-close"
                />
              )}
            </header>

            {compare ? (
              <CompareView
                env={env}
                documents={documents}
                state={compare}
                onChange={setCompare}
                onExit={() => {
                  select(compare.left);
                  setCompare(null);
                }}
                registerController={(slot, c) => {
                  if (c) compareControllers.current.set(slot, c);
                  else compareControllers.current.delete(slot);
                }}
                onFocusSlot={(slot) => {
                  focusedSlot.current = slot;
                }}
                callbacks={{ onError, onLoad, onDownload }}
              />
            ) : (
              <>
                {config.toolbar && (
                  <PaneToolbar
                    controller={pane}
                    config={config}
                    labels={labels}
                    start={
                      multi ? (
                        <>
                          <IconButton
                            label={labels.attachments}
                            icon={<PanelLeft size={ICON} />}
                            pressed={sidebarOpen}
                            onClick={() => setSidebarOpen((o) => !o)}
                          />
                          <IconButton
                            label={labels.previous}
                            icon={<ChevronLeft size={ICON} />}
                            onClick={() => goTo(-1)}
                            shortcut="Alt+←"
                          />
                          <IconButton
                            label={labels.next}
                            icon={<ChevronRight size={ICON} />}
                            onClick={() => goTo(1)}
                            shortcut="Alt+→"
                          />
                          <Separator />
                        </>
                      ) : undefined
                    }
                    end={
                      <>
                        {canCompare && active && (
                          <IconButton
                            label={labels.compare}
                            icon={<Columns2 size={ICON} />}
                            onClick={() => {
                              const other = documents[(index + 1) % documents.length]!;
                              setCompare({ left: active.id, right: other.id });
                            }}
                          />
                        )}
                        {customButtons}
                      </>
                    }
                  />
                )}
                <SearchBar controller={pane} labels={labels} />
                {pane.downloadError && (
                  <div className="dsc-banner dsc-banner--error" role="alert">
                    {pane.downloadError}
                  </div>
                )}
                <div className="dsc-body">
                  {multi && sidebarOpen && (
                    <Sidebar
                      documents={documents}
                      activeId={active?.id ?? null}
                      onSelect={select}
                      registry={env.registry}
                      labels={labels}
                    />
                  )}
                  <main className="dsc-main">
                    <PaneView
                      controller={pane}
                      config={config}
                      labels={labels}
                      canDownload={canDownload}
                    />
                  </main>
                  {config.metadata && detailsOpen && active && (
                    <MetadataPanel
                      document={active}
                      fields={config.metadataFields}
                      registry={env.registry}
                      labels={labels}
                      render={renderMetadata}
                    />
                  )}
                </div>
              </>
            )}
          </Tooltip.Provider>
        </PortalContainerContext.Provider>
      </div>
    );
  },
);

/**
 * Inline document previewer. Renders one or many documents inside a
 * consumer-provided container with toolbar, search, attachments sidebar,
 * metadata, downloads and split-screen comparison.
 */
export const DocumentPreviewer = forwardRef<DocumentPreviewerHandle, DocumentPreviewerProps>(
  function DocumentPreviewer(props, ref) {
    return <PreviewWorkspace {...props} ref={ref} variant="inline" />;
  },
);
