import { memo, useCallback, useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import { ArrowLeftRight, Columns2, Link2, Link2Off, Rows2, Scaling, X } from 'lucide-react';
import type { FitMode, PreviewCallbacks, PreviewDocument, ViewState } from '../types';
import type { PreviewEnvironment } from './context';
import { usePaneController, type PaneController } from '../hooks/usePaneController';
import { IconButton, Separator } from './IconButton';
import { PaneToolbar } from './Toolbar';
import { SearchBar } from './SearchBar';
import { PaneView } from './PaneView';

export interface CompareState {
  left: string;
  right: string;
  orientation?: 'horizontal' | 'vertical';
  syncScroll?: boolean;
  syncZoom?: boolean;
}

interface CompareViewProps {
  env: PreviewEnvironment;
  documents: PreviewDocument[];
  state: CompareState;
  onChange: (state: CompareState) => void;
  onExit: () => void;
  registerController: (slot: string, controller: PaneController | null) => void;
  onFocusSlot: (slot: string) => void;
  callbacks: Pick<PreviewCallbacks, 'onError' | 'onLoad' | 'onDownload'>;
}

interface ZoomCommand {
  zoom: number;
  fitMode: FitMode;
  seq: number;
}

/**
 * Side-by-side visual comparison of two documents of any supported types.
 * Each pane is an independent controller (zoom, page, search, scroll). Panes
 * are keyed by slot so "swap" moves them without losing their state.
 */
export const CompareView = memo(function CompareView({
  env,
  documents,
  state,
  onChange,
  onExit,
  registerController,
  onFocusSlot,
  callbacks,
}: CompareViewProps) {
  const labels = env.config.labels;
  const orientation = state.orientation ?? 'horizontal';
  const [ratio, setRatio] = useState(0.5);
  const [slots, setSlots] = useState<Array<{ slot: 'a' | 'b'; side: 'left' | 'right' }>>([
    { slot: 'a', side: 'left' },
    { slot: 'b', side: 'right' },
  ]);
  const containerRef = useRef<HTMLDivElement>(null);
  const paneRefs = useRef(new Map<string, HTMLDivElement>());
  const [zoomCommand, setZoomCommand] = useState<Record<string, ZoomCommand | null>>({
    a: null,
    b: null,
  });
  const seq = useRef(0);
  const lastViews = useRef(new Map<string, ViewState>());

  const docFor = (side: 'left' | 'right') => documents.find((d) => d.id === state[side]) ?? null;

  /* ----------------------------------------- sync zoom */
  const onViewChange = useCallback(
    (slot: string, view: ViewState) => {
      const prev = lastViews.current.get(slot);
      lastViews.current.set(slot, view);
      if (!state.syncZoom || !prev) return;
      if (prev.zoom === view.zoom && prev.fitMode === view.fitMode) return;
      const other = slot === 'a' ? 'b' : 'a';
      const otherView = lastViews.current.get(other);
      if (otherView && otherView.zoom === view.zoom && otherView.fitMode === view.fitMode) return;
      seq.current += 1;
      setZoomCommand((c) => ({
        ...c,
        [other]: { zoom: view.zoom, fitMode: view.fitMode, seq: seq.current },
      }));
    },
    [state.syncZoom],
  );

  /* ----------------------------------------- sync scroll */
  useEffect(() => {
    if (!state.syncScroll) return;
    const roots = [...paneRefs.current.entries()];
    if (roots.length !== 2) return;
    let echo: HTMLElement | null = null;
    const mainScroller = (root: HTMLElement): HTMLElement | null => {
      const all = Array.from(root.querySelectorAll<HTMLElement>('[data-dsc-scroll-container]'));
      return all.sort((x, y) => y.scrollHeight - x.scrollHeight)[0] ?? null;
    };
    const handlers = roots.map(([slot, root]) => {
      const onScroll = (e: Event) => {
        const src = e.target as HTMLElement;
        if (!(src instanceof HTMLElement) || !src.hasAttribute('data-dsc-scroll-container')) return;
        if (src === echo) {
          echo = null;
          return;
        }
        const otherRoot = paneRefs.current.get(slot === 'a' ? 'b' : 'a');
        const dst = otherRoot && mainScroller(otherRoot);
        if (!dst) return;
        const vy = src.scrollHeight - src.clientHeight;
        const vx = src.scrollWidth - src.clientWidth;
        const top = vy > 0 ? (src.scrollTop / vy) * (dst.scrollHeight - dst.clientHeight) : 0;
        const left = vx > 0 ? (src.scrollLeft / vx) * (dst.scrollWidth - dst.clientWidth) : 0;
        if (Math.abs(dst.scrollTop - top) < 1 && Math.abs(dst.scrollLeft - left) < 1) return;
        echo = dst;
        dst.scrollTop = top;
        dst.scrollLeft = left;
      };
      root.addEventListener('scroll', onScroll, true);
      return () => root.removeEventListener('scroll', onScroll, true);
    });
    return () => handlers.forEach((off) => off());
  }, [state.syncScroll, slots]);

  /* ----------------------------------------- splitter */
  const dragging = useRef(false);
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    dragging.current = true;
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!dragging.current || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const r =
      orientation === 'horizontal'
        ? (e.clientX - rect.left) / rect.width
        : (e.clientY - rect.top) / rect.height;
    if (Number.isFinite(r)) setRatio(Math.min(0.8, Math.max(0.2, r)));
  };
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    dragging.current = false;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  };
  const onSplitterKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const dec = orientation === 'horizontal' ? 'ArrowLeft' : 'ArrowUp';
    const inc = orientation === 'horizontal' ? 'ArrowRight' : 'ArrowDown';
    if (e.key === dec) setRatio((r) => Math.max(0.2, r - 0.05));
    else if (e.key === inc) setRatio((r) => Math.min(0.8, r + 0.05));
    else if (e.key === 'Home') setRatio(0.5);
    else return;
    e.preventDefault();
  };

  const swap = () => {
    setSlots(([a, b]) => [
      { slot: b!.slot, side: 'left' },
      { slot: a!.slot, side: 'right' },
    ]);
    onChange({ ...state, left: state.right, right: state.left });
  };

  return (
    <div className="dsc-compare">
      <div
        className="dsc-toolbar dsc-compare-toolbar"
        role="toolbar"
        aria-label={labels.compareTools}
      >
        <span className="dsc-compare-label">{labels.compare}</span>
        <Separator />
        <IconButton
          label={labels.sideBySide}
          icon={<Columns2 size={18} />}
          pressed={orientation === 'horizontal'}
          onClick={() => onChange({ ...state, orientation: 'horizontal' })}
        />
        <IconButton
          label={labels.stacked}
          icon={<Rows2 size={18} />}
          pressed={orientation === 'vertical'}
          onClick={() => onChange({ ...state, orientation: 'vertical' })}
        />
        <IconButton label={labels.swap} icon={<ArrowLeftRight size={18} />} onClick={swap} />
        <Separator />
        <IconButton
          label={labels.syncScroll}
          icon={state.syncScroll ? <Link2 size={18} /> : <Link2Off size={18} />}
          pressed={!!state.syncScroll}
          onClick={() => onChange({ ...state, syncScroll: !state.syncScroll })}
        />
        <IconButton
          label={labels.syncZoom}
          icon={<Scaling size={18} />}
          pressed={!!state.syncZoom}
          onClick={() => {
            const enabling = !state.syncZoom;
            onChange({ ...state, syncZoom: enabling });
            const leftSlot = slots.find((s) => s.side === 'left')!.slot;
            const v = lastViews.current.get(leftSlot);
            if (enabling && v) {
              seq.current += 1;
              const other = leftSlot === 'a' ? 'b' : 'a';
              setZoomCommand((c) => ({
                ...c,
                [other]: { zoom: v.zoom, fitMode: v.fitMode, seq: seq.current },
              }));
            }
          }}
        />
        <span className="dsc-spacer" />
        <IconButton label={labels.exitCompare} icon={<X size={18} />} showLabel onClick={onExit} />
      </div>
      <div
        ref={containerRef}
        className={`dsc-compare-panes dsc-compare-panes--${orientation}`}
        style={{ ['--dsc-split' as string]: `${ratio * 100}%` }}
      >
        {slots.map(({ slot, side }, i) => (
          <ComparePaneSlot
            key={slot}
            slot={slot}
            side={side}
            order={i}
            env={env}
            documents={documents}
            document={docFor(side)}
            onSelect={(id) => onChange({ ...state, [side]: id })}
            registerController={registerController}
            onFocusSlot={onFocusSlot}
            onViewChange={onViewChange}
            zoomCommand={zoomCommand[slot] ?? null}
            callbacks={callbacks}
            refCallback={(el) => {
              if (el) paneRefs.current.set(slot, el);
              else paneRefs.current.delete(slot);
            }}
          />
        ))}
        <div
          className="dsc-splitter"
          role="separator"
          tabIndex={0}
          aria-orientation={orientation === 'horizontal' ? 'vertical' : 'horizontal'}
          aria-valuenow={Math.round(ratio * 100)}
          aria-valuemin={20}
          aria-valuemax={80}
          aria-label={labels.resizePanes}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onKeyDown={onSplitterKey}
          onDoubleClick={() => setRatio(0.5)}
        />
      </div>
    </div>
  );
});

