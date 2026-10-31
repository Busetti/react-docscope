import type { DocumentResolver, PreviewDocument } from 'react-docscope';

const now = Date.now();
const iso = (daysAgo: number) => new Date(now - daysAgo * 86_400_000).toISOString();

const doc = (
  id: string,
  name: string,
  size: number,
  extra: Partial<PreviewDocument> = {},
): PreviewDocument => ({
  id,
  name,
  url: `/fixtures/${name}`,
  metadata: {
    size,
    uploadedAt: iso(id.length),
    uploadedBy: 'Guru',
    description: extra.metadata?.description as string | undefined,
  },
  ...extra,
});

/** One document per supported format. */
export const allFormats: PreviewDocument[] = [
  doc('pdf', 'sample.pdf', 7527, {
    metadata: {
      size: 7527,
      uploadedAt: iso(2),
      uploadedBy: 'Finance',
      description: 'Annual report (6 pages)',
      department: 'Finance',
    },
  }),
  doc('docx', 'proposal.docx', 50160, {
    metadata: {
      size: 50160,
      uploadedAt: iso(3),
      uploadedBy: 'Guru',
      description: 'Project proposal with table and image',
    },
  }),
  doc('pptx', 'deck.pptx', 50001, {
    metadata: {
      size: 50001,
      uploadedAt: iso(4),
      uploadedBy: 'Sales',
      description: 'Quarterly business review',
    },
  }),
  doc('xlsx', 'budget.xlsx', 36156, {
    metadata: {
      size: 36156,
      uploadedAt: iso(5),
      uploadedBy: 'Finance',
      description: 'Read-only workbook: 3 visible sheets, merges, formulas',
    },
  }),
  doc('csv', 'customers.csv', 14425),
  doc('img-jpg', 'photo.jpg', 49529),
  doc('img-png', 'diagram.png', 11501),
  doc('img-svg', 'icon.svg', 375),
  doc('img-gif', 'animation.gif', 3274),
  doc('img-webp', 'image.webp', 11530),
  doc('img-avif', 'image.avif', 4551),
  doc('md', 'readme.md', 511),
  doc('txt', 'notes.txt', 8520),
  doc('json', 'config.json', 295),
  doc('xml', 'catalog.xml', 544),
  doc('video', 'clip.mp4', 46454),
  doc('video-webm', 'clip.webm', 87269),
];

export const compareDocs: PreviewDocument[] = [
  doc('pdf-a', 'sample.pdf', 7527, { metadata: { size: 7527, description: 'Version A' } }),
  doc('pdf-b', 'contract-v2.pdf', 4360, {
    metadata: { size: 4360, description: 'Version B (landscape)' },
  }),
  doc('cmp-xlsx', 'budget.xlsx', 36156),
  doc('cmp-docx', 'proposal.docx', 50160),
  doc('cmp-img', 'photo.jpg', 49529),
];

export const largeDocs: PreviewDocument[] = [
  {
    id: 'large-pdf',
    name: 'large.pdf',
    url: '/fixtures/large/large.pdf',
    metadata: { description: '400 pages — only visible pages render' },
  },
  {
    id: 'large-csv',
    name: 'large.csv',
    url: '/fixtures/large/large.csv',
    metadata: { description: '200,000 rows, virtualized' },
  },
  {
    id: 'large-xlsx',
    name: 'large.xlsx',
    url: '/fixtures/large/large.xlsx',
    metadata: { description: '20,000 × 12 cells' },
  },
  {
    id: 'large-txt',
    name: 'large.txt',
    url: '/fixtures/large/large.txt',
    metadata: { description: '200,000 log lines' },
  },
  {
    id: 'large-json',
    name: 'large.json',
    url: '/fixtures/large/large.json',
    metadata: { description: '20,000 objects' },
  },
  {
    id: 'large-xml',
    name: 'large.xml',
    url: '/fixtures/large/large.xml',
    metadata: { description: '20,000 elements' },
  },
];

