import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import TextRenderer, { splitLines } from '../text/TextRenderer';
import MarkdownRenderer from '../markdown/MarkdownRenderer';
import JsonRenderer from '../json/JsonRenderer';
import XmlRenderer from '../xml/XmlRenderer';
import { lastCall, renderRenderer } from '../../../../../tests/setup/renderer-harness';
import { tokenizeJsonLine, tokenizeXmlLine } from '../shared/tokenize';
import {
  ancestorsOf,
  childPath,
  defaultExpanded,
  describeJsonError,
  flattenJson,
  indexJson,
  kindOf,
  previewOf,
  searchJson,
} from '../json/jsonModel';
import {
  defaultXmlExpanded,
  flattenXml,
  parseXml,
  prettyXml,
  searchXml,
  xmlAncestors,
} from '../xml/xmlModel';

describe('TextRenderer', () => {
  it('renders lines with line numbers and reports matches', async () => {
    const r = renderRenderer(TextRenderer, { name: 'notes.txt', fixture: 'notes.txt' });
    await r.ready();
    expect(screen.getByRole('document', { name: 'notes.txt' })).toBeInTheDocument();
    expect(screen.getByText(/Line 001: meeting notes/)).toBeInTheDocument();
    r.update({}, { query: 'line 00', activeIndex: 0 });
    await waitFor(() => expect(lastCall(r.host.setSearchResults)[0]).toBe(9));
    expect(document.querySelectorAll('mark.dsc-mark').length).toBeGreaterThan(0);
    expect(document.querySelector('mark.dsc-mark--active')).toHaveTextContent(/line 00/i);
    r.update({}, { query: 'LINE', caseSensitive: true, activeIndex: -1 });
    await waitFor(() => expect(lastCall(r.host.setSearchResults)[0]).toBe(0));
    r.update({ zoom: 2 });
    expect(screen.getByRole('document')).toHaveStyle({ fontSize: '26px' });
  });

  it('splits lines across newline conventions', () => {
    expect(splitLines('a\r\nb\rc\nd\n')).toEqual(['a', 'b', 'c', 'd']);
    expect(splitLines('')).toEqual(['']);
  });

  it('reports load failures', async () => {
    (globalThis as { fetch?: unknown }).fetch = jest.fn(async () => ({
      ok: false,
      status: 403,
      headers: { get: () => null },
    }));
    const r = renderRenderer(TextRenderer, {
      name: 'x.txt',
      resolved: { kind: 'url', url: 'https://x/expired' },
    });
    await r.failed();
    expect(r.host.setError).toHaveBeenCalledWith('ACCESS_DENIED', expect.any(String));
  });
});

describe('MarkdownRenderer', () => {
  it('renders GFM safely', async () => {
    const r = renderRenderer(MarkdownRenderer, { name: 'readme.md', fixture: 'readme.md' });
    await r.ready();
    const article = await screen.findByRole('article', { name: 'readme.md' });
    expect(within(article).getByRole('heading', { level: 1 })).toHaveTextContent(
      'DocScope Markdown sample',
    );
    expect(within(article).getAllByRole('checkbox')).toHaveLength(2);
    expect(within(article).getByRole('table')).toBeInTheDocument();
    // raw HTML is not rendered and scripts never run
    expect(article.querySelector('script')).toBeNull();
    expect((window as { __mdScriptRan?: boolean }).__mdScriptRan).toBeUndefined();
    // javascript: URLs are stripped
    const dangerous = within(article).getByText('dangerous');
    expect(dangerous.getAttribute('href') ?? '').not.toMatch(/javascript/i);
    const safe = within(article).getByText('safe link');
    expect(safe).toHaveAttribute('target', '_blank');
    expect(safe).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });

  it('searches formatted and raw views', async () => {
    const r = renderRenderer(MarkdownRenderer, { name: 'readme.md', fixture: 'readme.md' });
    await r.ready();
    r.update({}, { query: 'invoice', activeIndex: 0 });
    await waitFor(() => expect(lastCall(r.host.setSearchResults)[0]).toBe(1));
    r.update({ rawView: true }, { query: 'markdown', activeIndex: 0 });
    expect(await screen.findByRole('document', { name: 'readme.md (source)' })).toBeInTheDocument();
    await waitFor(() => expect(lastCall(r.host.setSearchResults)[0]).toBe(3));
    r.update({ rawView: true }, { query: '', activeIndex: -1 });
    await waitFor(() => expect(lastCall(r.host.setSearchResults)[0]).toBe(0));
  });

  it('blocks images with unsafe sources', async () => {
    const md = '![ok](https://example.com/a.png)\n\n![bad](file:///etc/passwd)';
    const r = renderRenderer(MarkdownRenderer, { name: 'img.md', blob: new Blob([md]) });
    await r.ready();
    expect(await screen.findByAltText('ok')).toHaveAttribute('referrerpolicy', 'no-referrer');
    expect(screen.getByText('[image: bad]')).toBeInTheDocument();
  });
});

