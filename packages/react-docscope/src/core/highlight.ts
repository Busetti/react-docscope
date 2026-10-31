import { findTextMatches } from './search';

/**
 * DOM search & highlighting shared by DOM-based renderers (Markdown, DOCX,
 * PPTX). Uses the CSS Custom Highlight API where available, which never
 * mutates the DOM (safe for React-managed trees). A `<mark>` wrapping fallback
 * is provided for renderer-owned DOM in older browsers.
 */

const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE']);

export function collectTextNodes(root: Node): Text[] {
  const nodes: Text[] = [];
  const doc = root.ownerDocument ?? (root as Document);
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent || SKIP_TAGS.has(parent.tagName)) return NodeFilter.FILTER_REJECT;
      if (parent.closest('[data-dsc-search-ignore]')) return NodeFilter.FILTER_REJECT;
      return node.nodeValue ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    },
  });
  let n: Node | null;
  while ((n = walker.nextNode())) nodes.push(n as Text);
  return nodes;
}

/** Finds `query` in the text content of `root` and returns one Range per match. */
export function findDomMatches(root: Node, query: string, caseSensitive = false, limit = 5000): Range[] {
  if (!query.trim()) return [];
  const nodes = collectTextNodes(root);
  const offsets: number[] = [];
  let text = '';
  for (const node of nodes) {
    offsets.push(text.length);
    text += node.nodeValue;
  }
  const matches = findTextMatches(text, query, caseSensitive, limit);
  const doc = root.ownerDocument ?? (root as Document);
  const ranges: Range[] = [];
  let ni = 0;
  for (const m of matches) {
    while (ni < nodes.length - 1 && offsets[ni + 1]! <= m.start) ni += 1;
    let endNode = ni;
    while (endNode < nodes.length - 1 && offsets[endNode + 1]! < m.end) endNode += 1;
    const range = doc.createRange();
    range.setStart(nodes[ni]!, m.start - offsets[ni]!);
    range.setEnd(nodes[endNode]!, m.end - offsets[endNode]!);
    ranges.push(range);
  }
  return ranges;
}

interface HighlightLike {
  add(range: AbstractRange): void;
}
interface HighlightRegistryLike {
  set(name: string, highlight: unknown): void;
  delete(name: string): void;
}

function getHighlightRegistry(): HighlightRegistryLike | null {
  const css = (globalThis as { CSS?: { highlights?: HighlightRegistryLike } }).CSS;
  const Ctor = (globalThis as { Highlight?: new (...r: AbstractRange[]) => HighlightLike }).Highlight;
  return css?.highlights && Ctor ? css.highlights : null;
}

export function supportsHighlightApi(): boolean {
  return getHighlightRegistry() !== null;
}

/**
 * Highlights are global per document, so several panes (compare mode) share
 * two named highlights. Each owner contributes its own ranges.
 */
class SearchHighlighter {
  private owners = new Map<object, { ranges: Range[]; active: Range | null }>();

  set(owner: object, ranges: Range[], activeIndex: number): void {
    this.owners.set(owner, { ranges, active: ranges[activeIndex] ?? null });
    this.apply();
  }

  clear(owner: object): void {
    if (this.owners.delete(owner)) this.apply();
  }

  private apply(): void {
    const registry = getHighlightRegistry();
    if (!registry) return;
    const Ctor = (globalThis as unknown as { Highlight: new (...r: AbstractRange[]) => HighlightLike }).Highlight;
    const all = new Ctor();
    const active = new Ctor();
    for (const { ranges, active: a } of this.owners.values()) {
      for (const r of ranges) if (r !== a) all.add(r);
      if (a) active.add(a);
    }
    registry.set('dsc-search', all);
    registry.set('dsc-search-active', active);
  }
}

export const searchHighlighter = new SearchHighlighter();

