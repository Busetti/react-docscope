# react-docscope

## 0.1.0

### Minor Changes

- Initial release: universal read-only previewer for PDF, images, DOCX, PPTX, XLSX, CSV, Markdown,
  TXT, JSON, XML and video with search, zoom, attachments navigation, modal/inline modes,
  consumer-owned resolvers (signed URLs re-resolved automatically on 401/403) and split-screen
  comparison.
- XLSX workbooks are parsed in an inline Web Worker (`workers` option, automatic main-thread fallback).
- Encrypted PDFs show an accessible password prompt; dismissing it reports the `PASSWORD_REQUIRED`
  error code.
- PPTX charts (bar/column, line, area, pie/doughnut, scatter, radar) are drawn as SVG from their
  cached values.
- Every UI string is configurable through `labels`; German, French, Spanish and Hindi packs ship in
  `react-docscope/locales`.
