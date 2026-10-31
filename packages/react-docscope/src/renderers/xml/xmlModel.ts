import { textIncludes } from '../../core/search';
import type { FlatTreeRow } from '../shared/TreeView';

export type XmlNodeKind = 'element' | 'text' | 'cdata' | 'comment' | 'pi' | 'doctype';

export interface XmlNode {
  id: string;
  parentId: string | null;
  depth: number;
  kind: XmlNodeKind;
  name: string;
  /** Text for text/cdata/comment/pi nodes, or the single text child of simple elements. */
  text: string;
  attributes: Array<{ name: string; value: string }>;
  children: string[];
  /** XPath-like path, e.g. `/catalog/book[2]/title`. */
  path: string;
}

export interface XmlRow extends FlatTreeRow {
  node: XmlNode;
}

export type XmlParseResult =
  { ok: true; index: Map<string, XmlNode>; rootId: string } | { ok: false; message: string };

/**
 * Parses XML with the browser's DOMParser. DOMParser never fetches external
 * entities or DTDs, so XXE-style payloads cannot read local files or reach the
 * network; unresolved entities simply produce a parse error or empty text.
 */
export function parseXml(text: string): XmlParseResult {
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(text, 'application/xml');
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : 'Invalid XML.' };
  }
  const err = doc.getElementsByTagName('parsererror')[0];
  if (err || !doc.documentElement) {
    const raw = (err?.textContent || 'The XML document is not well-formed.')
      .replace(/\s+/g, ' ')
      .trim();
    return { ok: false, message: raw.slice(0, 300) };
  }
  const index = new Map<string, XmlNode>();
  let counter = 0;
  const rootId = 'n0';
  const visit = (
    node: Node,
    parentId: string | null,
    depth: number,
    path: string,
  ): string | null => {
    const id = parentId === null ? rootId : `n${++counter}`;
    let xmlNode: XmlNode;
    switch (node.nodeType) {
      case Node.DOCUMENT_NODE: {
        xmlNode = {
          id,
          parentId,
          depth,
          kind: 'element',
          name: '#document',
          text: '',
          attributes: [],
          children: [],
          path: '/',
        };
        break;
      }
      case Node.ELEMENT_NODE: {
        const el = node as Element;
        xmlNode = {
          id,
          parentId,
          depth,
          kind: 'element',
          name: el.tagName,
          text: '',
          attributes: Array.from(el.attributes).map((a) => ({ name: a.name, value: a.value })),
          children: [],
          path,
        };
        break;
      }
      case Node.TEXT_NODE: {
        const t = (node.nodeValue ?? '').trim();
        if (!t) return null;
        xmlNode = {
          id,
          parentId,
          depth,
          kind: 'text',
          name: '#text',
          text: t,
          attributes: [],
          children: [],
          path: `${path}/text()`,
        };
        break;
      }
      case Node.CDATA_SECTION_NODE:
        xmlNode = {
          id,
          parentId,
          depth,
          kind: 'cdata',
          name: '#cdata',
          text: node.nodeValue ?? '',
          attributes: [],
          children: [],
          path: `${path}/text()`,
        };
        break;
      case Node.COMMENT_NODE:
        xmlNode = {
          id,
          parentId,
          depth,
          kind: 'comment',
          name: '#comment',
          text: (node.nodeValue ?? '').trim(),
          attributes: [],
          children: [],
          path: `${path}/comment()`,
        };
        break;
      case Node.PROCESSING_INSTRUCTION_NODE: {
        const pi = node as ProcessingInstruction;
        xmlNode = {
          id,
          parentId,
          depth,
          kind: 'pi',
          name: pi.target,
          text: pi.data,
          attributes: [],
          children: [],
          path: `${path}/processing-instruction()`,
        };
        break;
      }
      case Node.DOCUMENT_TYPE_NODE:
        xmlNode = {
          id,
          parentId,
          depth,
          kind: 'doctype',
          name: (node as DocumentType).name,
          text: '',
          attributes: [],
          children: [],
          path,
        };
        break;
      default:
        return null;
    }
    index.set(id, xmlNode);
    if (node.nodeType === Node.ELEMENT_NODE || node.nodeType === Node.DOCUMENT_NODE) {
      const counts = new Map<string, number>();
      const totals = new Map<string, number>();
      for (const c of Array.from(node.childNodes)) {
        if (c.nodeType === Node.ELEMENT_NODE)
          totals.set((c as Element).tagName, (totals.get((c as Element).tagName) ?? 0) + 1);
      }
      for (const c of Array.from(node.childNodes)) {
        let childPath = path;
        if (c.nodeType === Node.ELEMENT_NODE) {
          const name = (c as Element).tagName;
          const n = (counts.get(name) ?? 0) + 1;
          counts.set(name, n);
          const base = path === '/' ? '' : path;
          childPath = `${base}/${name}${(totals.get(name) ?? 0) > 1 ? `[${n}]` : ''}`;
        }
        const childId = visit(c, id, depth + 1, childPath);
        if (childId) xmlNode.children.push(childId);
      }
      // Collapse a single text child into the element for a compact row.
      if (xmlNode.kind === 'element' && xmlNode.children.length === 1) {
        const only = index.get(xmlNode.children[0]!)!;
        if (only.kind === 'text') {
          xmlNode.text = only.text;
          xmlNode.children = [];
          index.delete(only.id);
        }
      }
    }
    return id;
  };
  visit(doc, null, -1, '/');
  return { ok: true, index, rootId };
}

