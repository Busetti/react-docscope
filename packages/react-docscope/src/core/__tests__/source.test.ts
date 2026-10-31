import { createCaches } from '../cache';
import { downloadDocument, saveBlob } from '../download';
import { DocumentPreviewError } from '../errors';
import {
  ManagedSource,
  cacheKey,
  decodeText,
  defaultResolver,
  fetchResolved,
  loadDocumentSource,
  runResolver,
} from '../source';
import type { DocumentResolver, PreviewDocument } from '../../types';
import { mockResponse } from '../../../../../tests/setup/fixtures';

const doc: PreviewDocument = {
  id: 'd1',
  name: 'report.txt',
  url: 'https://example.com/report.txt?sig=SECRET',
};
const ctrl = () => new AbortController();
const fetchMock = jest.fn();

beforeEach(() => {
  fetchMock.mockReset();
  (globalThis as { fetch?: unknown }).fetch = fetchMock;
});

describe('defaultResolver / runResolver', () => {
  it('resolves document url', async () => {
    await expect(
      defaultResolver(doc, {
        signal: ctrl().signal,
        purpose: 'preview',
        attempt: 0,
        reason: 'initial',
      }),
    ).resolves.toEqual({
      kind: 'url',
      url: doc.url,
    });
    await expect(
      defaultResolver(
        { id: 'x', name: 'n' },
        { signal: ctrl().signal, purpose: 'preview', attempt: 0, reason: 'initial' },
      ),
    ).rejects.toMatchObject({ code: 'RESOLVE_FAILED' });
  });

  const context = () => ({
    signal: ctrl().signal,
    purpose: 'preview' as const,
    attempt: 0,
    reason: 'initial' as const,
  });

  it('validates resolver output', async () => {
    await expect(runResolver(async () => null as never, doc, context())).rejects.toMatchObject({
      code: 'RESOLVE_FAILED',
    });
    await expect(
      runResolver(async () => ({ kind: 'url', url: '' }), doc, context()),
    ).rejects.toThrow(/empty URL/);
    await expect(
      runResolver(async () => ({ kind: 'url', url: 'javascript:alert(1)' }), doc, context()),
    ).rejects.toThrow(/unsafe/);
    await expect(
      runResolver(async () => ({ kind: 'blob', blob: 'x' as never }), doc, context()),
    ).rejects.toThrow(/Blob/);
    await expect(
      runResolver(async () => ({ kind: 'weird' }) as never, doc, context()),
    ).rejects.toThrow(/unknown/);
    const blob = new Blob(['a']);
    await expect(
      runResolver(async () => ({ kind: 'blob', blob }), doc, context()),
    ).resolves.toEqual({ kind: 'blob', blob });
  });

  it('wraps resolver failures and sanitises their messages', async () => {
    const failing: DocumentResolver = async () => {
      throw new Error('could not sign https://s3/bucket/key?X-Amz-Signature=SECRET');
    };
    const err = await runResolver(failing, doc, context()).catch((e) => e);
    expect(err).toBeInstanceOf(DocumentPreviewError);
    expect(err.code).toBe('RESOLVE_FAILED');
    expect(err.message).not.toContain('SECRET');
    const typed = new DocumentPreviewError('ACCESS_DENIED', 'denied');
    await expect(
      runResolver(
        async () => {
          throw typed;
        },
        doc,
        context(),
      ),
    ).rejects.toBe(typed);
  });

  it('propagates aborts', async () => {
    const c = ctrl();
    const resolver: DocumentResolver = async () => {
      c.abort();
      return { kind: 'url', url: 'https://x' };
    };
    await expect(
      runResolver(resolver, doc, { ...context(), signal: c.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    const c2 = ctrl();
    const rejecting: DocumentResolver = async () => {
      c2.abort();
      throw new Error('boom');
    };
    await expect(
      runResolver(rejecting, doc, { ...context(), signal: c2.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('fetchResolved', () => {
  it('passes headers, credentials and signal', async () => {
    fetchMock.mockResolvedValue(mockResponse('hello', { type: 'text/plain' }));
    const c = ctrl();
    const blob = await fetchResolved(
      {
        kind: 'url',
        url: 'https://x/a',
        headers: { Authorization: 'Bearer t' },
        credentials: 'include',
      },
      c.signal,
    );
    expect(await blob.text()).toBe('hello');
    expect(fetchMock).toHaveBeenCalledWith('https://x/a', {
      signal: c.signal,
      headers: { Authorization: 'Bearer t' },
      credentials: 'include',
    });
  });

  it('maps statuses, network errors, size limits and aborts', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(null, { status: 403 }));
    await expect(fetchResolved({ kind: 'url', url: 'u' }, ctrl().signal)).rejects.toMatchObject({
      code: 'ACCESS_DENIED',
      status: 403,
    });
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch https://secret'));
    const err = await fetchResolved({ kind: 'url', url: 'u' }, ctrl().signal).catch((e) => e);
    expect(err.code).toBe('FETCH_FAILED');
    expect(err.message).not.toContain('secret');
    fetchMock.mockResolvedValueOnce(mockResponse('x', { length: 5000 }));
    await expect(
      fetchResolved({ kind: 'url', url: 'u' }, ctrl().signal, 100),
    ).rejects.toMatchObject({ code: 'TOO_LARGE' });
    fetchMock.mockRejectedValueOnce(new DOMException('a', 'AbortError'));
    await expect(fetchResolved({ kind: 'url', url: 'u' }, ctrl().signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
    const broken = mockResponse('x');
    (broken as { blob: () => Promise<Blob> }).blob = async () => {
      throw new Error('reset');
    };
    fetchMock.mockResolvedValueOnce(broken);
    await expect(fetchResolved({ kind: 'url', url: 'u' }, ctrl().signal)).rejects.toThrow(
      /interrupted/,
    );
    const c = ctrl();
    const aborted = mockResponse('x');
    (aborted as { blob: () => Promise<Blob> }).blob = async () => {
      c.abort();
      throw new Error('aborted');
    };
    fetchMock.mockResolvedValueOnce(aborted);
    await expect(fetchResolved({ kind: 'url', url: 'u' }, c.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
  });

  it('keeps blob type or applies the response content-type', async () => {
    const res = mockResponse('x');
    (res as { blob: () => Promise<Blob> }).blob = async () => new Blob(['x']);
    (res as unknown as { headers: { get: (k: string) => string | null } }).headers = {
      get: (k) => (k === 'content-type' ? 'application/json; charset=utf-8' : null),
    };
    fetchMock.mockResolvedValueOnce(res);
    const blob = await fetchResolved({ kind: 'url', url: 'u' }, ctrl().signal);
    expect(blob.type).toBe('application/json');
  });
});

describe('decodeText', () => {
  const enc = (bytes: number[]) => new Uint8Array(bytes).buffer;
  it('handles BOMs', () => {
    expect(decodeText(enc([0xef, 0xbb, 0xbf, 0x68, 0x69]))).toBe('hi');
    expect(decodeText(enc([0xff, 0xfe, 0x68, 0x00]))).toBe('h');
    expect(decodeText(enc([0xfe, 0xff, 0x00, 0x68]))).toBe('h');
    expect(decodeText(new TextEncoder().encode('héllo').buffer as ArrayBuffer)).toBe('héllo');
  });
});

describe('ManagedSource', () => {
  it('streams URLs without headers and creates blob URLs otherwise', async () => {
    const s = new ManagedSource({
      document: doc,
      resolved: { kind: 'url', url: 'https://x/a.pdf' },
      signal: ctrl().signal,
      maxFileSize: 1e6,
    });
    expect(s.kind).toBe('url');
    expect(s.mimeType).toBe('text/plain');
    await expect(s.getUrl()).resolves.toBe('https://x/a.pdf');
    expect(s.getRequest()).toEqual({ url: 'https://x/a.pdf' });

    const withHeaders = new ManagedSource({
      document: { ...doc, metadata: { size: 42 } },
      resolved: {
        kind: 'url',
        url: 'https://x/a',
        headers: { A: 'b' },
        credentials: 'include',
        mimeType: 'text/markdown',
      },
      signal: ctrl().signal,
      maxFileSize: 1e6,
    });
    expect(withHeaders.size).toBe(42);
    expect(withHeaders.mimeType).toBe('text/markdown');
    expect(withHeaders.getRequest()).toEqual({
      url: 'https://x/a',
      headers: { A: 'b' },
      credentials: 'include',
    });
    fetchMock.mockResolvedValue(mockResponse('# hi'));
    const url = await withHeaders.getUrl();
    expect(url).toMatch(/^blob:/);
    expect(await withHeaders.getText()).toBe('# hi');
    expect(await withHeaders.getText()).toBe('# hi'); // memoised
    expect(fetchMock).toHaveBeenCalledTimes(1);
    withHeaders.dispose();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(url);
    await expect(withHeaders.getUrl()).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('wraps blobs and caches downloads and text', async () => {
    const caches = createCaches(1e6);
    const blob = new Blob(['{"a":1}'], { type: 'application/json' });
    const s = new ManagedSource({
      document: { id: 'b', name: 'data' },
      resolved: { kind: 'blob', blob },
      signal: ctrl().signal,
      maxFileSize: 1e6,
      caches,
    });
    expect(s.kind).toBe('blob');
    expect(s.mimeType).toBe('application/json');
    expect(s.getRequest()).toBeNull();
    expect(await s.getText()).toBe('{"a":1}');
    expect(caches.text.get(cacheKey({ id: 'b', name: 'data' }))).toBe('{"a":1}');
    const s2 = new ManagedSource({
      document: { id: 'b', name: 'data' },
      resolved: { kind: 'blob', blob: new Blob(['other']) },
      signal: ctrl().signal,
      maxFileSize: 1e6,
      caches,
    });
    expect(await s2.getText()).toBe('{"a":1}'); // served from the text cache

    fetchMock.mockResolvedValue(mockResponse('abc', { type: 'text/csv' }));
    const s3 = new ManagedSource({
      document: { id: 'c', name: 'noext' },
      resolved: { kind: 'url', url: 'u' },
      signal: ctrl().signal,
      maxFileSize: 1e6,
      caches,
    });
    expect(s3.mimeType).toBe('application/octet-stream');
    await s3.getBlob();
    expect(s3.mimeType).toBe('text/csv');
    expect(s3.size).toBe(3);
    expect(caches.blobs.has(cacheKey({ id: 'c', name: 'noext' }))).toBe(true);
    const pre = new ManagedSource({
      document: doc,
      resolved: { kind: 'url', url: 'u' },
      signal: ctrl().signal,
      maxFileSize: 1,
      blob: new Blob(['zz']),
    });
    expect(pre.size).toBe(2);
    expect(await pre.getUrl()).toMatch(/^blob:/);
  });

  it('allows retrying after a failed download', async () => {
    const s = new ManagedSource({
      document: doc,
      resolved: { kind: 'url', url: 'u' },
      signal: ctrl().signal,
      maxFileSize: 1e6,
    });
    fetchMock.mockResolvedValueOnce(mockResponse(null, { status: 500 }));
    await expect(s.getText()).rejects.toMatchObject({ code: 'FETCH_FAILED' });
    fetchMock.mockResolvedValueOnce(mockResponse('ok'));
    await expect(s.getText()).resolves.toBe('ok');
    const s2 = new ManagedSource({
      document: doc,
      resolved: { kind: 'url', url: 'u' },
      signal: ctrl().signal,
      maxFileSize: 1e6,
    });
    fetchMock.mockResolvedValueOnce(mockResponse(null, { status: 500 }));
    await expect(s2.getArrayBuffer()).rejects.toBeTruthy();
    fetchMock.mockResolvedValueOnce(mockResponse('ok'));
    await expect(s2.getArrayBuffer()).resolves.toBeInstanceOf(ArrayBuffer);
  });
});

describe('loadDocumentSource', () => {
  const base = { strategy: 'text' as const, maxFileSize: 1e6, retryOnAuthError: true };

  it('re-resolves once when a signed URL has expired', async () => {
    const resolver = jest.fn<ReturnType<DocumentResolver>, Parameters<DocumentResolver>>(
      async (_d, c) => ({
        kind: 'url',
        url: `https://x/file?attempt=${c.attempt}`,
      }),
    );
    fetchMock
      .mockResolvedValueOnce(mockResponse(null, { status: 403 }))
      .mockResolvedValueOnce(mockResponse('fresh'));
    const s = await loadDocumentSource({ ...base, document: doc, resolver, signal: ctrl().signal });
    expect(await s.getText()).toBe('fresh');
    expect(resolver).toHaveBeenCalledTimes(2);
    expect(resolver.mock.calls[1]![1]).toMatchObject({
      attempt: 1,
      reason: 'expired',
      purpose: 'preview',
    });
  });

  it('gives up after the second authorization failure or when retry is disabled', async () => {
    const resolver: DocumentResolver = async () => ({ kind: 'url', url: 'https://x' });
    fetchMock.mockResolvedValue(mockResponse(null, { status: 401 }));
    await expect(
      loadDocumentSource({ ...base, document: doc, resolver, signal: ctrl().signal }),
    ).rejects.toMatchObject({ code: 'ACCESS_DENIED' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    fetchMock.mockClear();
    await expect(
      loadDocumentSource({
        ...base,
        retryOnAuthError: false,
        document: doc,
        resolver,
        signal: ctrl().signal,
      }),
    ).rejects.toMatchObject({ code: 'ACCESS_DENIED' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('enforces size limits and detects empty documents', async () => {
    await expect(
      loadDocumentSource({
        ...base,
        maxFileSize: 10,
        document: { ...doc, metadata: { size: 100 } },
        resolver: defaultResolver,
        signal: ctrl().signal,
      }),
    ).rejects.toMatchObject({ code: 'TOO_LARGE' });
    await expect(
      loadDocumentSource({
        ...base,
        maxFileSize: 2,
        document: doc,
        resolver: async () => ({ kind: 'blob', blob: new Blob(['12345']) }),
        signal: ctrl().signal,
      }),
    ).rejects.toMatchObject({ code: 'TOO_LARGE' });
    await expect(
      loadDocumentSource({
        ...base,
        document: doc,
        resolver: async () => ({ kind: 'blob', blob: new Blob([]) }),
        signal: ctrl().signal,
      }),
    ).rejects.toMatchObject({ code: 'EMPTY_DOCUMENT' });
  });

  it('does not download for streaming strategies', async () => {
    const s = await loadDocumentSource({
      ...base,
      strategy: 'url',
      document: { ...doc, metadata: { size: 1e9 } },
      resolver: defaultResolver,
      signal: ctrl().signal,
    });
    expect(fetchMock).not.toHaveBeenCalled();
    await expect(s.getUrl()).resolves.toBe(doc.url);
  });

  it('serves cached blobs without calling the resolver, and bypasses cache on retry', async () => {
    const caches = createCaches(1e6);
    const resolver = jest.fn(async () => ({ kind: 'blob' as const, blob: new Blob(['v1']) }));
    await loadDocumentSource({ ...base, document: doc, resolver, signal: ctrl().signal, caches });
    const again = await loadDocumentSource({
      ...base,
      document: doc,
      resolver,
      signal: ctrl().signal,
      caches,
    });
    expect(resolver).toHaveBeenCalledTimes(1);
    expect(await again.getText()).toBe('v1');
    resolver.mockResolvedValueOnce({ kind: 'blob', blob: new Blob(['v2']) });
    const retried = await loadDocumentSource({
      ...base,
      document: doc,
      resolver,
      signal: ctrl().signal,
      caches,
      attempt: 1,
      reason: 'retry',
    });
    expect(await retried.getText()).toBe('v2');
    expect(resolver).toHaveBeenCalledTimes(2);
  });

  it('rejects immediately when already aborted', async () => {
    const c = ctrl();
    c.abort();
    await expect(
      loadDocumentSource({ ...base, document: doc, resolver: defaultResolver, signal: c.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('propagates non-auth errors', async () => {
    fetchMock.mockResolvedValue(mockResponse(null, { status: 404 }));
    await expect(
      loadDocumentSource({
        ...base,
        document: doc,
        resolver: defaultResolver,
        signal: ctrl().signal,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('downloads', () => {
  let clicks: Array<{ href: string; download: string }>;
  beforeEach(() => {
    clicks = [];
    jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicks.push({ href: this.href, download: this.download });
    });
  });
  afterEach(() => jest.restoreAllMocks());

  it('saves blobs with the document name', () => {
    jest.useFakeTimers();
    saveBlob(new Blob(['x']), 'a.txt');
    expect(clicks[0]!.download).toBe('a.txt');
    jest.runAllTimers();
    expect(URL.revokeObjectURL).toHaveBeenCalled();
    jest.useRealTimers();
  });

  it('uses cache, blob resolvers and URL fetches', async () => {
    const caches = createCaches(1e6);
    caches.blobs.set(cacheKey(doc), new Blob(['cached']));
    const resolver = jest.fn(defaultResolver);
    await downloadDocument({ document: doc, resolver, signal: ctrl().signal, caches });
    expect(resolver).not.toHaveBeenCalled();
    await downloadDocument({
      document: doc,
      resolver: async () => ({ kind: 'blob', blob: new Blob(['b']) }),
      signal: ctrl().signal,
    });
    fetchMock.mockResolvedValueOnce(mockResponse('u'));
    const purposeSpy = jest.fn(defaultResolver);
    await downloadDocument({ document: doc, resolver: purposeSpy, signal: ctrl().signal });
    expect(purposeSpy.mock.calls[0]![1].purpose).toBe('download');
    expect(clicks).toHaveLength(3);
  });

  it('falls back to a link on CORS-like failures and reports other errors', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('cors'));
    await downloadDocument({ document: doc, resolver: defaultResolver, signal: ctrl().signal });
    expect(clicks[0]!.href).toBe(doc.url);
    fetchMock.mockResolvedValueOnce(mockResponse(null, { status: 500 }));
    await expect(
      downloadDocument({ document: doc, resolver: defaultResolver, signal: ctrl().signal }),
    ).rejects.toMatchObject({ code: 'FETCH_FAILED' });
    fetchMock.mockRejectedValueOnce(new DOMException('a', 'AbortError'));
    await expect(
      downloadDocument({ document: doc, resolver: defaultResolver, signal: ctrl().signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});
