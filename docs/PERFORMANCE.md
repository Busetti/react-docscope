# Performance

Performance is measured, not assumed. Two harnesses live in `tests/performance`:

- `pnpm perf` — bundle report (`bundle-size.mjs`): library output and what a consuming app
  downloads initially vs. lazily. Writes `tests/performance/bundle-size.json`.
- `pnpm perf:render` — Playwright opens each large fixture in Chromium and records time to
  ready, search latency, DOM size and JS heap. Writes `tests/performance/results.json` and fails
  if a document exceeds its budget or renders more than 15 000 DOM nodes.

Large fixtures are generated (not committed) by `pnpm fixtures`.

## Results (2026-10-31, headless Chromium, 2 vCPU container)

| Fixture                        | Size    | Ready | Search (`needle` / `invoice`)    | DOM nodes | Heap  |
| ------------------------------ | ------- | ----- | -------------------------------- | --------- | ----- |
| `large.pdf` — 400 pages        | 1.2 MB  | 1.4 s | first results 0.5 s, progressive | 581       | 17 MB |
| `large.csv` — 200 000 rows × 6 | 13.1 MB | 0.8 s | 1.0 s (162 cells)                | 671       | 98 MB |
| `large.xlsx` — 20 000 × 12     | 1.5 MB  | 1.6 s | 0.5 s                            | 994       | 51 MB |
| `large.txt` — 200 000 lines    | 12.0 MB | 0.5 s | 0.6 s                            | 614       | 45 MB |
| `large.json` — 20 000 objects  | 1.6 MB  | 0.7 s | 0.6 s                            | 735       | 61 MB |
| `large.xml` — 20 000 elements  | 1.6 MB  | 1.3 s | 0.5 s                            | 937       | 30 MB |

## Bundle

|                                                                    | gzip                                                |
| ------------------------------------------------------------------ | --------------------------------------------------- |
| Library core (`index.js`, unminified)                              | 25.6 kB                                             |
| Styles                                                             | 6.6 kB                                              |
| Playground initial JS (React + DocScope core + demo app, minified) | 139 kB                                              |
| Lazy: PDF renderer + pdf.js                                        | 5 kB + 125 kB, worker 367 kB (loaded only for PDFs) |
| Lazy: DOCX renderer + docx-preview                                 | 1.5 kB + 47 kB                                      |
| Lazy: Markdown renderer + unified                                  | 48 kB                                               |
| Lazy: XLSX renderer (own reader)                                   | 11 kB                                               |
| Lazy: PPTX renderer + pptxtojson                                   | 3 kB + 116 kB                                       |

## Techniques

1. **Lazy renderer modules** — every renderer (and its dependencies) is a separate dynamic import.
2. **PDF worker** — parsing and rasterisation run in a Web Worker.
3. **Visible-page rendering** — only pages in view ± `pdf.overscan` mount; others are placeholders
   sized from page geometry. Page canvases are released when scrolled away; canvas size is capped.
4. **Virtualization** — TanStack Virtual for text lines, JSON/XML trees, the attachment list,
   thumbnails and the 2-D XLSX/CSV grid (rows and columns, with sticky headers and merged cells).
5. **Debounced search** (`searchDebounce`), renderer-side matching, PDF text extraction cached per page
   and done progressively.
6. **Text & byte caching** — LRU caches bounded by `cacheSize`; switching back to a document does not
   re-download it. Retry bypasses the cache.
7. **Request cancellation** — each load has an `AbortController`; switching aborts resolver, fetch and
   pdf.js loading tasks.
8. **Cleanup** — `blob:` URLs revoked, video sources released, pdf.js tasks destroyed, renderer
   `cleanup()` hooks run.
9. **Independent compare panes** — two controllers; no shared re-render path.
10. **Re-render hygiene** — structurally-stable config, memoized panes/toolbars, per-generation hosts.
11. **Adjacent prefetch** only for small documents with known size, in idle time, never on Save-Data;
    never downloads all attachments.
12. **XLSX string scanning** instead of DOMParser for worksheet XML (5.5 s → 1.6 s on 240k cells).
