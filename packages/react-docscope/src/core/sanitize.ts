/**
 * Minimal allow-list HTML sanitizer for markup generated from untrusted
 * documents (PPTX text runs). Anything not explicitly allowed is dropped:
 * scripts, event handlers, iframes, forms, `javascript:` URLs and CSS that can
 * load resources or escape its container.
 */

const ALLOWED_TAGS = new Set([
  'P',
  'DIV',
  'SPAN',
  'BR',
  'B',
  'STRONG',
  'I',
  'EM',
  'U',
  'S',
  'STRIKE',
  'DEL',
  'SUB',
  'SUP',
  'UL',
  'OL',
  'LI',
  'A',
  'FONT',
  'SMALL',
  'BIG',
  'CODE',
  'PRE',
  'BLOCKQUOTE',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'TABLE',
  'THEAD',
  'TBODY',
  'TR',
  'TD',
  'TH',
]);

const DROP_WITH_CONTENT = new Set([
  'SCRIPT',
  'STYLE',
  'IFRAME',
  'OBJECT',
  'EMBED',
  'TEMPLATE',
  'NOSCRIPT',
  'SVG',
  'MATH',
]);

const BLOCKED_CSS =
  /url\s*\(|expression\s*\(|javascript:|@import|behavior\s*:|-moz-binding|position\s*:\s*(fixed|sticky)/i;

export function sanitizeStyle(style: string): string {
  return style
    .split(';')
    .map((d) => d.trim())
    .filter((d) => d && d.includes(':') && !BLOCKED_CSS.test(d))
    .join('; ');
}

export function isSafeHref(href: string): boolean {
  const v = href.trim().toLowerCase();
  return /^(https?:|mailto:|#)/.test(v);
}

function cleanNode(node: Node, doc: Document): Node | null {
  if (node.nodeType === Node.TEXT_NODE) return doc.createTextNode(node.nodeValue ?? '');
  if (node.nodeType !== Node.ELEMENT_NODE) return null;
  const el = node as Element;
  const tag = el.tagName.toUpperCase();
  if (DROP_WITH_CONTENT.has(tag)) return null;
  const children = Array.from(el.childNodes)
    .map((c) => cleanNode(c, doc))
    .filter((c): c is Node => c !== null);
  if (!ALLOWED_TAGS.has(tag)) {
    // Unwrap unknown elements but keep their (sanitized) text.
    const frag = doc.createDocumentFragment();
    children.forEach((c) => frag.appendChild(c));
    return frag;
  }
  const out = doc.createElement(tag.toLowerCase());
  const style = el.getAttribute('style');
  if (style) {
    const clean = sanitizeStyle(style);
    if (clean) out.setAttribute('style', clean);
  }
  if (tag === 'A') {
    const href = el.getAttribute('href');
    if (href && isSafeHref(href)) {
      out.setAttribute('href', href);
      out.setAttribute('target', '_blank');
      out.setAttribute('rel', 'noopener noreferrer nofollow');
    }
  }
  for (const attr of ['colspan', 'rowspan']) {
    const v = el.getAttribute(attr);
    if (v && /^\d{1,3}$/.test(v)) out.setAttribute(attr, v);
  }
  children.forEach((c) => out.appendChild(c));
  return out;
}

export function sanitizeHtml(html: string): string {
  if (!html) return '';
  const parsed = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const target = document.implementation.createHTMLDocument('');
  const container = target.createElement('div');
  Array.from(parsed.body.childNodes).forEach((n) => {
    const c = cleanNode(n, target);
    if (c) container.appendChild(c);
  });
  return container.innerHTML;
}

/** Neutralises dangerous links inside renderer-owned DOM (e.g. DOCX output). */
export function neutralizeLinks(root: HTMLElement): void {
  root.querySelectorAll('a[href]').forEach((a) => {
    const href = a.getAttribute('href') ?? '';
    if (!isSafeHref(href)) a.removeAttribute('href');
    else if (!href.startsWith('#')) {
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener noreferrer nofollow');
    }
  });
  root.querySelectorAll('script, iframe, object, embed').forEach((el) => el.remove());
  root.querySelectorAll('*').forEach((el) => {
    for (const attr of Array.from(el.attributes)) {
      if (attr.name.toLowerCase().startsWith('on')) el.removeAttribute(attr.name);
    }
  });
}
