import '@testing-library/jest-dom';
import { toHaveNoViolations } from 'jest-axe';
import { TextDecoder, TextEncoder } from 'node:util';
import { webcrypto } from 'node:crypto';

expect.extend(toHaveNoViolations);

const g = globalThis as Record<string, unknown>;
if (!g.TextDecoder) g.TextDecoder = TextDecoder;
if (!g.TextEncoder) g.TextEncoder = TextEncoder;
if (!g.crypto) g.crypto = webcrypto;

class ResizeObserverMock {
  private cb: ResizeObserverCallback;
  constructor(cb: ResizeObserverCallback) {
    this.cb = cb;
  }
  observe(target: Element) {
    this.cb([{ target, contentRect: target.getBoundingClientRect() } as unknown as ResizeObserverEntry], this as unknown as ResizeObserver);
  }
  unobserve() {}
  disconnect() {}
}
g.ResizeObserver = ResizeObserverMock;

class IntersectionObserverMock {
  private cb: IntersectionObserverCallback;
  constructor(cb: IntersectionObserverCallback) {
    this.cb = cb;
  }
  observe(target: Element) {
    this.cb(
      [{ target, isIntersecting: true, intersectionRatio: 1 } as unknown as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    );
  }
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}
g.IntersectionObserver = IntersectionObserverMock;

if (!window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

let urlCounter = 0;
if (!URL.createObjectURL) {
  URL.createObjectURL = jest.fn(() => `blob:mock/${++urlCounter}`);
  URL.revokeObjectURL = jest.fn();
}

// Blob.arrayBuffer / text are missing in some jsdom versions.
if (!Blob.prototype.arrayBuffer) {
  Blob.prototype.arrayBuffer = function arrayBuffer(this: Blob) {
    return new Promise<ArrayBuffer>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result as ArrayBuffer);
      r.onerror = () => reject(r.error);
      r.readAsArrayBuffer(this);
    });
  };
}
if (!Blob.prototype.text) {
  Blob.prototype.text = function text(this: Blob) {
    return this.arrayBuffer().then((b) => new TextDecoder().decode(b));
  };
}

// jsdom does not implement scrolling APIs.
Element.prototype.scrollTo = function scrollTo(this: Element, opts?: ScrollToOptions | number) {
  if (typeof opts === 'object') {
    if (opts.top !== undefined) (this as HTMLElement).scrollTop = opts.top;
    if (opts.left !== undefined) (this as HTMLElement).scrollLeft = opts.left;
  }
} as Element['scrollTo'];
Element.prototype.scrollIntoView = function scrollIntoView() {};
if (!HTMLMediaElement.prototype.pause) HTMLMediaElement.prototype.pause = () => {};