export function flattenXml(
  index: Map<string, XmlNode>,
  rootId: string,
  expanded: Set<string>,
): XmlRow[] {
  const rows: XmlRow[] = [];
  const root = index.get(rootId);
  if (!root) return rows;
  const stack: string[] = [...root.children].reverse();
  while (stack.length) {
    const node = index.get(stack.pop()!)!;
    const hasChildren = node.children.length > 0;
    const isOpen = hasChildren && expanded.has(node.id);
    rows.push({
      id: node.id,
      depth: node.depth,
      hasChildren,
      expanded: isOpen,
      parentId: node.parentId === rootId ? null : node.parentId,
      node,
    });
    if (isOpen)
      for (let i = node.children.length - 1; i >= 0; i -= 1) stack.push(node.children[i]!);
  }
  return rows;
}

export function defaultXmlExpanded(index: Map<string, XmlNode>): Set<string> {
  const set = new Set<string>();
  const limit = index.size > 5000 ? 1 : 3;
  for (const n of index.values())
    if (n.kind === 'element' && n.depth < limit && n.children.length) set.add(n.id);
  return set;
}

export function searchXml(
  index: Map<string, XmlNode>,
  rootId: string,
  query: string,
  caseSensitive: boolean,
  limit = 5000,
): string[] {
  if (!query.trim()) return [];
  const out: string[] = [];
  const stack = [...(index.get(rootId)?.children ?? [])].reverse();
  while (stack.length && out.length < limit) {
    const n = index.get(stack.pop()!)!;
    const hit =
      (n.kind === 'element' && textIncludes(n.name, query, caseSensitive)) ||
      textIncludes(n.text, query, caseSensitive) ||
      n.attributes.some(
        (a) =>
          textIncludes(a.name, query, caseSensitive) || textIncludes(a.value, query, caseSensitive),
      );
    if (hit) out.push(n.id);
    for (let i = n.children.length - 1; i >= 0; i -= 1) stack.push(n.children[i]!);
  }
  return out;
}

export function xmlAncestors(index: Map<string, XmlNode>, id: string, rootId: string): string[] {
  const out: string[] = [];
  let cur = index.get(id)?.parentId ?? null;
  while (cur && cur !== rootId) {
    out.push(cur);
    cur = index.get(cur)?.parentId ?? null;
  }
  return out;
}

/** Re-indents XML that arrived on a single line, for the raw view. */
export function prettyXml(text: string): string {
  if (text.includes('\n') || text.length < 120) return text;
  let depth = 0;
  return text
    .replace(/>\s*</g, '>\n<')
    .split('\n')
    .map((line) => {
      if (/^<\//.test(line)) depth = Math.max(0, depth - 1);
      const out = '  '.repeat(depth) + line;
      if (/^<[^!?/][^>]*[^/]>$/.test(line) && !/<\/[^>]+>$/.test(line)) depth += 1;
      return out;
    })
    .join('\n');
}
