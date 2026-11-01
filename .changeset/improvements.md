---
'react-docscope': minor
---

- XLSX workbooks are parsed in an inline Web Worker (new `workers` option, automatic main-thread fallback).
- Encrypted PDFs show an accessible password prompt; dismissing it reports the new `PASSWORD_REQUIRED` error code.
- PPTX charts (bar/column, line, area, pie/doughnut, scatter, radar) are drawn as SVG from their cached values.
- Every UI string is configurable through `labels` (with `{placeholders}` and partial grouped overrides); German, French, Spanish and Hindi packs ship in `react-docscope/locales`.
