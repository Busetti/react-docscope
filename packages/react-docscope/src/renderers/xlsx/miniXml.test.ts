import { parseMiniXml } from './miniXml';

describe('parseMiniXml', () => {
  it('parses elements, attributes, namespaces, text, CDATA and entities', () => {
    const doc = parseMiniXml(
      `<?xml version="1.0"?><!-- c --><!DOCTYPE x [<!ENTITY e "boom">]>
      <r:root xmlns:r="urn:r" a='1' b="x &amp; y"><item r:id="rId1">a &lt; b</item><item/><t><![CDATA[<raw>]]></t></r:root>`,
    );
    const root = doc.children[0]!;
    expect(root.tagName).toBe('r:root');
    expect(root.localName).toBe('root');
    expect(root.getAttribute('a')).toBe('1');
    expect(root.getAttribute('b')).toBe('x & y');
    expect(root.hasAttribute('missing')).toBe(false);
    const items = doc.getElementsByTagNameNS('*', 'item');
    expect(items).toHaveLength(2);
    expect(items[0]!.getAttributeNS(null, 'id')).toBe('rId1');
    expect(items[1]!.getAttributeNS(null, 'id')).toBeNull();
    expect(items[0]!.textContent).toBe('a < b');
    expect(doc.getElementsByTagNameNS('*', 't')[0]!.textContent).toBe('<raw>');
    // Custom entities are never expanded.
    expect(root.textContent).not.toContain('boom');
  });

  it.each([
    ['<a><b></a>', 'mismatched close'],
    ['<a>', 'unclosed'],
    ['</a>', 'stray close'],
    ['<a><oops', 'truncated'],
    ['<a x=1/>', 'unquoted attribute'],
  ])('rejects %p (%s)', (xml) => {
    expect(() => parseMiniXml(xml)).toThrow('Malformed workbook XML.');
  });
});
