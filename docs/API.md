# API reference

All exports come from `react-docscope`. Styles: `import 'react-docscope/styles.css'` (once).
Translations: `import { de, es, fr, hi, en } from 'react-docscope/locales'` (each a complete `PreviewLabels`).

## Components

### `<DocumentPreviewer>`

Inline previewer rendered inside your layout. Forward a ref to get a `DocumentPreviewerHandle`.

| Prop                               | Type                                        | Description                                                                  |
| ---------------------------------- | ------------------------------------------- | ---------------------------------------------------------------------------- |
| `documents`                        | `PreviewDocument[]`                         | Documents to preview. 2+ enables attachment navigation, sidebar and compare. |
| `document`                         | `PreviewDocument`                           | Shorthand for a single document.                                             |
| `activeDocumentId`                 | `string`                                    | Controlled active document.                                                  |
| `defaultDocumentId`                | `string`                                    | Initial active document (uncontrolled).                                      |
| `resolver`                         | `DocumentResolver`                          | Consumer-owned acquisition. Defaults to `document.url`.                      |
| `config`                           | `PreviewConfig`                             | See [CONFIGURATION.md](CONFIGURATION.md).                                    |
| `renderers`                        | `RendererDefinition[]`                      | Extra / replacement renderers.                                               |
| `toolbarActions`                   | `ToolbarAction[]`                           | Custom toolbar buttons.                                                      |
| `renderMetadata`                   | `(ctx: MetadataRenderContext) => ReactNode` | Replace the details panel body.                                              |
| `defaultCompare`                   | `[string, string]`                          | Start in compare mode.                                                       |
| `onCompareChange`                  | `(pair \| null) => void`                    | Compare mode entered / changed / exited.                                     |
| `onDocumentChange`                 | `(doc, index) => void`                      | Active document changed (not fired on mount).                                |
| `onLoad`                           | `(doc) => void`                             | A document finished rendering.                                               |
| `onError`                          | `(error: PreviewError, doc) => void`        | Any failure (resolve, fetch, render, download).                              |
| `onDownload`                       | `DownloadHandler`                           | Override downloads; return `false` to cancel.                                |
| `className`, `style`, `aria-label` |                                             | Root element.                                                                |

`DocumentPreviewerHandle`: `select(id)`, `compare(leftId, rightId)`, `exitCompare()`, `handleEscape(): boolean`.

### `<PreviewModal>`

Everything `DocumentPreviewer` accepts, plus:

| Prop                | Type                      | Description                              |
| ------------------- | ------------------------- | ---------------------------------------- |
| `open`              | `boolean`                 | Controlled visibility.                   |
| `onOpenChange`      | `(open: boolean) => void` | Escape, close button, backdrop.          |
| `onOpen`, `onClose` | `() => void`              | Lifecycle callbacks.                     |
| `description`       | `string`                  | Accessible description.                  |
| `container`         | `HTMLElement \| null`     | Portal target (default `document.body`). |

Focus moves into the dialog on open, is trapped while open and returns to the triggering element
on close. `Esc` first closes the search bar, then the dialog; it never closes while in fullscreen.

### `<DocumentProvider>`

Shares `resolver`, `config` and `renderers` with every previewer below it, plus one bounded
memory cache (`config.cacheSize`). Component-level props are merged on top.

## Hooks

### `useDocumentPreview(options)`

`options`: everything `PreviewModal` accepts except `open`/`onOpenChange`/`activeDocumentId`/
`defaultDocumentId`/`defaultCompare`/`document`, plus the required `documents`.

Returns:

| Field            | Type                            |                                      |
| ---------------- | ------------------------------- | ------------------------------------ |
| `open(id?)`      | `(documentId?: string) => void` | Open at a document (default: first). |
| `close()`        | `() => void`                    |                                      |
| `compare(a, b)`  | `(leftId, rightId) => void`     | Open in compare mode.                |
| `isOpen`         | `boolean`                       |                                      |
| `activeDocument` | `PreviewDocument \| null`       |                                      |
| `PreviewPortal`  | `ComponentType`                 | Render once. Stable identity.        |

## Types