interface ComparePaneSlotProps {
  slot: string;
  side: 'left' | 'right';
  order: number;
  env: PreviewEnvironment;
  documents: PreviewDocument[];
  document: PreviewDocument | null;
  onSelect: (id: string) => void;
  registerController: (slot: string, controller: PaneController | null) => void;
  onFocusSlot: (slot: string) => void;
  onViewChange: (slot: string, view: ViewState) => void;
  zoomCommand: ZoomCommand | null;
  callbacks: Pick<PreviewCallbacks, 'onError' | 'onLoad' | 'onDownload'>;
  refCallback: (el: HTMLDivElement | null) => void;
}

function ComparePaneSlot({
  slot,
  side,
  order,
  env,
  documents,
  document,
  onSelect,
  registerController,
  onFocusSlot,
  onViewChange,
  zoomCommand,
  callbacks,
  refCallback,
}: ComparePaneSlotProps) {
  const selectId = useId();
  const controller = usePaneController(document, env, {
    ...callbacks,
    onViewChange: (view) => onViewChange(slot, view),
  });
  const labels = env.config.labels;
  useEffect(() => {
    registerController(slot, controller);
  });
  useEffect(() => () => registerController(slot, null), [slot, registerController]);

  const applied = useRef(0);
  useEffect(() => {
    if (!zoomCommand || zoomCommand.seq === applied.current) return;
    applied.current = zoomCommand.seq;
    if (zoomCommand.fitMode === 'none') controller.actions.setZoom(zoomCommand.zoom);
    else controller.actions.setFitMode(zoomCommand.fitMode);
  }, [zoomCommand, controller.actions]);

  return (
    <section
      ref={refCallback}
      className="dsc-compare-pane"
      style={{ order: order * 2 }}
      aria-label={side === 'left' ? labels.leftDocument : labels.rightDocument}
      onFocusCapture={() => onFocusSlot(slot)}
      onPointerDownCapture={() => onFocusSlot(slot)}
    >
      <div className="dsc-compare-pane-header">
        <label className="dsc-visually-hidden" htmlFor={selectId}>
          {side === 'left' ? labels.leftDocument : labels.rightDocument}
        </label>
        <select
          id={selectId}
          className="dsc-select"
          value={document?.id ?? ''}
          onChange={(e) => onSelect(e.target.value)}
        >
          {documents.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </div>
      <PaneToolbar controller={controller} config={env.config} labels={labels} compact />
      <SearchBar controller={controller} labels={labels} />
      <div className="dsc-compare-pane-body">
        <PaneView
          controller={controller}
          config={env.config}
          labels={labels}
          canDownload={env.config.download && document?.downloadable !== false}
        />
      </div>
    </section>
  );
}
