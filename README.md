# react-docscope

**Universal, read-only document preview for React.** One component previews PDF, images,
Word, PowerPoint, Excel, CSV, Markdown, plain text, JSON, XML and video — with search,
zoom, attachment navigation, metadata, downloads and split-screen comparison.

- **11 formats, one interface** — capability-driven toolbar (no video controls on PDFs).
- **You own storage** — a tiny resolver contract; S3 / GCS / VAST / your API stay in your app.
- **Signed URLs that expire** are re-resolved automatically; secrets never reach logs.
- **Fast with big files** — lazy renderers, PDF and Excel parsing in Web Workers, visible-page rendering, virtualized
  grids, lists and trees, bounded caches, request cancellation.
- **Translated** — every UI string is a label; German, French, Spanish and Hindi packs included.
- **Accessible** — keyboard shortcuts, focus-trapped modal, ARIA grid/tree/listbox, axe-tested.
- **Zero app-wide setup** — no Tailwind, Redux or UI kit; scoped CSS + variables, light/dark/system.
- **React 18 and 19**, ESM, TypeScript strict types, MIT.

```bash
npm install react-docscope
```

**Live demo:** [busetti.github.io/react-docscope](https://busetti.github.io/react-docscope/) ·
**Storybook:** [/storybook](https://busetti.github.io/react-docscope/storybook/)

---

## Quick start

```tsx
import { DocumentPreviewer, type DocumentResolver, type PreviewDocument } from 'react-docscope';
import 'react-docscope/styles.css';

const attachments: PreviewDocument[] = [
  { id: 'a1', name: 'Q3-report.pdf', metadata: { size: 182_331, uploadedBy: 'Finance' } },
  { id: 'a2', name: 'budget.xlsx' },
  { id: 'a3', name: 'architecture.pptx' },
];

// Your backend returns a short-lived URL (S3, GCS, VAST, …). The library never talks to storage.
const resolveDocument: DocumentResolver = async (doc, { signal, purpose }) => {
  const res = await fetch(`/api/files/${doc.id}/url?purpose=${purpose}`, { signal });
  return { kind: 'url', url: (await res.json()).url };
};

export function Attachments() {
  return <DocumentPreviewer documents={attachments} resolver={resolveDocument} />;
}
```

### Open a modal from an existing attachment list

```tsx
import { useDocumentPreview } from 'react-docscope';

function AttachmentList({ attachments }: { attachments: PreviewDocument[] }) {
  const { open, compare, PreviewPortal } = useDocumentPreview({
    documents: attachments,
    resolver: resolveDocument,
  });
  return (
    <>
      {attachments.map((a) => (
        <button key={a.id} onClick={() => open(a.id)}>
          {a.name}
        </button>
      ))}
      <button onClick={() => compare(attachments[0].id, attachments[1].id)}>Compare</button>
      <PreviewPortal />
    </>
  );
}
```

`PreviewPortal` has a stable identity; `documents`, `resolver` and `config` can change on every
render without remounting the modal.

---

## Supported formats

| Format     | Extensions                                | Engine                         | Search               | Highlights        | Zoom / fit      | Pages / thumbnails | Notes                                                                                  |
| ---------- | ----------------------------------------- | ------------------------------ | -------------------- | ----------------- | --------------- | ------------------ | -------------------------------------------------------------------------------------- |
| PDF        | `pdf`                                     | pdf.js 6 (worker)              | ✅ text layer        | ✅ glyph-accurate | ✅ width / page | ✅ / ✅            | continuous or single page, rotation, selectable text, range streaming, password prompt |
| Images     | jpg, jpeg, png, gif, webp, svg, avif, bmp | browser                        | —                    | —                 | ✅ fit / 1:1    | —                  | rotate, pan by drag, ctrl/⌘+wheel zoom; SVG scripts never run                          |
| Word       | `docx`                                    | docx-preview                   | ✅                   | ✅                | ✅ width        | —                  | headers, footers, tables, images, lists                                                |
| PowerPoint | `pptx`                                    | pptxtojson + DocScope renderer | ✅                   | ✅                | ✅ width / page | ✅ / ✅            | **best effort**; charts as SVG; PDF fallback supported                                 |
| Excel      | `xlsx`, `xlsm`                            | DocScope reader (Web Worker)   | ✅ cells             | ✅                | ✅              | sheet tabs         | cached formula results, number formats, fonts, fills, borders, merges; **no editing**  |
| CSV / TSV  | csv, tsv                                  | Papa Parse (streaming)         | ✅ cells             | ✅                | ✅              | —                  | delimiter + header detection, 2M-row cap                                               |
| Markdown   | md, markdown                              | react-markdown + GFM           | ✅                   | ✅                | ✅              | —                  | raw view; raw HTML and `javascript:` URLs are not rendered                             |
| Text       | txt, log, yaml, …                         | DocScope                       | ✅                   | ✅                | ✅              | —                  | virtualized lines, 12 MB logs stay smooth                                              |
| JSON       | json, geojson, `*+json`                   | DocScope                       | ✅ keys & values     | ✅                | ✅              | —                  | tree / raw, expand-collapse, copy JSON path, syntax colours, invalid-JSON location     |
| XML        | xml, xsd, rss, …                          | browser DOMParser              | ✅ tags, attrs, text | ✅                | ✅              | —                  | tree / raw, attribute inspector, copy node path, no external entities                  |
| Video      | mp4, webm, ogv, mov                       | native `<video>`               | —                    | —                 | —               | —                  | browser controls (seek, volume, fullscreen, PiP); streamed, not downloaded             |

Unknown formats show an "unsupported" state with a download button. You can add renderers for
anything else (see [Custom renderers](#custom-renderers)).

---

## The resolver contract

```ts
type DocumentResolver = (
  document: PreviewDocument,
  context: {
    signal: AbortSignal; // aborted when the user switches/closes — pass it to fetch
    purpose: 'preview' | 'download';
    attempt: number; // 0, then 1+ on retry / expired URL
    reason: 'initial' | 'expired' | 'retry';
  },
) => Promise<
  | {
      kind: 'url';
      url: string;
      headers?: Record<string, string>;
      credentials?: RequestCredentials;
      mimeType?: string;
    }
  | { kind: 'blob'; blob: Blob; mimeType?: string }
>;
```

- **Signed URLs** — return `{ kind: 'url', url }`. If the URL answers **401/403**, the library calls
  the resolver once more with `reason: 'expired'` (configurable via `retryOnAuthError`).
- **Auth headers** — return `headers`; they are sent with `fetch` / pdf.js and never logged.
- **Blobs** — return `{ kind: 'blob', blob }` (e.g. a `File` from `<input type="file">`).
- **No resolver** — `document.url` is used directly.

Error messages surfaced to the UI and to `onError` are scrubbed of URLs and bearer tokens.

---

## Configuration (all optional)

```tsx
<DocumentPreviewer
  documents={docs}
  resolver={resolve}
  config={{
    theme: 'system', // 'light' | 'dark' | 'system'
    width: '100%',
    height: 640, // inline size (number = px)
    modal: { width: 'min(1200px, 94vw)', height: 'min(860px, 92vh)', closeOnBackdrop: true },
    toolbar: true,
    sidebar: 'auto', // true | false | 'auto' (2+ docs)
    search: true,
    download: true,
    compare: true,
    fullscreen: true,
    metadata: true, // true | false | 'open'
    metadataFields: [
      'type',
      'size',
      'uploadedAt',
      'uploadedBy',
      { key: 'department', label: 'Dept' },
    ],
    zoom: { default: 1, min: 0.1, max: 8, step: 0.25, defaultFit: 'width' },
    pdf: { scrollMode: 'continuous', thumbnails: false, overscan: 2 },
    csv: { header: 'auto', delimiter: undefined },
    searchDebounce: 200,
    maxFileSize: 100 * 1024 * 1024,
    retryOnAuthError: true,
    prefetch: 'adjacent', // only small docs with known metadata.size
    prefetchMaxSize: 5 * 1024 * 1024,
    cacheSize: 64 * 1024 * 1024,
    shortcuts: { search: ['mod+k'], rotate: false }, // or `false` to disable all
    workers: true, // parse XLSX off the main thread (automatic fallback)
    labels: { download: 'Save' }, // any UI string — or a locale pack, see below
  }}
/>
```

Full reference: [docs/CONFIGURATION.md](docs/CONFIGURATION.md) · API: [docs/API.md](docs/API.md)

### Keyboard shortcuts

| Action                                   | Default                                                  |
| ---------------------------------------- | -------------------------------------------------------- |
| Search / next / previous match           | `Ctrl/⌘ F` · `Enter` / `F3` · `Shift+Enter` / `Shift+F3` |
| Zoom in / out / reset                    | `+` / `-` / `0` (also with `Ctrl/⌘`)                     |
| Next / previous page                     | `PageDown` / `PageUp`                                    |
| Next / previous document                 | `Alt →` / `Alt ←`, `]` / `[`                             |
| Rotate · Fullscreen · Download · Sidebar | `R` · `F` · `Ctrl/⌘ S` · `Ctrl/⌘ B`                      |
| Close modal / search                     | `Esc`                                                    |

Single-key shortcuts never fire while typing in an input.

### Callbacks & extensibility

```tsx
<DocumentPreviewer
  documents={docs}
  onDocumentChange={(doc, index) => track('view', doc.id)}
  onError={(error, doc) => report(error.code, doc.id)} // error.message is URL-free
  onLoad={(doc) => {}}
  onDownload={async (doc, { defaultDownload }) => {
    if (!(await confirmPolicy(doc))) return false;
    await defaultDownload();
  }}
  toolbarActions={[
    { id: 'share', label: 'Share', icon: <Share2 />, onClick: ({ document }) => share(document) },
  ]}
  renderMetadata={({ document, fields }) => <MyDetails doc={document} fields={fields} />}
/>
```

`PreviewModal` adds `open`, `onOpenChange`, `onOpen`, `onClose`. `DocumentProvider` shares a
resolver, config, custom renderers and a bounded cache between several previewers.

### Custom renderers

```tsx
import { defineRenderer, type RendererProps } from 'react-docscope';

const dwg = defineRenderer({
  id: 'dwg',
  label: 'AutoCAD drawing',
  mimeTypes: ['image/vnd.dwg'],
  extensions: ['dwg'],
  capabilities: { zoom: true, search: false },
  loadingStrategy: 'arrayBuffer', // 'url' | 'blob' | 'arrayBuffer' | 'text'
  load: () => import('./DwgRenderer'), // code-split
});

<DocumentPreviewer documents={docs} renderers={[dwg]} />;
```

A renderer receives `{ document, source, view, search, host, config, signal }` and reports back
through `host` (`setReady`, `setError`, `setPageCount`, `setSearchResults`, …). Registering an
existing id (e.g. `'pptx'`) replaces the built-in renderer.

### Theming

Every colour, radius and font is a CSS variable on `.dsc-root`:

```css
.dsc-root {
  --dsc-accent: #7c3aed;
  --dsc-radius: 4px;
  --dsc-font: 'Inter', sans-serif;
}
.dsc-root[data-dsc-theme='dark'] {
  --dsc-bg: #0b0b10;
}
```

---

## Translations

Every visible string and ARIA label comes from `config.labels`. Ready-made packs for German,
French, Spanish and Hindi ship in a separate entry point (not part of the main bundle):

```tsx
import { de } from 'react-docscope/locales';

<DocumentPreviewer config={{ labels: de }} … />
// tweak single strings
<DocumentPreviewer config={{ labels: { ...de, download: 'Speichern' } }} … />
```

Labels may contain placeholders such as `Page {page} of {count}`; keep them when translating.
Locale packs also replace the detailed (English) error messages via `labels.errorMessages`.
New languages are welcome — copy `src/locales/de.ts`; the test suite checks every key and placeholder.

---

## PDF worker & bundlers

PDF rendering uses pdf.js in a **Web Worker**. By default the worker code ships in a lazily loaded
chunk and starts from a `blob:` URL, so it works with **Vite, webpack, Rspack, Next.js and Parcel
without configuration**, in dev and production. If your Content-Security-Policy disallows
`worker-src blob:`, host the worker yourself:

```tsx
config={{ pdf: { workerSrc: '/pdf.worker.min.mjs' } }} // copy from pdfjs-dist/build/
```

Optional pdf.js assets for exotic PDFs: `pdf.cMapUrl` (CJK fonts), `pdf.standardFontDataUrl`,
`pdf.wasmUrl` (JPEG 2000 / JBIG2).

Encrypted PDFs show an accessible password prompt; the password is handed to pdf.js only and
never logged or stored. Dismissing it reports `PASSWORD_REQUIRED`.

Excel workbooks are parsed in an inline Web Worker too (same `blob:` mechanism, no setup). If a
worker cannot start, parsing silently falls back to the main thread; `workers: false` forces that.

---

## Performance

Measured on the large fixtures in a headless Chromium (see [docs/PERFORMANCE.md](docs/PERFORMANCE.md)):

| Document                  | Ready  | Search      | DOM nodes |
| ------------------------- | ------ | ----------- | --------- |
| PDF, 400 pages            | ~1.4 s | progressive | ~580      |
| CSV, 200 000 rows (13 MB) | ~0.8 s | ~1.0 s      | ~670      |
| XLSX, 20 000 × 12 cells   | ~1.6 s | ~0.5 s      | ~1 000    |

With the default Web Worker the XLSX parse leaves the main thread: the longest UI block while
opening that workbook drops from ~840 ms to ~110 ms.
| Text, 200 000 lines (12 MB) | ~0.5 s | ~0.6 s | ~610 |
| JSON, 20 000 objects | ~0.7 s | ~0.6 s | ~740 |
| XML, 20 000 elements | ~1.3 s | ~0.5 s | ~940 |

Initial JS for an app using the previewer is ~139 kB gzip including React; every renderer and its
dependencies load on demand.

## Security

- No raw HTML from Markdown, no `javascript:`/`data:` links, SVG shown via `<img>` (scripts never run).
- PPTX text is sanitized with an allow-list; DOCX alt-chunks (embedded HTML) are disabled and links are
  neutralised; XML is parsed without external entities; XLSX is parsed as data only.
- Signed URLs and authorization headers never appear in errors or logs.

## Known limitations

- **PPTX** is best effort: text, shapes, images, tables, groups and charts (bar/column, line,
  area, pie/doughnut, scatter, radar — drawn from cached values) render; other chart types,
  SmartArt styling, animations, embedded media and some effects do not. Provide `document.fallback`
  (e.g. a server-side PDF export) and the previewer uses it automatically when the original
  cannot be rendered — users can toggle between both.
- **XLSX** shows cached formula results (no recalculation), no charts/images/conditional formatting,
  no freeze panes; fractions in number formats fall back to General.
- **DOCX** fidelity depends on docx-preview (complex floating layouts, fields and some numbering).
- **Legacy formats** (`.doc`, `.xls`, `.ppt`) and DRM-protected files are not supported.
- DOCX/PPTX/Text are parsed on the main thread (CSV streams in small chunks; XLSX uses a worker);
  very large workbooks (> ~1M cells) take a few seconds.
- Video playback depends on the browser's codecs.

## Browser support

Current Chrome, Edge, Firefox and Safari (last 2 versions). Search highlighting in DOM-based
renderers uses the CSS Custom Highlight API (Chrome 105+, Safari 17.2+, Firefox 140+); older
browsers still count and scroll to matches.

---

## Repository

```text
packages/react-docscope   the library
apps/playground           interactive demo app (consumes the built package)
apps/docs                 Storybook
tests/                    fixtures, integration, e2e (Playwright), performance
```

```bash
pnpm install
pnpm dev            # library watch + playground at http://localhost:5173
pnpm test           # Jest (unit + integration)
pnpm test:coverage  # with thresholds (≥95% statements, ≥90% branches)
pnpm test:e2e       # Playwright (builds first)
pnpm storybook
pnpm build:pages    # static demo site (playground + Storybook) into ./site
```

See [CONTRIBUTING.md](CONTRIBUTING.md), [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and
[docs/RELEASING.md](docs/RELEASING.md). New here? Start with the [project guide](docs/GUIDE.md):
what was built, Storybook, npm publishing and the change → release workflow.

## License

[MIT](LICENSE) © 2026 Gurunath Busetti. Third-party licenses: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