/** Documents that exercise every error path. */
export const failureDocs: PreviewDocument[] = [
  {
    id: 'fail-resolver',
    name: 'resolver-throws.pdf',
    metadata: { description: 'The resolver rejects (backend down)' },
  },
  {
    id: 'fail-404',
    name: 'missing.pdf',
    url: '/status/404',
    metadata: { description: 'Server returns 404' },
  },
  {
    id: 'fail-500',
    name: 'server-error.docx',
    url: '/status/500',
    metadata: { description: 'Server returns 500' },
  },
  {
    id: 'fail-403',
    name: 'forbidden.xlsx',
    url: '/status/403',
    metadata: { description: 'Always 403 (retried once, then shown)' },
  },
  { id: 'fail-malformed-pdf', name: 'malformed.pdf', url: '/fixtures/malformed.pdf' },
  { id: 'fail-malformed-docx', name: 'malformed.docx', url: '/fixtures/malformed.docx' },
  { id: 'fail-malformed-xlsx', name: 'malformed.xlsx', url: '/fixtures/malformed.xlsx' },
  { id: 'fail-malformed-pptx', name: 'malformed.pptx', url: '/fixtures/malformed.pptx' },
  {
    id: 'fail-json',
    name: 'invalid.json',
    url: '/fixtures/invalid.json',
    metadata: { description: 'Shown with an inline parse error' },
  },
  { id: 'fail-xml', name: 'malformed.xml', url: '/fixtures/malformed.xml' },
  { id: 'fail-image', name: 'broken-image.png', url: '/fixtures/broken-image.png' },
  { id: 'fail-empty', name: 'empty.txt', url: '/fixtures/empty.txt' },
  { id: 'fail-unsupported', name: 'archive.bin', url: '/fixtures/unknown.bin' },
  {
    id: 'pptx-fallback',
    name: 'broken-deck.pptx',
    url: '/fixtures/malformed.pptx',
    fallback: { name: 'broken-deck (converted).pdf', url: '/fixtures/sample.pdf' },
    metadata: { description: 'Broken PPTX with a consumer-supplied PDF fallback' },
  },
];

/* ------------------------------------------------------------------ resolvers */

const path = (d: PreviewDocument) => (d.url ?? '').replace(/^\/fixtures\//, '');

/** Plain resolver: use the document URL. */
export const directResolver: DocumentResolver = async (d) => {
  if (!d.url) throw new Error('This document has no storage location.');
  return { kind: 'url', url: d.url };
};

/**
 * Mock "backend" issuing short-lived signed URLs. The first resolution of each
 * document deliberately returns an already-expired URL so you can watch the
 * library re-resolve automatically (attempt 1, reason "expired").
 */
export function createSignedUrlResolver(
  log: (line: string) => void,
  ttlMs = 60_000,
): DocumentResolver {
  return async (d, { signal, attempt, reason, purpose }) => {
    await new Promise((r, reject) => {
      const t = setTimeout(r, 250);
      signal.addEventListener('abort', () => {
        clearTimeout(t);
        reject(new DOMException('Aborted', 'AbortError'));
      });
    });
    const expires = attempt === 0 && purpose === 'preview' ? Date.now() - 1000 : Date.now() + ttlMs;
    const sig = Math.random().toString(36).slice(2, 10);
    log(
      `resolve "${d.name}" · purpose=${purpose} · attempt=${attempt} · reason=${reason} → ${attempt === 0 && purpose === 'preview' ? 'expired URL' : `URL valid for ${ttlMs / 1000}s`}`,
    );
    return { kind: 'url', url: `/signed/${path(d)}?expires=${expires}&sig=${sig}` };
  };
}

/** Resolver using an Authorization header (never logged by the library). */
export const headerResolver: DocumentResolver = async (d) => ({
  kind: 'url',
  url: `/secure/${path(d)}`,
  headers: { Authorization: 'Bearer demo-token' },
});

export const failureResolver: DocumentResolver = async (d) => {
  if (d.id === 'fail-resolver')
    throw new Error(
      'Backend unavailable (503) while signing https://storage.example.com/key?X-Amz-Signature=secret',
    );
  if (!d.url) throw new Error('No URL');
  return { kind: 'url', url: d.url };
};

/** Local files picked by the user: previewed from memory, never uploaded. */
export function createLocalFileResolver(files: Map<string, File>): DocumentResolver {
  return async (d) => {
    const file = files.get(d.id);
    if (!file) throw new Error('File is no longer available.');
    return { kind: 'blob', blob: file };
  };
}
