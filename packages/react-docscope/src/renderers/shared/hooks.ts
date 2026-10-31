import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { highlightDom } from '../../core/highlight';
import { findTextMatches, type TextMatch } from '../../core/search';
import type { RendererHost, SearchState } from '../../types';

export const useIsomorphicLayoutEffect =
  typeof window !== 'undefined' ? useLayoutEffect : useEffect;

/**
 * Tracks an element's content box size. Re-subscribes automatically when the
 * ref starts pointing to a different element (e.g. after async content loads).
 */
export function useElementSize<T extends HTMLElement>(
  ref: RefObject<T | null>,
): { width: number; height: number } {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const observed = useRef<{ el: T | null; ro: ResizeObserver | null }>({ el: null, ro: null });
  useIsomorphicLayoutEffect(() => {
    const el = ref.current;
    if (el === observed.current.el) return;
    observed.current.ro?.disconnect();
    observed.current = { el, ro: null };
    if (!el) return;
    const update = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      setSize((s) => (s.width === w && s.height === h ? s : { width: w, height: h }));
    };
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(update);
    ro.observe(el);
    observed.current.ro = ro;
  });
  useEffect(
    () => () => {
      observed.current.ro?.disconnect();
      observed.current = { el: null, ro: null };
    },
    [],
  );
  return size;
}

/** Latest-value ref, avoids re-running effects for callback identity changes. */
export function useLatest<T>(value: T): RefObject<T> {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}

/**
 * Runs DOM search highlighting whenever the content (`version`) or the search
 * changes, reporting the match count to the host.
 */
export function useDomSearch(
  contentRef: RefObject<HTMLElement | null>,
  scrollRef: RefObject<HTMLElement | null>,
  search: SearchState,
  host: RendererHost,
  version: unknown,
  allowMutation: boolean,
): void {
  const owner = useMemo(() => ({}), []);
  const hostRef = useLatest(host);
  useEffect(() => {
    const root = contentRef.current;
    if (!root || version === null || version === undefined) return;
    if (!search.query.trim()) {
      hostRef.current.setSearchResults(0);
      return;
    }
    const { count, cleanup } = highlightDom(
      owner,
      root,
      search.query,
      search.caseSensitive,
      search.activeIndex,
      {
        allowMutation,
        scrollContainer: scrollRef.current,
      },
    );
    hostRef.current.setSearchResults(count);
    return cleanup;
  }, [
    contentRef,
    scrollRef,
    search.query,
    search.caseSensitive,
    search.activeIndex,
    version,
    allowMutation,
    owner,
    hostRef,
  ]);
}

export interface LineMatch extends TextMatch {
  line: number;
}

/** Searches an array of lines. Returns matches grouped by line plus the active match. */
export function useLineSearch(lines: string[], search: SearchState, host: RendererHost) {
  const hostRef = useLatest(host);
  const all = useMemo<LineMatch[]>(() => {
    if (!search.query.trim()) return [];
    const out: LineMatch[] = [];
    for (let i = 0; i < lines.length; i += 1) {
      const ms = findTextMatches(
        lines[i]!,
        search.query,
        search.caseSensitive,
        10_000 - out.length,
      );
      for (const m of ms) out.push({ ...m, line: i });
      if (out.length >= 10_000) break;
    }
    return out;
  }, [lines, search.query, search.caseSensitive]);

  useEffect(() => {
    hostRef.current.setSearchResults(all.length);
  }, [all, hostRef]);

  const byLine = useMemo(() => {
    const map = new Map<number, Array<TextMatch & { index: number }>>();
    all.forEach((m, index) => {
      const list = map.get(m.line) ?? [];
      list.push({ start: m.start, end: m.end, index });
      map.set(m.line, list);
    });
    return map;
  }, [all]);

  const active = search.activeIndex >= 0 ? all[search.activeIndex] : undefined;
  return { byLine, active, count: all.length };
}

/** Promise-returning effect with cancellation via AbortSignal. */
export function useAsync<T>(
  factory: (signal: AbortSignal) => Promise<T>,
  deps: unknown[],
): { value: T | undefined; error: unknown; loading: boolean } {
  const [state, setState] = useState<{ value: T | undefined; error: unknown; loading: boolean }>({
    value: undefined,
    error: undefined,
    loading: true,
  });
  useEffect(() => {
    const ctrl = new AbortController();
    setState((s) =>
      s.loading && s.value === undefined && s.error === undefined
        ? s
        : { value: undefined, error: undefined, loading: true },
    );
    factory(ctrl.signal).then(
      (value) => {
        if (!ctrl.signal.aborted) setState({ value, error: undefined, loading: false });
      },
      (error: unknown) => {
        if (!ctrl.signal.aborted) setState({ value: undefined, error, loading: false });
      },
    );
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return state;
}

/** Ctrl/⌘ + wheel zoom inside a scroll container (re-binds when the element changes). */
export function useWheelZoom(
  ref: RefObject<HTMLElement | null>,
  zoom: number,
  host: RendererHost,
  step = 0.1,
): void {
  const zoomRef = useLatest(zoom);
  const hostRef = useLatest(host);
  const bound = useRef<{ el: HTMLElement | null; off: (() => void) | null }>({
    el: null,
    off: null,
  });
  useEffect(() => {
    const el = ref.current;
    if (el === bound.current.el) return;
    bound.current.off?.();
    bound.current = { el, off: null };
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1 + step : 1 / (1 + step);
      hostRef.current.requestZoom(Math.round(zoomRef.current * factor * 100) / 100);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    bound.current.off = () => el.removeEventListener('wheel', onWheel);
  });
  useEffect(
    () => () => {
      bound.current.off?.();
      bound.current = { el: null, off: null };
    },
    [],
  );
}
