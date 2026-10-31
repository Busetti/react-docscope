import { act, render, renderHook } from '@testing-library/react';
import { useRef } from 'react';
import {
  cssSize,
  deepEqual,
  useDebouncedValue,
  useFullscreen,
  useResolvedTheme,
  useStableValue,
} from '../utils';
import { copyText } from '../../renderers/shared/clipboard';

describe('hook utilities', () => {
  it('deepEqual compares plain structures', () => {
    const fn = () => 1;
    expect(deepEqual({ a: [1, { b: fn }] }, { a: [1, { b: fn }] })).toBe(true);
    expect(deepEqual({ a: 1 }, { a: 2 })).toBe(false);
    expect(deepEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(deepEqual([1], { 0: 1 })).toBe(false);
    expect(deepEqual([1, 2], [1])).toBe(false);
    expect(deepEqual(new Date(1), new Date(1))).toBe(false);
    expect(deepEqual(null, {})).toBe(false);
    expect(deepEqual(NaN, NaN)).toBe(true);
  });

  it('useStableValue keeps identity for equal values', () => {
    const { result, rerender } = renderHook(({ v }) => useStableValue(v), {
      initialProps: { v: { a: 1 } },
    });
    const first = result.current;
    rerender({ v: { a: 1 } });
    expect(result.current).toBe(first);
    rerender({ v: { a: 2 } });
    expect(result.current).not.toBe(first);
  });

  it('useDebouncedValue', () => {
    jest.useFakeTimers();
    const { result, rerender } = renderHook(({ v, d }) => useDebouncedValue(v, d), {
      initialProps: { v: 'a', d: 100 },
    });
    rerender({ v: 'b', d: 100 });
    expect(result.current).toBe('a');
    act(() => jest.advanceTimersByTime(150));
    expect(result.current).toBe('b');
    rerender({ v: 'c', d: 0 });
    expect(result.current).toBe('c');
    jest.useRealTimers();
  });

  it('useResolvedTheme follows the OS preference', () => {
    const listeners: Array<() => void> = [];
    let dark = true;
    const original = window.matchMedia;
    window.matchMedia = ((q: string) => ({
      matches: dark,
      media: q,
      addEventListener: (_: string, l: () => void) => listeners.push(l),
      removeEventListener: () => undefined,
    })) as unknown as typeof window.matchMedia;
    const { result } = renderHook(() => useResolvedTheme('system'));
    expect(result.current).toBe('dark');
    dark = false;
    act(() => listeners.forEach((l) => l()));
    expect(result.current).toBe('light');
    expect(renderHook(() => useResolvedTheme('dark')).result.current).toBe('dark');
    window.matchMedia = original;
  });

  it('useFullscreen toggles the element', async () => {
    const request = jest.fn(async () => undefined);
    const exit = jest.fn(async () => undefined);
    Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, value: true });
    Object.defineProperty(document, 'exitFullscreen', { configurable: true, value: exit });
    let api: ReturnType<typeof useFullscreen> | null = null;
    function C() {
      const ref = useRef<HTMLDivElement>(null);
      api = useFullscreen(ref);
      return <div ref={ref} />;
    }
    const { container } = render(<C />);
    const el = container.firstChild as HTMLElement;
    el.requestFullscreen = request;
    expect(api!.supported).toBe(true);
    await act(() => api!.toggle());
    expect(request).toHaveBeenCalled();
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: el });
    act(() => {
      document.dispatchEvent(new Event('fullscreenchange'));
    });
    expect(api!.isFullscreen).toBe(true);
    await act(() => api!.toggle());
    expect(exit).toHaveBeenCalled();
    el.requestFullscreen = jest.fn(async () => {
      throw new Error('denied');
    });
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: null });
    await act(() => api!.toggle()); // swallowed
  });

  it('cssSize', () => {
    expect(cssSize(10)).toBe('10px');
    expect(cssSize('50%')).toBe('50%');
    expect(cssSize(undefined)).toBeUndefined();
  });
});

describe('copyText', () => {
  it('uses the async clipboard API, falling back to execCommand', async () => {
    Object.assign(navigator, { clipboard: { writeText: jest.fn().mockResolvedValue(undefined) } });
    await expect(copyText('a')).resolves.toBe(true);
    Object.assign(navigator, {
      clipboard: { writeText: jest.fn().mockRejectedValue(new Error('denied')) },
    });
    document.execCommand = jest.fn(() => true);
    await expect(copyText('b')).resolves.toBe(true);
    Object.assign(navigator, { clipboard: undefined });
    document.execCommand = jest.fn(() => {
      throw new Error('nope');
    });
    await expect(copyText('c')).resolves.toBe(false);
  });
});

describe('copyText without execCommand', () => {
  it('returns false when no copy mechanism exists', async () => {
    Object.assign(navigator, { clipboard: undefined });
    const original = document.execCommand;
    (document as { execCommand?: unknown }).execCommand = undefined;
    await expect(copyText('x')).resolves.toBe(false);
    document.execCommand = original;
  });
});

describe('useDocumentPreview without documents', () => {
  it('opens with no active document', async () => {
    const { useDocumentPreview } = await import('../useDocumentPreview');
    const { result } = renderHook(() => useDocumentPreview({ documents: [] }));
    expect(result.current.activeDocument).toBeNull();
    act(() => result.current.open());
    expect(result.current.isOpen).toBe(true);
    expect(result.current.activeDocument).toBeNull();
    act(() => result.current.open('missing'));
    expect(result.current.activeDocument).toBeNull();
    act(() => result.current.close());
    expect(result.current.isOpen).toBe(false);
  });
});
