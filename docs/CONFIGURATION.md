# Configuration reference

`PreviewConfig` is accepted by `DocumentPreviewer`, `PreviewModal`, `useDocumentPreview` and
`DocumentProvider` (provider config is merged first; component config wins). Every option is
optional; invalid values fall back to the default rather than breaking rendering. Inline config
objects are compared structurally, so passing a new object each render does not re-render.

| Option                                                    | Type                                        | Default                                                   | Notes                                                                                                                     |
| --------------------------------------------------------- | ------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `theme`                                                   | `'light' \| 'dark' \| 'system'`             | `'system'`                                                | `system` follows `prefers-color-scheme` live.                                                                             |
| `className`                                               | `string`                                    | —                                                         | Added to the root.                                                                                                        |
| `width`                                                   | `number \| string`                          | `'100%'`                                                  | Inline mode only. Numbers are px.                                                                                         |
| `height`                                                  | `number \| string`                          | `600`                                                     | Inline mode only. `'100%'` needs a parent with a definite height, or the viewer grows to the full document.               |
| `modal.width`                                             | `number \| string`                          | `'min(1200px, 94vw)'`                                     | Full-screen below 640 px viewports.                                                                                       |
| `modal.height`                                            | `number \| string`                          | `'min(860px, 92vh)'`                                      |                                                                                                                           |
| `modal.closeOnBackdrop`                                   | `boolean`                                   | `true`                                                    |                                                                                                                           |
| `toolbar`                                                 | `boolean`                                   | `true`                                                    |                                                                                                                           |
| `sidebar`                                                 | `boolean \| 'auto'`                         | `'auto'`                                                  | `auto` = open for 2+ documents; `false` starts closed (users can still open it). Overlays content when narrow.            |
| `search`                                                  | `boolean`                                   | `true`                                                    |                                                                                                                           |
| `download`                                                | `boolean`                                   | `true`                                                    | Per document: `downloadable: false`.                                                                                      |
| `compare`                                                 | `boolean`                                   | `true`                                                    | Needs 2+ documents.                                                                                                       |
| `fullscreen`                                              | `boolean`                                   | `true`                                                    | Hidden when the Fullscreen API is unavailable.                                                                            |
| `metadata`                                                | `boolean \| 'open'`                         | `true`                                                    | Details panel toggle (`'open'` = open initially).                                                                         |
| `metadataFields`                                          | `Array<string \| { key, label?, format? }>` | `['type','size','uploadedAt','uploadedBy','description']` | `type`/`name` are computed; others read `document.metadata[key]`. Dates (`*At`, `*Date`, `*On`) and `size` are formatted. |
| `zoom.default`                                            | `number`                                    | `1`                                                       | Used when the format has no fit mode.                                                                                     |
| `zoom.min` / `zoom.max`                                   | `number`                                    | `0.1` / `8`                                               |                                                                                                                           |
| `zoom.step`                                               | `number`                                    | `0.25`                                                    | Toolbar / keyboard increment.                                                                                             |
| `zoom.defaultFit`                                         | `'width' \| 'page' \| 'none' \| 'original'` | `'width'`                                                 | Falls back to the renderer's first fit mode.                                                                              |
| `pdf.scrollMode`                                          | `'continuous' \| 'single'`                  | `'continuous'`                                            |                                                                                                                           |
| `pdf.thumbnails`                                          | `boolean`                                   | `false`                                                   | Open the thumbnail rail initially.                                                                                        |
| `pdf.overscan`                                            | `number`                                    | `2`                                                       | Pages rendered beyond the viewport.                                                                                       |
| `pdf.workerSrc`                                           | `string`                                    | —                                                         | Hosted worker URL (strict CSP). Default: bundled worker via `blob:`.                                                      |
| `pdf.cMapUrl` / `pdf.standardFontDataUrl` / `pdf.wasmUrl` | `string`                                    | —                                                         | Optional pdf.js assets.                                                                                                   |
| `csv.header`                                              | `boolean \| 'auto'`                         | `'auto'`                                                  | Users can toggle in the status bar.                                                                                       |
| `csv.delimiter`                                           | `string`                                    | auto                                                      | `.tsv` ⇒ tab.                                                                                                             |
| `searchDebounce`                                          | `number` (ms)                               | `200`                                                     |                                                                                                                           |
| `maxFileSize`                                             | `number` (bytes)                            | `100 MB`                                                  | For fully-downloaded formats. PDF/video stream.                                                                           |
| `retryOnAuthError`                                        | `boolean`                                   | `true`                                                    | Re-resolve once on 401/403 (expired signed URL).                                                                          |
| `prefetch`                                                | `'none' \| 'adjacent'`                      | `'adjacent'`                                              | Only neighbours with known `metadata.size ≤ prefetchMaxSize`, in idle time, never on Save-Data.                           |
| `prefetchMaxSize`                                         | `number`                                    | `5 MB`                                                    |                                                                                                                           |
| `cacheSize`                                               | `number`                                    | `64 MB`                                                   | LRU budget for downloaded bytes (text cache = ¼).                                                                         |
| `shortcuts`                                               | `ShortcutMap \| false`                      | see below                                                 | Per-action combos (`'mod+f'`, `'alt+ArrowRight'`, `'+'`), `false` per action or globally.                                 |
| `workers`                                                 | `boolean`                                   | `true`                                                    | Parse XLSX in an inline Web Worker; falls back to the main thread automatically.                                          |
| `labels`                                                  | `PreviewLabelsInput`                        | English                                                   | All UI strings. Locale packs: `react-docscope/locales` (`de`, `es`, `fr`, `hi`). See [API.md](API.md#labels).             |

## Shortcuts

```ts
{
  search: ['mod+f'], nextMatch: ['F3'], prevMatch: ['shift+F3'],
  zoomIn: ['mod+=', 'mod++', '+', '='], zoomOut: ['mod+-', '-'], resetZoom: ['mod+0', '0'],
  nextPage: ['PageDown'], prevPage: ['PageUp'],
  nextDocument: ['alt+ArrowRight', ']'], prevDocument: ['alt+ArrowLeft', '['],
  rotate: ['r'], fullscreen: ['f'], download: ['mod+s'], toggleSidebar: ['mod+b'],
}
```

`mod` is ⌘ on Apple platforms and Ctrl elsewhere. Shortcuts apply while focus is inside the
previewer (the modal focuses it on open); in compare mode they target the last focused pane.

## CSS variables

Override on `.dsc-root` (and `.dsc-root[data-dsc-theme='dark']` for dark values):

`--dsc-font`, `--dsc-mono`, `--dsc-radius`, `--dsc-radius-sm`, `--dsc-bg`, `--dsc-surface`,
`--dsc-surface-2`, `--dsc-canvas`, `--dsc-border`, `--dsc-border-strong`, `--dsc-text`,
`--dsc-text-muted`, `--dsc-text-faint`, `--dsc-accent`, `--dsc-accent-hover`, `--dsc-accent-soft`,
`--dsc-accent-contrast`, `--dsc-danger`, `--dsc-danger-soft`, `--dsc-warning-soft`, `--dsc-focus`,
`--dsc-shadow`, `--dsc-shadow-lg`, `--dsc-page-shadow`, `--dsc-mark`, `--dsc-mark-active`,
`--dsc-pdf-mark`, `--dsc-pdf-mark-active`, `--dsc-grid-header`, `--dsc-grid-line`, `--dsc-cell-bg`,
`--dsc-overlay`, and syntax colours `--dsc-tok-{key,string,number,boolean,null,punct,tag,attr,comment,meta}`.