```ts
interface PreviewDocument {
  id: string;
  name: string;
  type?: string; // MIME
  extension?: string; // without dot
  url?: string;
  metadata?: {
    size?: number;
    uploadedAt?: string;
    uploadedBy?: string;
    description?: string;
    [key: string]: unknown;
  };
  downloadable?: boolean;
  fallback?: Omit<PreviewDocument, 'fallback' | 'id'> & { id?: string }; // e.g. a PDF export of a PPTX
}

type ResolvedDocument =
  | {
      kind: 'url';
      url: string;
      headers?: Record<string, string>;
      credentials?: RequestCredentials;
      mimeType?: string;
    }
  | { kind: 'blob'; blob: Blob; mimeType?: string };

type DocumentResolver = (
  document: PreviewDocument,
  context: {
    signal: AbortSignal;
    purpose: 'preview' | 'download';
    attempt: number;
    reason: 'initial' | 'expired' | 'retry';
  },
) => Promise<ResolvedDocument>;

interface PreviewError {
  code:
    | 'RESOLVE_FAILED'
    | 'FETCH_FAILED'
    | 'ACCESS_DENIED'
    | 'NOT_FOUND'
    | 'UNSUPPORTED_FORMAT'
    | 'TOO_LARGE'
    | 'EMPTY_DOCUMENT'
    | 'MALFORMED_DOCUMENT'
    | 'RENDER_FAILED'
    | 'PASSWORD_REQUIRED' // encrypted PDF whose password prompt was dismissed
    | 'DOWNLOAD_FAILED';
  message: string; // safe to display & log — URLs and tokens removed
  documentId?: string;
  status?: number;
}

interface ToolbarAction {
  id: string;
  label: string;
  icon?: ReactNode;
  onClick: (ctx: { document: PreviewDocument; index: number; close: () => void }) => void;
  isVisible?: (document: PreviewDocument) => boolean;
  disabled?: boolean | ((document: PreviewDocument) => boolean);
}

type DownloadHandler = (
  document: PreviewDocument,
  ctx: { defaultDownload: () => Promise<void>; signal: AbortSignal },
) => void | boolean | Promise<void | boolean>;
```

### Renderer extension API

```ts
interface RendererDefinition {
  id: string; // replaces a built-in with the same id
  label: string;
  mimeTypes: string[]; // 'image/*' wildcards allowed
  extensions: string[];
  capabilities: {
    zoom?: boolean;
    fitModes?: ('width' | 'page' | 'original')[];
    rotate?: boolean;
    pan?: boolean;
    pages?: boolean;
    thumbnails?: boolean;
    search?: boolean;
    rawView?: boolean;
    scrollModes?: boolean;
    media?: boolean;
    syncScroll?: boolean;
  };
  loadingStrategy: 'url' | 'blob' | 'arrayBuffer' | 'text';
  load: () => Promise<{ default: ComponentType<RendererProps> }>;
  match?: (document: PreviewDocument) => boolean;
  priority?: number;
  maxFileSize?: number;
  cleanup?: () => void;
}

interface RendererProps {
  document: PreviewDocument;
  source: DocumentSource; // getUrl(), getBlob(), getArrayBuffer(), getText(), getRequest(), mimeType, size
  view: ViewState; // zoom, fitMode, rotation, page, scrollMode, rawView, showThumbnails
  search: { query: string; caseSensitive: boolean; activeIndex: number };
  host: RendererHost; // setReady, setError, setPageCount, setCurrentPage, setSearchResults, setEffectiveZoom, requestZoom
  config: ResolvedPreviewConfig;
  signal: AbortSignal;
}
```

Mark scrollable areas with `data-dsc-scroll-container` to take part in compare-mode scroll sync.

### Utilities

`defineRenderer`, `RendererRegistry`, `createDefaultRegistry`, `builtInRenderers`,
`resolveConfig`, `DEFAULT_CONFIG`, `DEFAULT_LABELS`, `DEFAULT_SHORTCUTS`, `defaultResolver`,
`DocumentPreviewError`, `getExtension`, `getMimeType`, `formatBytes`.

### Labels

`PreviewLabels` holds every UI string and ARIA label; `config.labels` accepts a
`PreviewLabelsInput` (any subset; grouped labels — `errorTitles`, `errorMessages`, `chartTypes`,
`csvDelimiters` — may be partial and are merged one level deep). Placeholders like `{page}` are
filled at render time. `labels.errorMessages[code]`, when set, replaces the detailed message shown
in error states (the `onError` payload keeps the original English message for logging).
