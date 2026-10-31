import {
  collectTextNodes,
  findDomMatches,
  highlightDom,
  scrollRangeIntoView,
  searchHighlighter,
  supportsHighlightApi,
  wrapRanges,
} from '../highlight';
import { isSafeHref, neutralizeLinks, sanitizeHtml, sanitizeStyle } from '../sanitize';

function el(html: string): HTMLElement {
  const d = document.createElement('div');
  d.innerHTML = html;
  document.body.appendChild(d);
  return d;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('DOM search', () => {
  it('collects text nodes, skipping scripts and ignored regions', () => {
    const root = el('<p>One <b>two</b></p><script>var x</script><div data-dsc-search-ignore>skip</div><style>p{}</style>');
    expect(collectTextNodes(root).map((n) => n.nodeValue)).toEqual(['One ', 'two']);
  });

  it('finds matches spanning several text nodes', () => {
    const root = el('<p>inv<b>oice</b> and invoice</p>');
    const ranges = findDomMatches(root, 'invoice');
    expect(ranges).toHaveLength(2);
    expect(ranges[0]!.toString()).toBe('invoice');
    expect(ranges[1]!.toString()).toBe('invoice');
    expect(findDomMatches(root, '')).toEqual([]);
    expect(findDomMatches(root, 'INVOICE', true)).toEqual([]);
  });

  it('wraps and restores marks (fallback path)', () => {
    const root = el('<p>alpha <i>beta</i> alpha</p>');
    const before = root.innerHTML;
    const ranges = findDomMatches(root, 'alpha');
    const restore = wrapRanges(ranges, 1);
    expect(root.querySelectorAll('mark.dsc-mark')).toHaveLength(2);
    expect(root.querySelector('.dsc-mark--active')?.textContent).toBe('alpha');
    restore();
    expect(root.innerHTML).toBe(before);
  });

  it('wraps multi-node ranges', () => {
    const root = el('<p>ab<b>cd</b><i>ef</i>gh</p>');
    const restore = wrapRanges(findDomMatches(root, 'bcdefg'), 0);
    expect(Array.from(root.querySelectorAll('mark')).map((m) => m.textContent).join('')).toBe('bcdefg');
    restore();
    expect(root.textContent).toBe('abcdefgh');
  });

  it('highlightDom falls back to marks only when mutation is allowed', () => {
    expect(supportsHighlightApi()).toBe(false);
    const root = el('<p>x needle y needle</p>');
    const owner = {};
    const a = highlightDom(owner, root, 'needle', false, 0, { allowMutation: false });
    expect(a.count).toBe(2);
    expect(root.querySelector('mark')).toBeNull();
    a.cleanup();
    const b = highlightDom(owner, root, 'needle', false, 1, { allowMutation: true });
    expect(root.querySelectorAll('mark')).toHaveLength(2);
    b.cleanup();
    expect(root.querySelector('mark')).toBeNull();
    const none = highlightDom(owner, root, 'zzz', false, 0, { allowMutation: true });
    expect(none.count).toBe(0);
    none.cleanup();
  });

  it('uses the CSS Custom Highlight API when available', () => {
    const registry = new Map<string, { ranges: Range[] }>();
    class FakeHighlight {
      ranges: Range[] = [];
      add(r: Range) {
        this.ranges.push(r);
      }
    }
    const g = globalThis as Record<string, unknown>;
    const prevCss = g.CSS;
    g.CSS = { highlights: registry };
    g.Highlight = FakeHighlight;
    try {
      expect(supportsHighlightApi()).toBe(true);
      const root = el('<p>cat cat cat</p>');
      const owner = {};
      const res = highlightDom(owner, root, 'cat', false, 1, { allowMutation: true, scrollContainer: root });
      expect(res.count).toBe(3);
      expect(root.querySelector('mark')).toBeNull(); // DOM untouched
      expect(registry.get('dsc-search')!.ranges).toHaveLength(2);
      expect(registry.get('dsc-search-active')!.ranges).toHaveLength(1);
      const other = {};
      searchHighlighter.set(other, findDomMatches(root, 'cat'), 0);
      expect(registry.get('dsc-search')!.ranges).toHaveLength(4);
      res.cleanup();
      searchHighlighter.clear(other);
      searchHighlighter.clear(other); // no-op
      expect(registry.get('dsc-search')!.ranges).toHaveLength(0);
    } finally {
      g.CSS = prevCss;
      delete g.Highlight;
    }
  });

  it('scrolls ranges into view', () => {
    const root = el('<p>hello</p>');
    const range = document.createRange();
    range.selectNodeContents(root.firstChild!);
    const spy = jest.spyOn(Element.prototype, 'scrollIntoView');
    scrollRangeIntoView(range, null);
    expect(spy).toHaveBeenCalled();
    (range as unknown as { getBoundingClientRect: () => DOMRect }).getBoundingClientRect = () =>
      ({ top: 500, left: 900, right: 950, width: 50, height: 10 }) as DOMRect;
    const container = document.createElement('div');
    container.getBoundingClientRect = () => ({ top: 0, left: 0, right: 400 }) as DOMRect;
    Object.defineProperty(container, 'clientHeight', { value: 200 });
    Object.defineProperty(container, 'clientWidth', { value: 300 });
    scrollRangeIntoView(range, container);
    expect(container.scrollTop).toBe(405);
    expect(container.scrollLeft).toBe(800);
    spy.mockRestore();
  });
});

describe('sanitizeHtml', () => {
  it('removes scripts, handlers and dangerous urls', () => {
    const dirty =
      '<p style="color:red;background:url(x)" onclick="evil()">Hi <script>alert(1)</script><a href="javascript:alert(1)">bad</a>' +
      '<a href="https://ok.example">ok</a><img src=x onerror=alert(1)><iframe src="//x"></iframe><custom>kept</custom></p>' +
      '<td colspan="2" rowspan="x">c</td><!-- comment -->';
    const clean = sanitizeHtml(dirty);
    expect(clean).not.toMatch(/script|onclick|javascript|iframe|onerror|<img|url\(/i);
    expect(clean).toContain('style="color:red"');
    expect(clean).toContain('href="https://ok.example"');
    expect(clean).toContain('rel="noopener noreferrer nofollow"');
    expect(clean).toContain('kept');
    expect(sanitizeHtml('')).toBe('');
    expect(sanitizeHtml('<p style="url(x)">a</p>')).toBe('<p>a</p>');
  });

  it('filters styles and hrefs', () => {
    expect(sanitizeStyle('color: red; position: fixed; width: 10px; bogus')).toBe('color: red; width: 10px');
    expect(isSafeHref(' HTTPS://a')).toBe(true);
    expect(isSafeHref('mailto:a@b')).toBe(true);
    expect(isSafeHref('#x')).toBe(true);
    expect(isSafeHref('data:text/html,x')).toBe(false);
  });

  it('neutralises links in renderer-owned DOM', () => {
    const root = el('<a href="javascript:x">a</a><a href="https://e.com">b</a><a href="#top">c</a><span onmouseover="x">d</span><script></script>');
    neutralizeLinks(root);
    const links = root.querySelectorAll('a');
    expect(links[0]!.hasAttribute('href')).toBe(false);
    expect(links[1]!.getAttribute('target')).toBe('_blank');
    expect(links[2]!.hasAttribute('target')).toBe(false);
    expect(root.querySelector('span')!.hasAttribute('onmouseover')).toBe(false);
    expect(root.querySelector('script')).toBeNull();
  });
});
