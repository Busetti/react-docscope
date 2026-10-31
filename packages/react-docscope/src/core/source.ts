import type {
  DocumentResolver,
  DocumentSource,
  LoadingStrategy,
  PreviewDocument,
  ResolvedDocument,
  ResolverContext,
} from '../types';
import type { PreviewCaches } from './cache';
import { getExtension, isGenericMime, mimeFromExtension, normalizeMime } from './detect';
import { DocumentPreviewError, errorFromStatus, isAbortError, toPreviewError } from './errors';

/** Used when no resolver is supplied: previews `document.url` directly. */
export const defaultResolver: DocumentResolver = async (document) => {
  if (!document.url) {
    throw new DocumentPreviewError(
      'RESOLVE_FAILED',
      `Document "${document.name}" has no url and no resolver was provided.`,
    );
  }
  return { kind: 'url', url: document.url };
};

export function cacheKey(document: PreviewDocument): string {
  // Do not include the URL itself: signed URLs change on every resolution.
  return `${document.id}::${document.name}`;
}

function abortError(): DOMException {
  return new DOMException('The operation was aborted.', 'AbortError');
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortError();
}

/** Calls the resolver and validates its result. */
export async function runResolver(
  resolver: DocumentResolver,
  document: PreviewDocument,
  context: ResolverContext,
): Promise<ResolvedDocument> {
  let result: ResolvedDocument;
  try {
    result = await resolver(document, context);
  } catch (error) {
    if (isAbortError(error) || context.signal.aborted) throw abortError();
    if (error instanceof DocumentPreviewError) throw error;
    throw toPreviewError(error, 'RESOLVE_FAILED');
  }
  throwIfAborted(context.signal);
  if (!result || typeof result !== 'object') {
    throw new DocumentPreviewError('RESOLVE_FAILED', 'The resolver returned an invalid result.');
  }
  if (result.kind === 'url') {
    if (typeof result.url !== 'string' || !result.url) {
      throw new DocumentPreviewError('RESOLVE_FAILED', 'The resolver returned an empty URL.');
    }
    if (/^\s*javascript:/i.test(result.url)) {
      throw new DocumentPreviewError('RESOLVE_FAILED', 'The resolver returned an unsafe URL.');
    }
    return result;
  }
  if (result.kind === 'blob') {
    if (typeof Blob === 'undefined' || !(result.blob instanceof Blob)) {
      throw new DocumentPreviewError('RESOLVE_FAILED', 'The resolver returned an invalid Blob.');
    }
    return result;
  }
  throw new DocumentPreviewError('RESOLVE_FAILED', 'The resolver returned an unknown result kind.');
}

/** Downloads a resolved URL into a Blob, mapping HTTP failures to typed errors. */
export async function fetchResolved(
  resolved: Extract<ResolvedDocument, { kind: 'url' }>,
  signal: AbortSignal,
  maxBytes = Infinity,
): Promise<Blob> {
  let response: Response;
  try {
    response = await fetch(resolved.url, {
      signal,
      ...(resolved.headers ? { headers: resolved.headers } : {}),
      credentials: resolved.credentials ?? 'same-origin',
    });
  } catch (error) {
    if (isAbortError(error) || signal.aborted) throw abortError();
    // Network errors carry no useful, safe detail (and may contain the URL).
    throw new DocumentPreviewError(
      'FETCH_FAILED',
      'Network error while downloading the document.',
      {
        cause: error,
      },
    );
  }
  if (!response.ok) throw errorFromStatus(response.status);
  const length = Number(response.headers.get('content-length'));
  if (Number.isFinite(length) && length > maxBytes) {
    throw new DocumentPreviewError('TOO_LARGE', tooLargeMessage(length, maxBytes));
  }
  try {
    const blob = await response.blob();
    const headerType = normalizeMime(response.headers.get('content-type'));
    if (!blob.type && headerType) return new Blob([blob], { type: headerType });
    return blob;
  } catch (error) {
    if (isAbortError(error) || signal.aborted) throw abortError();
    throw new DocumentPreviewError('FETCH_FAILED', 'The download was interrupted.', {
      cause: error,
    });
  }
}

