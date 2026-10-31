import { textIncludes } from '../../core/search';
import type { FlatTreeRow } from '../shared/TreeView';

export type JsonKind = 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null';

export interface JsonNode {
  id: string;
  parentId: string | null;
  depth: number;
  /** Property name or array index; `null` for the root. */
  key: string | number | null;
  kind: JsonKind;
  value: unknown;
  children: string[];
}

export interface JsonRow extends FlatTreeRow {
  node: JsonNode;
}

const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

export function childPath(parent: string, key: string | number): string {
  if (typeof key === 'number') return `${parent}[${key}]`;
  return IDENT.test(key) ? `${parent}.${key}` : `${parent}[${JSON.stringify(key)}]`;
}

export function kindOf(value: unknown): JsonKind {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  const t = typeof value;
  if (t === 'object') return 'object';
  if (t === 'string' || t === 'number' || t === 'boolean') return t;
  return 'null';
}

/** Builds an id → node index. Ids are JSONPath-like (`$.owners[0].name`). */
export function indexJson(root: unknown): Map<string, JsonNode> {
  const map = new Map<string, JsonNode>();
  const stack: Array<{ id: string; parentId: string | null; depth: number; key: string | number | null; value: unknown }> = [
    { id: '$', parentId: null, depth: 0, key: null, value: root },
  ];
  while (stack.length) {
    const item = stack.pop()!;
    const kind = kindOf(item.value);
    const node: JsonNode = { ...item, kind, children: [] };
    map.set(item.id, node);
    if (kind === 'object' || kind === 'array') {
      const entries: Array<[string | number, unknown]> =
        kind === 'array'
          ? (item.value as unknown[]).map((v, i) => [i, v])
          : Object.entries(item.value as Record<string, unknown>);
      for (const [k] of entries) node.children.push(childPath(item.id, k));
      for (let i = entries.length - 1; i >= 0; i -= 1) {
        const [k, v] = entries[i]!;
        stack.push({ id: childPath(item.id, k), parentId: item.id, depth: item.depth + 1, key: k, value: v });
      }
    }
  }
  return map;
}

export function defaultExpanded(index: Map<string, JsonNode>): Set<string> {
  const set = new Set<string>(['$']);
  if (index.size > 5000) return set;
  for (const n of index.values()) if (n.depth < 2 && n.children.length) set.add(n.id);
  return set;
}

export function flattenJson(index: Map<string, JsonNode>, expanded: Set<string>): JsonRow[] {
  const rows: JsonRow[] = [];
  const root = index.get('$');
  if (!root) return rows;
  const stack: JsonNode[] = [root];
  while (stack.length) {
    const node = stack.pop()!;
    const hasChildren = node.children.length > 0;
    const isOpen = hasChildren && expanded.has(node.id);
    rows.push({ id: node.id, depth: node.depth, hasChildren, expanded: isOpen, parentId: node.parentId, node });
    if (isOpen) for (let i = node.children.length - 1; i >= 0; i -= 1) stack.push(index.get(node.children[i]!)!);
  }
  return rows;
}

/** Ids of nodes whose key or primitive value matches, in document order. */
export function searchJson(index: Map<string, JsonNode>, query: string, caseSensitive: boolean, limit = 5000): string[] {
  if (!query.trim()) return [];
  const out: string[] = [];
  const root = index.get('$');
  if (!root) return out;
  const stack: JsonNode[] = [root];
  while (stack.length && out.length < limit) {
    const n = stack.pop()!;
    const keyHit = n.key !== null && textIncludes(String(n.key), query, caseSensitive);
    const valueHit = n.kind !== 'object' && n.kind !== 'array' && textIncludes(String(n.value), query, caseSensitive);
    if (keyHit || valueHit) out.push(n.id);
    for (let i = n.children.length - 1; i >= 0; i -= 1) stack.push(index.get(n.children[i]!)!);
  }
  return out;
}

export function ancestorsOf(index: Map<string, JsonNode>, id: string): string[] {
  const out: string[] = [];
  let cur = index.get(id)?.parentId ?? null;
  while (cur) {
    out.push(cur);
    cur = index.get(cur)?.parentId ?? null;
  }
  return out;
}

export function previewOf(node: JsonNode): string {
  if (node.kind === 'array') return `Array(${node.children.length})`;
  if (node.kind === 'object') return `{${node.children.length} ${node.children.length === 1 ? 'key' : 'keys'}}`;
  if (node.kind === 'string') return JSON.stringify(node.value);
  return String(node.value);
}

/** Converts a JSON.parse error into a human message with line / column. */
export function describeJsonError(error: unknown, text: string): { message: string; line?: number; column?: number } {
  const msg = error instanceof Error ? error.message : String(error);
  const pos = /position (\d+)/i.exec(msg);
  const lc = /line (\d+) column (\d+)/i.exec(msg);
  if (lc) return { message: msg, line: Number(lc[1]), column: Number(lc[2]) };
  if (pos) {
    const p = Number(pos[1]);
    const before = text.slice(0, p);
    const line = before.split('\n').length;
    const column = p - before.lastIndexOf('\n');
    return { message: msg, line, column };
  }
  return { message: msg };
}
