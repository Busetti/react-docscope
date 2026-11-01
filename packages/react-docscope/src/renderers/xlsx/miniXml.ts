import { decodeXml } from './xmlScan';

/**
 * Tiny, non-validating XML parser for the small SpreadsheetML parts
 * (workbook, relationships, styles, theme). It needs no DOM, so the XLSX
 * reader runs inside a Web Worker. Nodes expose the subset of the DOM Element
 * API the reader uses (`localName`, `children`, `getAttribute`, …).
 * DTDs and entities other than the XML built-ins are ignored, never resolved.
 */
export class MiniNode {
  readonly children: MiniNode[] = [];
  text = '';
  constructor(
    readonly tagName: string,
    readonly attrs: Record<string, string>,
  ) {}

  get localName(): string {
    const i = this.tagName.indexOf(':');
    return i === -1 ? this.tagName : this.tagName.slice(i + 1);
  }

  getAttribute(name: string): string | null {
    return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name]! : null;
  }

  hasAttribute(name: string): boolean {
    return this.getAttribute(name) !== null;
  }

  /** Namespaced attribute lookup by local name (any non-empty prefix). */
  getAttributeNS(_ns: string | null, local: string): string | null {
    for (const [k, v] of Object.entries(this.attrs)) {
      const i = k.indexOf(':');
      if (i > 0 && k.slice(i + 1) === local) return v;
    }
    return null;
  }

  /** All descendants with the given local name, in document order. */
  getElementsByTagNameNS(_ns: string, local: string): MiniNode[] {
    const out: MiniNode[] = [];
    const walk = (n: MiniNode) => {
      for (const c of n.children) {
        if (c.localName === local) out.push(c);
        walk(c);
      }
    };
    walk(this);
    return out;
  }

  get textContent(): string {
    return this.text + this.children.map((c) => c.textContent).join('');
  }
}

const TOKEN =
  /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<\?[\s\S]*?\?>|<!DOCTYPE(?:[^[>]|\[[\s\S]*?\])*>|<\/([\w:.-]+)\s*>|<([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
const ATTR = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

export function parseMiniXml(xml: string): MiniNode {
  const root = new MiniNode('#document', {});
  const stack: MiniNode[] = [root];
  let pos = 0;
  TOKEN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TOKEN.exec(xml)) !== null) {
    if (m.index !== pos) throw new Error('Malformed workbook XML.');
    pos = TOKEN.lastIndex;
    const top = stack[stack.length - 1]!;
    if (m[3]) {
      const attrs: Record<string, string> = {};
      ATTR.lastIndex = 0;
      let a: RegExpExecArray | null;
      while ((a = ATTR.exec(m[4] ?? '')) !== null) attrs[a[1]!] = decodeXml(a[2] ?? a[3] ?? '');
      const node = new MiniNode(m[3], attrs);
      top.children.push(node);
      if (!m[5]) stack.push(node);
    } else if (m[2]) {
      if (stack.length < 2 || top.tagName !== m[2]) throw new Error('Malformed workbook XML.');
      stack.pop();
    } else if (m[6] !== undefined) {
      top.text += decodeXml(m[6]);
    } else if (m[1] !== undefined) {
      top.text += m[1];
    }
  }
  if (pos !== xml.length || stack.length !== 1) throw new Error('Malformed workbook XML.');
  return root;
}