function tooLargeMessage(size: number, max: number): string {
  const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `This document is ${mb(size)}, which exceeds the ${mb(max)} preview limit.`;
}

/** Decodes text honouring UTF-8 / UTF-16 byte-order marks. */
export function decodeText(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  if (bytes[0] === 0xff && bytes[1] === 0xfe)
    return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff)
    return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder('utf-8').decode(bytes.subarray(3));
  }
  return new TextDecoder('utf-8').decode(bytes);
}

export function blobToArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  return blob.arrayBuffer();
}

export interface ManagedSourceOptions {
  document: PreviewDocument;
  resolved: ResolvedDocument;
  signal: AbortSignal;
  maxFileSize: number;
  caches?: PreviewCaches;
  /** Blob already available from cache. */
  blob?: Blob;
}

/**
 * The `DocumentSource` given to renderers. Lazily downloads and memoises data
 * and owns any `blob:` URLs it creates (revoked by `dispose`).
 */
export class ManagedSource implements DocumentSource {
  readonly kind: 'url' | 'blob';
  mimeType: string;
  size?: number;
  private blobPromise?: Promise<Blob>;
  private textPromise?: Promise<string>;
  private bufferPromise?: Promise<ArrayBuffer>;
  private objectUrls: string[] = [];
  private disposed = false;

  constructor(private readonly options: ManagedSourceOptions) {
    const { resolved, document, blob } = options;
    this.kind = resolved.kind;
    if (resolved.kind === 'blob') {
      this.blobPromise = Promise.resolve(resolved.blob);
      this.size = resolved.blob.size;
    } else if (blob) {
      this.blobPromise = Promise.resolve(blob);
      this.size = blob.size;
    } else if (typeof document.metadata?.size === 'number') {
      this.size = document.metadata.size;
    }
    const blobType = resolved.kind === 'blob' ? resolved.blob.type : blob?.type;
    this.mimeType = pickMime(resolved.mimeType, document, blobType);
  }

  /** Aborted when the pane stops using this source (document switch / unmount). */
  get signal(): AbortSignal {
    return this.options.signal;
  }

  getRequest(): {
    url: string;
    headers?: Record<string, string>;
    credentials?: RequestCredentials;
  } | null {
    const r = this.options.resolved;
    if (r.kind !== 'url') return null;
    return {
      url: r.url,
      ...(r.headers ? { headers: r.headers } : {}),
      ...(r.credentials ? { credentials: r.credentials } : {}),
    };
  }

  getBlob(): Promise<Blob> {
    if (!this.blobPromise) {
      const r = this.options.resolved as Extract<ResolvedDocument, { kind: 'url' }>;
      this.blobPromise = fetchResolved(r, this.options.signal, this.options.maxFileSize).then(
        (blob) => {
          this.size = blob.size;
          if (
            isGenericMime(this.mimeType) &&
            blob.type &&
            !isGenericMime(normalizeMime(blob.type))
          ) {
            this.mimeType = normalizeMime(blob.type);
          }
          this.options.caches?.blobs.set(cacheKey(this.options.document), blob);
          return blob;
        },
      );
      // Allow retry after failure.
      this.blobPromise.catch(() => {
        this.blobPromise = undefined;
      });
    }
    return this.blobPromise;
  }

  async getArrayBuffer(): Promise<ArrayBuffer> {
    if (!this.bufferPromise) {
      this.bufferPromise = this.getBlob().then(blobToArrayBuffer);
      this.bufferPromise.catch(() => {
        this.bufferPromise = undefined;
      });
    }
    return this.bufferPromise;
  }

  getText(): Promise<string> {
    if (!this.textPromise) {
      const key = cacheKey(this.options.document);
      const cached = this.options.caches?.text.get(key);
      this.textPromise =
        cached !== undefined
          ? Promise.resolve(cached)
          : this.getArrayBuffer().then((buf) => {
              const text = decodeText(buf);
              this.options.caches?.text.set(key, text);
              return text;
            });
      this.textPromise.catch(() => {
        this.textPromise = undefined;
      });
    }
    return this.textPromise;
  }

