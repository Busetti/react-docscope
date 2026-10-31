# Third-party notices

`react-docscope` is MIT licensed. It depends on (but does not vendor) the
following runtime packages, all under licenses compatible with MIT
distribution. Versions are ranges from `package.json`; run
`pnpm licenses list --prod` in `packages/react-docscope` for the exact tree.

| Package                                                                                                                                      | License                             | Used for                           |
| -------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- | ---------------------------------- |
| [pdfjs-dist](https://github.com/mozilla/pdf.js)                                                                                              | Apache-2.0                          | PDF parsing, rendering, text layer |
| [docx-preview](https://github.com/VolodymyrBaydalka/docxjs)                                                                                  | Apache-2.0                          | DOCX rendering                     |
| [pptxtojson](https://github.com/pipipi-pikachu/pptxtojson)                                                                                   | MIT                                 | PPTX parsing                       |
| [jszip](https://github.com/Stuk/jszip) (via docx-preview / pptxtojson)                                                                       | MIT or GPL-3.0 (used under **MIT**) | ZIP extraction                     |
| [pako](https://github.com/nodeca/pako) (via jszip)                                                                                           | MIT and Zlib                        | Deflate                            |
| [fflate](https://github.com/101arrowz/fflate)                                                                                                | MIT                                 | XLSX archive extraction            |
| [papaparse](https://github.com/mholt/PapaParse)                                                                                              | MIT                                 | CSV parsing                        |
| [react-markdown](https://github.com/remarkjs/react-markdown), [remark-gfm](https://github.com/remarkjs/remark-gfm) and the unified ecosystem | MIT                                 | Markdown                           |
| [@radix-ui/react-dialog](https://github.com/radix-ui/primitives), [@radix-ui/react-tooltip](https://github.com/radix-ui/primitives)          | MIT                                 | Accessible modal and tooltips      |
| [@tanstack/react-virtual](https://github.com/TanStack/virtual)                                                                               | MIT                                 | Virtualized lists and grids        |
| [lucide-react](https://github.com/lucide-icons/lucide)                                                                                       | ISC                                 | Icons                              |
| tslib                                                                                                                                        | 0BSD                                | Helpers (transitive)               |

## Adapted code

The `.textLayer` rules in `src/styles/docscope.css` are adapted from
`pdfjs-dist/web/pdf_viewer.css` (Copyright Mozilla Foundation, Apache-2.0).

## Distributed worker

The production build embeds the unmodified `pdfjs-dist/build/pdf.worker.min.mjs`
(Apache-2.0, Copyright Mozilla Foundation) as a lazily loaded string chunk so
PDF rendering works without bundler configuration. Its license header is kept.

The Apache License 2.0 text is available at https://www.apache.org/licenses/LICENSE-2.0.
