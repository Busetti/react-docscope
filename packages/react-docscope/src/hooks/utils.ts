import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { ThemeMode } from '../types';

/** Structural equality for plain config objects (functions compared by reference). */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const bb = b as unknown[];
    return a.length === bb.length && a.every((v, i) => deepEqual(v, bb[i]));
  }
  if (
    Object.getPrototypeOf(a) !== Object.prototype ||
    Object.getPrototypeOf(b) !== Object.prototype
  )
    return false;
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  if (ka.length !== kb.length) return false;
  return ka.every((k) =>
    deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
  );
}

/**
 * Returns the previous value while `value` is structurally equal, so inline
 * config objects from consumers don't cause downstream re-renders.
 */
export function useStableValue<T>(value: T): T {
  const ref = useRef(value);
  if (!deepEqual(ref.current, value)) ref.current = value;
  return ref.current;
}

export function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    if (delay <= 0) {
      setDebounced(value);
      return;
    }
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return delay <= 0 ? value : debounced;
}

const darkQuery = '(prefers-color-scheme: dark)';

function subscribeColorScheme(cb: () => void): () => void {
  if (typeof window === 'undefined' || !window.matchMedia) return () => undefined;
  const mql = window.matchMedia(darkQuery);
  mql.addEventListener?.('change', cb);
  return () => mql.removeEventListener?.('change', cb);
}

function getColorScheme(): boolean {
  return (
    typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(darkQuery).matches
  );
}

/** Resolves `system` to light/dark and follows OS changes. */
export function useResolvedTheme(theme: ThemeMode): 'light' | 'dark' {
  const prefersDark = useSyncExternalStore(subscribeColorScheme, getColorScheme, () => false);
  if (theme === 'system') return prefersDark ? 'dark' : 'light';
  return theme;
}

/** Fullscreen state for an element. */
export function useFullscreen(ref: React.RefObject<HTMLElement | null>) {
  const [isFullscreen, setIsFullscreen] = useState(false);
  useEffect(() => {
    const onChange = () =>
      setIsFullscreen(!!document.fullscreenElement && document.fullscreenElement === ref.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, [ref]);
  const supported = typeof document !== 'undefined' && !!document.fullscreenEnabled;
  const toggle = async () => {
    const el = ref.current;
    if (!el) return;
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await el.requestFullscreen();
    } catch {
      /* user agent refused */
    }
  };
  return { isFullscreen, supported, toggle };
}

export function cssSize(value: number | string | undefined): string | undefined {
  if (value === undefined) return undefined;
  return typeof value === 'number' ? `${value}px` : value;
}