  async getUrl(): Promise<string> {
    const r = this.options.resolved;
    if (r.kind === 'url' && !r.headers && !this.blobPromise) return r.url;
    const blob = await this.getBlob();
    if (this.disposed) throw abortError();
    const url = URL.createObjectURL(blob);
    this.objectUrls.push(url);
    return url;
  }

  /** Revokes all object URLs created by this source. Safe to call repeatedly. */
  dispose(): void {
    this.disposed = true;
    for (const url of this.objectUrls) URL.revokeObjectURL(url);
    this.objectUrls = [];
  }
}

function pickMime(
  override: string | undefined,
  document: PreviewDocument,
  blobType?: string,
): string {
  const candidates = [override, document.type, blobType].map(normalizeMime);
  for (const c of candidates) if (c && !isGenericMime(c)) return c;
  return (
    mimeFromExtension(getExtension(document)) ||
    candidates.find(Boolean) ||
    'application/octet-stream'
  );
}

export interface LoadSourceOptions {
  document: PreviewDocument;
  resolver: DocumentResolver;
  strategy: LoadingStrategy;
  signal: AbortSignal;
  maxFileSize: number;
  retryOnAuthError: boolean;
  caches?: PreviewCaches;
  /** Starting attempt (incremented by "Retry"). */
  attempt?: number;
  reason?: ResolverContext['reason'];
  purpose?: ResolverContext['purpose'];
}

/**
 * Resolves a document and prepares a `ManagedSource`. For non-streaming
 * strategies the data is downloaded eagerly so that HTTP failures surface here,
 * and an authorization failure (expired signed URL) triggers one fresh
 * resolution when `retryOnAuthError` is enabled.
 */
export async function loadDocumentSource(options: LoadSourceOptions): Promise<ManagedSource> {
  const { document, resolver, signal, strategy, maxFileSize, caches } = options;
  throwIfAborted(signal);

  const declared = document.metadata?.size;
  if (typeof declared === 'number' && declared > maxFileSize && strategy !== 'url') {
    throw new DocumentPreviewError('TOO_LARGE', tooLargeMessage(declared, maxFileSize));
  }

  let attempt = options.attempt ?? 0;
  let reason: ResolverContext['reason'] = options.reason ?? 'initial';
  const useCache = reason !== 'retry';
  const cached = useCache ? caches?.blobs.get(cacheKey(document)) : undefined;
  if (cached && strategy !== 'url') {
    return new ManagedSource({
      document,
      resolved: { kind: 'blob', blob: cached },
      signal,
      maxFileSize,
      caches,
    });
  }
  if (!useCache) {
    caches?.blobs.delete(cacheKey(document));
    caches?.text.delete(cacheKey(document));
  }

  for (;;) {
    const resolved = await runResolver(resolver, document, {
      signal,
      purpose: options.purpose ?? 'preview',
      attempt,
      reason,
    });
    const source = new ManagedSource({
      document,
      resolved,
      signal,
      maxFileSize,
      ...(caches ? { caches } : {}),
    });
    if (resolved.kind === 'blob') {
      if (resolved.blob.size > maxFileSize && strategy !== 'url') {
        throw new DocumentPreviewError(
          'TOO_LARGE',
          tooLargeMessage(resolved.blob.size, maxFileSize),
        );
      }
      caches?.blobs.set(cacheKey(document), resolved.blob);
    }
    if (strategy === 'url') return source;
    try {
      const blob = await source.getBlob();
      if (blob.size === 0)
        throw new DocumentPreviewError('EMPTY_DOCUMENT', 'This document is empty.');
      return source;
    } catch (error) {
      if (
        error instanceof DocumentPreviewError &&
        error.code === 'ACCESS_DENIED' &&
        options.retryOnAuthError &&
        reason !== 'expired'
      ) {
        attempt += 1;
        reason = 'expired';
        continue;
      }
      throw error;
    }
  }
}