describe('JsonRenderer', () => {
  beforeEach(() => {
    Object.assign(navigator, { clipboard: { writeText: jest.fn().mockResolvedValue(undefined) } });
  });

  it('renders an expandable tree and copies paths', async () => {
    const r = renderRenderer(JsonRenderer, { name: 'config.json', fixture: 'config.json' });
    await r.ready();
    const tree = screen.getByRole('tree', { name: 'config.json' });
    expect(within(tree).getByText('"docscope"')).toBeInTheDocument();
    expect(within(tree).getByText('Array(2)')).toBeInTheDocument();
    // owners[0] is collapsed by default (depth 2)
    expect(within(tree).queryByText('"Guru"')).toBeNull();
    const ownerRow = within(tree)
      .getAllByRole('treeitem')
      .find((n) => n.textContent?.startsWith('0'))!;
    fireEvent.click(within(ownerRow).getByRole('button', { name: 'Expand' }));
    expect(await within(tree).findByText('"Guru"')).toBeInTheDocument();
    fireEvent.click(within(tree).getByRole('button', { name: 'Copy path $.owners[0].name' }));
    await waitFor(() =>
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('$.owners[0].name'),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Collapse all' }));
    expect(within(tree).getAllByRole('treeitem')).toHaveLength(7); // root + its keys
    fireEvent.click(screen.getByRole('button', { name: 'Expand all' }));
    expect(within(tree).getAllByRole('treeitem').length).toBeGreaterThan(15);
  });

  it('supports keyboard navigation', async () => {
    const r = renderRenderer(JsonRenderer, { name: 'config.json', fixture: 'config.json' });
    await r.ready();
    const tree = screen.getByRole('tree');
    const count = () => within(tree).getAllByRole('treeitem').length;
    const initial = count();
    fireEvent.keyDown(tree, { key: 'ArrowLeft' }); // collapse root
    expect(count()).toBe(1);
    fireEvent.keyDown(tree, { key: 'ArrowRight' }); // expand root
    expect(count()).toBe(initial);
    fireEvent.keyDown(tree, { key: 'ArrowDown' });
    fireEvent.keyDown(tree, { key: 'End' });
    fireEvent.keyDown(tree, { key: 'Home' });
    fireEvent.keyDown(tree, { key: 'ArrowUp' });
    fireEvent.keyDown(tree, { key: 'Enter' });
    expect(count()).toBe(1);
    fireEvent.keyDown(tree, { key: ' ' });
    fireEvent.keyDown(tree, { key: 'ArrowRight' }); // already expanded → moves down
    fireEvent.keyDown(tree, { key: 'ArrowLeft' }); // leaf → parent
    fireEvent.keyDown(tree, { key: 'x' });
    expect(tree).toHaveAttribute('aria-activedescendant');
  });

  it('searches keys and values and reveals collapsed matches', async () => {
    const r = renderRenderer(JsonRenderer, { name: 'config.json', fixture: 'config.json' });
    await r.ready();
    r.update({}, { query: 'guru', activeIndex: 0 });
    await waitFor(() => expect(lastCall(r.host.setSearchResults)[0]).toBe(1));
    expect(await screen.findByText('"Guru"')).toBeInTheDocument();
    expect(document.querySelector('.dsc-tree-row--active-match')).not.toBeNull();
  });

  it('shows invalid JSON with location and raw source', async () => {
    const r = renderRenderer(JsonRenderer, { name: 'invalid.json', fixture: 'invalid.json' });
    await r.ready();
    expect(screen.getByRole('alert')).toHaveTextContent(/Invalid JSON/);
    expect(screen.getByRole('document', { name: 'invalid.json (source)' })).toHaveTextContent(
      '"broken"',
    );
  });

  it('pretty prints in raw view', async () => {
    const r = renderRenderer(JsonRenderer, {
      name: 'c.json',
      blob: new Blob(['{"a":[1,true,null]}']),
      view: { rawView: true },
    });
    await r.ready();
    const doc = screen.getByRole('document');
    expect(doc.querySelector('.dsc-tok-key')).toHaveTextContent('"a"');
    expect(doc.querySelector('.dsc-tok-boolean')).toHaveTextContent('true');
    expect(doc.querySelector('.dsc-tok-null')).toHaveTextContent('null');
  });

  it('model helpers', () => {
    const idx = indexJson({ a: { 'b-c': [1, 'x'] }, n: null });
    expect([...idx.keys()]).toEqual([
      '$',
      '$.a',
      '$.a["b-c"]',
      '$.a["b-c"][0]',
      '$.a["b-c"][1]',
      '$.n',
    ]);
    expect(childPath('$', 'ok_1')).toBe('$.ok_1');
    expect(kindOf(undefined)).toBe('null');
    expect(kindOf(() => 1)).toBe('null');
    expect(previewOf(idx.get('$')!)).toBe('{2 keys}');
    expect(previewOf(idx.get('$.a')!)).toBe('{1 key}');
    expect(previewOf(idx.get('$.a["b-c"]')!)).toBe('Array(2)');
    expect(previewOf(idx.get('$.a["b-c"][1]')!)).toBe('"x"');
    expect(searchJson(idx, 'b-c', false)).toEqual(['$.a["b-c"]']);
    expect(searchJson(idx, '', false)).toEqual([]);
    expect(searchJson(new Map(), 'x', false)).toEqual([]);
    expect(ancestorsOf(idx, '$.a["b-c"][0]')).toEqual(['$.a["b-c"]', '$.a', '$']);
    expect(flattenJson(new Map(), new Set())).toEqual([]);
    const big = indexJson(Array.from({ length: 6000 }, (_, i) => ({ i })));
    expect(defaultExpanded(big)).toEqual(new Set(['$']));
    expect(
      describeJsonError(new Error('Unexpected token } in JSON at position 5'), 'ab\ncdefg'),
    ).toMatchObject({ line: 2, column: 3 });
    expect(describeJsonError(new Error('Bad thing at line 3 column 9'), '')).toMatchObject({
      line: 3,
      column: 9,
    });
    expect(describeJsonError('weird', '')).toEqual({ message: 'weird' });
  });

  it('tokenizes JSON lines', () => {
    expect(tokenizeJsonLine('  "k": -1.5e3, "s": "v", "b": false, "n": null }')).toEqual(
      expect.arrayContaining([
        { text: '"k"', type: 'key' },
        { text: '-1.5e3', type: 'number' },
        { text: '"v"', type: 'string' },
        { text: 'false', type: 'boolean' },
        { text: 'null', type: 'null' },
      ]),
    );
  });
});

describe('XmlRenderer', () => {
  it('renders the tree and inspects attributes', async () => {
    Object.assign(navigator, { clipboard: { writeText: jest.fn().mockResolvedValue(undefined) } });
    const r = renderRenderer(XmlRenderer, { name: 'catalog.xml', fixture: 'catalog.xml' });
    await r.ready();
    const tree = screen.getByRole('tree', { name: 'catalog.xml' });
    expect(within(tree).getAllByText('book')).toHaveLength(2);
    expect(within(tree).getByText('Midnight Rain')).toBeInTheDocument();
    expect(within(tree).getByText(/Product catalog sample/)).toBeInTheDocument();
    expect(within(tree).getByText(/CDATA\[Contains <markup>/)).toBeInTheDocument();
    const firstBook = within(tree)
      .getAllByRole('treeitem')
      .find((n) => n.textContent?.includes('bk101'))!;
    fireEvent.click(firstBook);
    expect(screen.getByText('/catalog/book[1]')).toBeInTheDocument();
    const attrs = screen.getByRole('table');
    expect(within(attrs).getByText('id')).toBeInTheDocument();
    expect(within(attrs).getByText('bk101')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Copy path' }));
    await waitFor(() =>
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('/catalog/book[1]'),
    );
    fireEvent.click(within(firstBook).getByRole('button', { name: 'Collapse' }));
    expect(within(tree).queryByText('XML Developer Guide')).toBeNull();
  });

  it('searches tags, attributes and text', async () => {
    const r = renderRenderer(XmlRenderer, { name: 'catalog.xml', fixture: 'catalog.xml' });
    await r.ready();
    r.update({}, { query: 'usd', activeIndex: 1 });
    await waitFor(() => expect(lastCall(r.host.setSearchResults)[0]).toBe(2));
    r.update({ rawView: true }, { query: 'book', activeIndex: 0 });
    await waitFor(() => expect(lastCall(r.host.setSearchResults)[0]).toBe(4));
    expect(screen.getByRole('document').querySelector('.dsc-tok-tag')).not.toBeNull();
  });

  it('reports malformed XML and never resolves external entities', async () => {
    const r = renderRenderer(XmlRenderer, { name: 'malformed.xml', fixture: 'malformed.xml' });
    await r.ready();
    expect(screen.getByRole('alert')).toHaveTextContent(/Invalid XML/);
    const x = renderRenderer(XmlRenderer, { name: 'xxe.xml', fixture: 'xxe.xml' });
    await x.ready();
    expect(document.body.textContent).not.toMatch(/root:x:0:0/);
  });

  it('model helpers', () => {
    const parsed = parseXml(
      '<?xml version="1.0"?><?pi data?><!DOCTYPE r><r a="1"><x>t</x><x/><y>a<z/></y></r>',
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const rows = flattenXml(parsed.index, parsed.rootId, defaultXmlExpanded(parsed.index));
    expect(rows.map((r) => r.node.kind)).toEqual(
      expect.arrayContaining(['pi', 'doctype', 'element', 'text']),
    );
    expect(rows.find((r) => r.node.name === 'x')!.node.path).toBe('/r/x[1]');
    const hits = searchXml(parsed.index, parsed.rootId, 'z', false);
    expect(hits).toHaveLength(1);
    expect(xmlAncestors(parsed.index, hits[0]!, parsed.rootId).length).toBe(2);
    expect(searchXml(parsed.index, parsed.rootId, ' ', false)).toEqual([]);
    expect(flattenXml(new Map(), 'n0', new Set())).toEqual([]);
    expect(parseXml('<a><b></a>').ok).toBe(false);
    const oneLine = `<a>${'<b x="1">t</b>'.repeat(20)}</a>`;
    expect(prettyXml(oneLine).split('\n').length).toBeGreaterThan(10);
    expect(prettyXml('<a/>')).toBe('<a/>');
  });

  it('tokenizes XML lines', () => {
    const toks = tokenizeXmlLine('<!-- c --><a x="1"><![CDATA[d]]><?p q?></a>');
    expect(toks.map((t) => t.type)).toEqual(
      expect.arrayContaining(['comment', 'tag', 'attr', 'string', 'cdata', 'meta', 'punct']),
    );
  });
});

describe('TextLines rendering', () => {
  it('splits tokens at match boundaries', async () => {
    const r = renderRenderer(JsonRenderer, {
      name: 'k.json',
      blob: new Blob(['{"needle":"haystack needle"}']),
      view: { rawView: true },
    });
    await r.ready();
    await act(async () => r.update({ rawView: true }, { query: 'needle', activeIndex: 1 }));
    await waitFor(() => expect(lastCall(r.host.setSearchResults)[0]).toBe(2));
    const marks = document.querySelectorAll('mark');
    expect(marks).toHaveLength(2);
    expect(marks[0]!.querySelector('.dsc-tok-key')).not.toBeNull();
    expect(marks[1]).toHaveClass('dsc-mark--active');
  });
});