/** Fallback: wraps each range in `<mark>`. Returns a function restoring the DOM. */
export function wrapRanges(ranges: Range[], activeIndex: number): () => void {
  const marks: HTMLElement[] = [];
  // Wrap from last to first so earlier ranges stay valid.
  for (let i = ranges.length - 1; i >= 0; i -= 1) {
    const range = ranges[i]!;
    const doc = range.startContainer.ownerDocument!;
    const textNodes = textNodesInRange(range);
    textNodes.forEach(({ node, start, end }) => {
      const target = splitText(node, start, end);
      const mark = doc.createElement('mark');
      mark.className = i === activeIndex ? 'dsc-mark dsc-mark--active' : 'dsc-mark';
      mark.dataset.dscMatch = String(i);
      target.parentNode!.replaceChild(mark, target);
      mark.appendChild(target);
      marks.push(mark);
    });
  }
  return () => {
    const parents = new Set<Node>();
    for (const mark of marks) {
      const parent = mark.parentNode;
      if (!parent) continue;
      while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
      parent.removeChild(mark);
      parents.add(parent);
    }
    parents.forEach((p) => p.normalize());
  };
}

function textNodesInRange(range: Range): Array<{ node: Text; start: number; end: number }> {
  const out: Array<{ node: Text; start: number; end: number }> = [];
  const start = range.startContainer as Text;
  const end = range.endContainer as Text;
  if (start === end) return [{ node: start, start: range.startOffset, end: range.endOffset }];
  const root = range.commonAncestorContainer;
  const nodes = collectTextNodes(root);
  let inside = false;
  for (const n of nodes) {
    if (n === start) {
      inside = true;
      out.push({ node: n, start: range.startOffset, end: n.length });
    } else if (n === end) {
      out.push({ node: n, start: 0, end: range.endOffset });
      break;
    } else if (inside) {
      out.push({ node: n, start: 0, end: n.length });
    }
  }
  return out;
}

function splitText(node: Text, start: number, end: number): Text {
  let target = node;
  if (start > 0) target = target.splitText(start);
  if (end - start < target.length) target.splitText(end - start);
  return target;
}

/** Scrolls a scroll container so that `range` is visible (centred vertically). */
export function scrollRangeIntoView(range: Range, container: HTMLElement | null): void {
  const rect = typeof range.getBoundingClientRect === 'function' ? range.getBoundingClientRect() : null;
  if (!container || !rect || (rect.width === 0 && rect.height === 0)) {
    const el = range.startContainer.parentElement;
    el?.scrollIntoView?.({ block: 'center', inline: 'nearest' });
    return;
  }
  const c = container.getBoundingClientRect();
  const top = rect.top - c.top + container.scrollTop - container.clientHeight / 2 + rect.height / 2;
  const left =
    rect.left < c.left || rect.right > c.right
      ? rect.left - c.left + container.scrollLeft - container.clientWidth / 3
      : container.scrollLeft;
  container.scrollTo?.({ top: Math.max(0, top), left: Math.max(0, left), behavior: 'auto' });
}

/**
 * Applies search highlighting to a DOM subtree and returns the number of
 * matches plus a cleanup function. `allowMutation` enables the `<mark>`
 * fallback for renderer-owned DOM.
 */
export function highlightDom(
  owner: object,
  root: HTMLElement,
  query: string,
  caseSensitive: boolean,
  activeIndex: number,
  options: { allowMutation: boolean; scrollContainer?: HTMLElement | null },
): { count: number; cleanup: () => void } {
  const ranges = findDomMatches(root, query, caseSensitive);
  const active = ranges[activeIndex];
  if (supportsHighlightApi()) {
    searchHighlighter.set(owner, ranges, activeIndex);
    if (active) scrollRangeIntoView(active, options.scrollContainer ?? null);
    return { count: ranges.length, cleanup: () => searchHighlighter.clear(owner) };
  }
  if (options.allowMutation && ranges.length) {
    const restore = wrapRanges(ranges, activeIndex);
    const activeMark = root.querySelector<HTMLElement>('.dsc-mark--active');
    activeMark?.scrollIntoView?.({ block: 'center', inline: 'nearest' });
    return { count: ranges.length, cleanup: restore };
  }
  if (active) scrollRangeIntoView(active, options.scrollContainer ?? null);
  return { count: ranges.length, cleanup: () => undefined };
}
