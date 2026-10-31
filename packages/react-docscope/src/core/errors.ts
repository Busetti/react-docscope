import type { PreviewError, PreviewErrorCode } from '../types';

/** Error class used internally; converted to the plain `PreviewError` shape for consumers. */
export class DocumentPreviewError extends Error implements PreviewError {
  readonly code: PreviewErrorCode;
  readonly status?: number;
  override readonly cause?: unknown;
  documentId?: string;

  constructor(
    code: PreviewErrorCode,
    message: string,
    options: { status?: number; cause?: unknown } = {},
  ) {
    super(message);
    this.name = 'DocumentPreviewError';
    this.code = code;
    if (options.status !== undefined) this.status = options.status;
    if (options.cause !== undefined) this.cause = options.cause;
  }

  toJSON(): PreviewError {
    return {
      code: this.code,
      message: this.message,
      ...(this.status !== undefined ? { status: this.status } : {}),
      ...(this.documentId !== undefined ? { documentId: this.documentId } : {}),
    };
  }
}

export function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const name = (error as { name?: unknown }).name;
  return name === 'AbortError' || name === 'AbortException';
}

/** Normalises any thrown value into a `DocumentPreviewError` with a safe message. */
export function toPreviewError(error: unknown, fallback: PreviewErrorCode): DocumentPreviewError {
  if (error instanceof DocumentPreviewError) return error;
  const raw = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  const message = sanitizeMessage(raw) || defaultMessage(fallback);
  return new DocumentPreviewError(fallback, message, { cause: error });
}

/** Removes URLs (which may contain signatures / tokens) from messages. */
export function sanitizeMessage(message: string): string {
  return message
    .replace(/\b(?:https?|blob|data|s3|gs|file):\/?\/?[^\s"'<>)]+/gi, '[url]')
    .replace(/\b(bearer|basic)\s+[A-Za-z0-9\-._~+/]+=*/gi, '$1 [redacted]')
    .trim();
}

export function defaultMessage(code: PreviewErrorCode): string {
  switch (code) {
    case 'RESOLVE_FAILED':
      return 'The document location could not be resolved.';
    case 'FETCH_FAILED':
      return 'The document could not be downloaded.';
    case 'ACCESS_DENIED':
      return 'You do not have access to this document, or the link has expired.';
    case 'NOT_FOUND':
      return 'The document could not be found.';
    case 'UNSUPPORTED_FORMAT':
      return 'Preview is not available for this file type.';
    case 'TOO_LARGE':
      return 'This document is too large to preview.';
    case 'EMPTY_DOCUMENT':
      return 'This document is empty.';
    case 'MALFORMED_DOCUMENT':
      return 'This document appears to be damaged or is not a valid file.';
    case 'RENDER_FAILED':
      return 'Something went wrong while displaying this document.';
    case 'DOWNLOAD_FAILED':
      return 'The download failed.';
  }
}

export function errorFromStatus(status: number): DocumentPreviewError {
  if (status === 401 || status === 403) {
    return new DocumentPreviewError('ACCESS_DENIED', defaultMessage('ACCESS_DENIED'), { status });
  }
  if (status === 404 || status === 410) {
    return new DocumentPreviewError('NOT_FOUND', defaultMessage('NOT_FOUND'), { status });
  }
  return new DocumentPreviewError('FETCH_FAILED', `Request failed with status ${status}.`, {
    status,
  });
}
