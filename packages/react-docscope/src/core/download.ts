import type { DocumentResolver, PreviewDocument } from '../types';
import { cacheKey, fetchResolved, runResolver } from './source';
import type { PreviewCaches } from './cache';
import { DocumentPreviewError, isAbortError, toPreviewError } from './errors';

/** Triggers a browser download for a Blob. */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  try {
    clickLink(url, filename);
  } finally {
    // Give the browser a moment to start the download before revoking.
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }
}

function clickLink(href: string, filename?: string): void {
  const a = document.createElement('a');
  a.href = href;
  if (filename) a.download = filename;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export interface DownloadOptions {
  document: PreviewDocument;
  resolver: DocumentResolver;
  signal: AbortSignal;
  caches?: PreviewCaches;
}

/**
 * Default download behaviour:
 * 1. use cached bytes when available,
 * 2. otherwise resolve with `purpose: 'download'`,
 * 3. blobs are saved directly; URLs are fetched (to honour headers and the
 *    file name) and fall back to a plain link when CORS prevents fetching.
 */
export async function downloadDocument(options: DownloadOptions): Promise<void> {
  const { document: doc, resolver, signal, caches } = options;
  const cached = caches?.blobs.get(cacheKey(doc));
  if (cached) {
    saveBlob(cached, doc.name);
    return;
  }
  const resolved = await runResolver(resolver, doc, {
    signal,
    purpose: 'download',
    attempt: 0,
    reason: 'initial',
  });
  if (resolved.kind === 'blob') {
    saveBlob(resolved.blob, doc.name);
    return;
  }
  try {
    const blob = await fetchResolved(resolved, signal);
    saveBlob(blob, doc.name);
  } catch (error) {
    if (isAbortError(error)) throw error;
    if (
      !resolved.headers &&
      error instanceof DocumentPreviewError &&
      error.code === 'FETCH_FAILED' &&
      error.status === undefined
    ) {
      // Likely CORS: let the browser navigate to the URL instead.
      clickLink(resolved.url, doc.name);
      return;
    }
    throw toPreviewError(error, 'DOWNLOAD_FAILED');
  }
}
