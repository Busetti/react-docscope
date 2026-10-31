# Architecture

## Layers

```text
┌──────────────────────────── Public API ────────────────────────────┐
│ DocumentPreviewer · PreviewModal · useDocumentPreview · Provider    │
├──────────────────────────── Workspace UI ───────────────────────────┤
│ header · capability-driven toolbar · search bar · sidebar · details │
│ CompareView (two independent panes, sync scroll/zoom, splitter)     │
├──────────────────────────── Pane controller ────────────────────────┤
│ usePaneController: resolve → load renderer chunk → fetch → render   │
│ AbortController per load · auth retry · fallback · view & search    │
├──────────────────────────── Core (framework-free) ──────────────────┤
│ resolver contract · ManagedSource · LRU caches · registry · config  │
│ format detection · shortcuts · DOM search & highlights · sanitizer  │
├──────────────────────────── Renderers (lazy chunks) ────────────────┤
│ pdf · image · docx · pptx · markdown · text · video · xlsx · csv ·  │
│ json · xml  — shared: TextLines, TreeView, DataGrid (virtualized)   │
└─────────────────────────────────────────────────────────────────────┘
```

### Data flow for one document

1. `registry.resolve(document)` picks a renderer by custom `match`, MIME (ignoring generic
   `octet-stream`; `text/plain` defers to the extension), extension, then MIME wildcard.
2. In parallel: the renderer chunk is imported (cached per renderer id) and
   `loadDocumentSource` runs the consumer resolver with an `AbortSignal`.
3. For `blob`/`arrayBuffer`/`text` strategies the bytes are fetched eagerly so HTTP errors surface
   before rendering; a 401/403 triggers exactly one re-resolution (`reason: 'expired'`).
   `url` strategies (PDF, video) stream — the renderer reports `ACCESS_DENIED` through the host and
   the controller re-resolves the same way.
4. The renderer mounts behind a skeleton and calls `host.setReady()`. Each load generation gets a
   fresh `host`; calls from stale renderers (after a switch) are ignored.
5. On switch/unmount the load is aborted, `blob:` URLs are revoked, pdf.js tasks destroyed,
   video sources released and `definition.cleanup()` called.

### State ownership

- The workspace owns the active document, panels, compare state and keyboard routing.
- Each pane (single view or either compare side) owns its own controller: zoom, fit, rotation,
  page, raw view, thumbnails, search query/case/active match, download state. Compare panes are
  keyed by _slot_, so "swap" moves panes (and their state) instead of reloading.
- Search is debounced in the controller; renderers own matching and highlighting and report
  counts. The active-match index is reset during render (not in an effect) so renderer effects,
  which run first, can report counts for the new query.

## Dependency evaluation

| Need             | Chosen                                                       | Alternatives considered                                                                                                                                                       | Why                                                                                                                                                                 |
| ---------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PDF              | **pdfjs-dist 6** (Apache-2.0)                                | react-pdf (wrapper over pdf.js)                                                                                                                                               | Direct control over virtualization, text layer and search geometry; no extra layer.                                                                                 |
| DOCX             | **docx-preview 0.4** (Apache-2.0)                            | mammoth (semantic HTML, loses layout)                                                                                                                                         | Better visual fidelity (pages, headers, tables). Alt-chunks/comments disabled for safety.                                                                           |
| PPTX             | **pptxtojson 2.2** (MIT, actively maintained) + own renderer | pptx-preview (ISC; pulls echarts + lodash, opaque output), PPTXjs (jQuery, unmaintained)                                                                                      | Structured JSON lets us render, sanitize and search ourselves. Honest best effort + consumer PDF fallback. Works around an upstream paragraph-spacing bug (tested). |
| XLSX             | **own read-only reader** on fflate (MIT)                     | SheetJS (npm build is stale 0.18.5 with published CVEs; fixed builds only on its CDN), exceljs (pulls Node-only deps: archiver, tmp, unzipper), read-excel-file (values only) | Small, strictly read-only by construction, styles + merges + cached values, string scanner for big sheets (5.5 s → 1.6 s for 240k cells vs. DOMParser).             |
| CSV              | **Papa Parse 5** (MIT)                                       | own parser                                                                                                                                                                    | Battle-tested quoting / delimiter detection, streaming chunks.                                                                                                      |
| Markdown         | **react-markdown 10 + remark-gfm** (MIT)                     | marked + DOMPurify                                                                                                                                                            | Safe by default (no raw HTML), React tree.                                                                                                                          |
| Modal / tooltips | **Radix Dialog / Tooltip** (MIT)                             | own                                                                                                                                                                           | Focus trap, scroll lock, a11y.                                                                                                                                      |
| Virtualization   | **TanStack Virtual 3** (MIT)                                 | react-window                                                                                                                                                                  | Headless, 2-D, dynamic measurement.                                                                                                                                 |
| Icons            | **lucide-react** (ISC)                                       |                                                                                                                                                                               | Tree-shakable.                                                                                                                                                      |

All runtime dependencies are MIT/ISC/Apache-2.0/0BSD (jszip is dual MIT/GPL, used under MIT).
React and React DOM are peer dependencies (`^18.2 || ^19`).

## Packaging

- Vite library mode, ESM only, dependencies external, one chunk per renderer.
- `virtual:pdf-worker-source` embeds the pdf.js worker as a string chunk, started from a `blob:`
  URL — zero bundler config; `pdf.workerSrc` for strict CSPs; main-thread fallback if a worker
  cannot start at all.
- Types emitted with `tsc` (`dist/types`), CSS extracted to `dist/styles.css`
  (`react-docscope/styles.css` export), `sideEffects: ["*.css"]`.

## Technical risks & mitigations

| Risk                                    | Mitigation                                                                                                          |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| PPTX fidelity                           | Best-effort renderer, explicit limitations, `document.fallback`, toggle original/converted.                         |
| Main-thread parsing of big Office files | Lazy per-sheet parsing, string scanning, chunked CSV, size limit, skeleton yields before parsing.                   |
| pdf.js worker across bundlers           | Blob worker by default, explicit `workerSrc`, main-thread fallback; verified by the smoke test in a fresh Vite app. |
| Untrusted document content              | Sanitizer, no raw HTML, link neutralisation, `<img>` for SVG, DOMParser without external entities.                  |
| Secrets in logs                         | Messages scrubbed of URLs/tokens; no console logging of URLs; integration test asserts it.                          |
| Highlights in React-managed DOM         | CSS Custom Highlight API (no DOM mutation); `<mark>` fallback only for renderer-owned DOM.                          |
