# Security policy

`react-docscope` renders untrusted documents in the browser. Defences in place:

- Markdown: raw HTML is not rendered; unsafe URL schemes are removed; images limited to http(s)/data:image.
- SVG is displayed through `<img>`, so embedded scripts never execute.
- PPTX text passes an allow-list sanitizer (no scripts, event handlers, `url()` CSS, unsafe links).
- DOCX: embedded HTML (alt-chunks) and comments are disabled; links are neutralised after rendering.
- XML is parsed with `DOMParser` (no external entity or DTD fetching); XLSX is parsed as data only.
- pdf.js runs in a worker with XFA disabled.
- Error messages are scrubbed of URLs and bearer tokens; the library never logs URLs or headers.

## Reporting a vulnerability

Please report privately via GitHub Security Advisories on the repository
(_Security → Report a vulnerability_). You will receive an acknowledgement within 5 working days.
