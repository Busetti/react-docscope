import type { PreviewDocument } from '../types';

/** Lower-case extension of a document without the dot, or '' when unknown. */
export function getExtension(doc: Pick<PreviewDocument, 'extension' | 'name' | 'url'>): string {
  if (doc.extension) return doc.extension.replace(/^\./, '').toLowerCase();
  const fromName = extensionFromPath(doc.name);
  if (fromName) return fromName;
  if (doc.url && !doc.url.startsWith('blob:') && !doc.url.startsWith('data:')) {
    try {
      const path = new URL(doc.url, 'http://localhost').pathname;
      return extensionFromPath(decodeURIComponent(path));
    } catch {
      return '';
    }
  }
  return '';
}

function extensionFromPath(path: string | undefined): string {
  if (!path) return '';
  const base = path.split(/[\\/]/).pop() || '';
  const dot = base.lastIndexOf('.');
  if (dot <= 0 || dot === base.length - 1) return '';
  return base.slice(dot + 1).toLowerCase();
}

/** MIME types for known extensions, used when neither document nor server report one. */
const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  avif: 'image/avif',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xlsm: 'application/vnd.ms-excel.sheet.macroEnabled.12',
  md: 'text/markdown',
  markdown: 'text/markdown',
  txt: 'text/plain',
  log: 'text/plain',
  csv: 'text/csv',
  tsv: 'text/tab-separated-values',
  json: 'application/json',
  geojson: 'application/geo+json',
  xml: 'application/xml',
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  webm: 'video/webm',
  ogv: 'video/ogg',
  mov: 'video/quicktime',
};

export function mimeFromExtension(ext: string): string | undefined {
  return MIME_BY_EXTENSION[ext.toLowerCase()];
}

/** Strips parameters (`; charset=utf-8`) and lower-cases a MIME type. */
export function normalizeMime(mime: string | undefined | null): string {
  if (!mime) return '';
  return mime.split(';')[0]!.trim().toLowerCase();
}

/** Effective MIME type for a document, from explicit type or extension. */
export function getMimeType(doc: PreviewDocument): string {
  return normalizeMime(doc.type) || mimeFromExtension(getExtension(doc)) || '';
}

/** Generic MIME types that should not override extension-based detection. */
export function isGenericMime(mime: string): boolean {
  return (
    !mime ||
    mime === 'application/octet-stream' ||
    mime === 'binary/octet-stream' ||
    mime === 'application/zip' ||
    mime === 'application/x-zip-compressed' ||
    mime === 'application/unknown'
  );
}
