import { useCallback, useEffect, useMemo, useState } from 'react';
import type { RendererProps } from '../../types';
import { toPreviewError } from '../../core/errors';
import { useAsync, useLatest, useLineSearch } from '../shared/hooks';
import { TextLines } from '../shared/TextLines';
import { TreeView } from '../shared/TreeView';
import { tokenizeXmlLine } from '../shared/tokenize';
import { copyText } from '../shared/clipboard';
import { splitLines } from '../text/TextRenderer';
import {
  defaultXmlExpanded,
  flattenXml,
  parseXml,
  prettyXml,
  searchXml,
  xmlAncestors,
  type XmlNode,
  type XmlRow,
} from './xmlModel';

export default function XmlRenderer({ document, source, search, view, host }: RendererProps) {
  const { value: text, error } = useAsync(() => source.getText(), [source]);
  const hostRef = useLatest(host);
  const parsed = useMemo(() => (text === undefined ? null : parseXml(text)), [text]);

  useEffect(() => {
    if (error) {
      const e = toPreviewError(error, 'FETCH_FAILED');
      hostRef.current.setError(e.code, e.message);
    } else if (parsed) hostRef.current.setReady();
  }, [error, parsed, hostRef]);

  if (!parsed || text === undefined) return null;
  if (!parsed.ok || view.rawView) {
    return (
      <div className="dsc-stack">
        {!parsed.ok && (
          <div className="dsc-inline-error" role="alert">
            <strong>Invalid XML.</strong> {parsed.message}
          </div>
        )}
        <RawXml text={text} search={search} host={host} zoom={view.zoom} label={`${document.name} (source)`} />
      </div>
    );
  }
  return (
    <XmlTree index={parsed.index} rootId={parsed.rootId} search={search} host={host} zoom={view.zoom} label={document.name} />
  );
}

function RawXml({ text, search, host, zoom, label }: { text: string; search: RendererProps['search']; host: RendererProps['host']; zoom: number; label: string }) {
  const lines = useMemo(() => splitLines(prettyXml(text)), [text]);
  const { byLine, active } = useLineSearch(lines, search, host);
  return (
    <TextLines
      lines={lines}
      matches={byLine}
      activeMatch={active}
      activeIndex={search.activeIndex}
      zoom={zoom}
      wrap={false}
      tokenize={tokenizeXmlLine}
      label={label}
    />
  );
}

function XmlTree({
  index,
  rootId,
  search,
  host,
  zoom,
  label,
}: {
  index: Map<string, XmlNode>;
  rootId: string;
  search: RendererProps['search'];
  host: RendererProps['host'];
  zoom: number;
  label: string;
}) {
  const [expanded, setExpanded] = useState(() => defaultXmlExpanded(index));
  const [selected, setSelected] = useState<XmlNode | null>(null);
  const [copied, setCopied] = useState(false);
  const hostRef = useLatest(host);
  const matches = useMemo(
    () => searchXml(index, rootId, search.query, search.caseSensitive),
    [index, rootId, search.query, search.caseSensitive],
  );
  const matchSet = useMemo(() => new Set(matches), [matches]);
  const activeId = search.activeIndex >= 0 ? matches[search.activeIndex] : undefined;

  useEffect(() => {
    hostRef.current.setSearchResults(matches.length);
  }, [matches, hostRef]);

  useEffect(() => {
    if (!activeId) return;
    const ancestors = xmlAncestors(index, activeId, rootId);
    setExpanded((prev) => {
      if (ancestors.every((a) => prev.has(a))) return prev;
      const next = new Set(prev);
      ancestors.forEach((a) => next.add(a));
      return next;
    });
    setSelected(index.get(activeId) ?? null);
  }, [activeId, index, rootId]);

  const rows = useMemo(() => flattenXml(index, rootId, expanded), [index, rootId, expanded]);
  const toggle = useCallback((row: XmlRow) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(row.id)) next.delete(row.id);
      else next.add(row.id);
      return next;
    });
  }, []);

  const renderRow = useCallback((row: XmlRow) => <XmlRowContent node={row.node} expanded={row.expanded} />, []);

  return (
    <div className="dsc-stack">
      <TreeView
        rows={rows}
        renderRow={renderRow}
        onToggle={toggle}
        activeRowId={activeId}
        matchedRowIds={matchSet}
        selectedId={selected?.id ?? null}
        onSelect={(r) => setSelected(r.node)}
        zoom={zoom}
        label={label}
      />
      <div className="dsc-inspector" aria-label="Node details">
        {selected ? (
          <>
            <div className="dsc-statusbar">
              <code className="dsc-statusbar-path">{selected.path}</code>
              <button
                type="button"
                className="dsc-link-button"
                onClick={async () => {
                  if (await copyText(selected.path)) {
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  }
                }}
              >
                {copied ? 'Copied' : 'Copy path'}
              </button>
            </div>
            {selected.attributes.length > 0 && (
              <table className="dsc-attr-table">
                <caption className="dsc-visually-hidden">Attributes</caption>
                <thead>
                  <tr>
                    <th scope="col">Attribute</th>
                    <th scope="col">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {selected.attributes.map((a) => (
                    <tr key={a.name}>
                      <td className="dsc-tok-attr">{a.name}</td>
                      <td className="dsc-tok-string">{a.value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        ) : (
          <div className="dsc-statusbar dsc-muted">Select a node to inspect its path and attributes.</div>
        )}
      </div>
    </div>
  );
}

function XmlRowContent({ node, expanded }: { node: XmlNode; expanded: boolean }) {
  switch (node.kind) {
    case 'text':
      return <span className="dsc-tok-text">{node.text}</span>;
    case 'cdata':
      return <span className="dsc-tok-cdata">{`<![CDATA[${node.text}]]>`}</span>;
    case 'comment':
      return <span className="dsc-tok-comment">{`<!-- ${node.text} -->`}</span>;
    case 'pi':
      return <span className="dsc-tok-meta">{`<?${node.name} ${node.text}?>`}</span>;
    case 'doctype':
      return <span className="dsc-tok-meta">{`<!DOCTYPE ${node.name}>`}</span>;
    default: {
      const attrs = node.attributes.slice(0, 6);
      return (
        <span>
          <span className="dsc-tok-punct">&lt;</span>
          <span className="dsc-tok-tag">{node.name}</span>
          {attrs.map((a) => (
            <span key={a.name}>
              {' '}
              <span className="dsc-tok-attr">{a.name}</span>
              <span className="dsc-tok-punct">=</span>
              <span className="dsc-tok-string">"{a.value}"</span>
            </span>
          ))}
          {node.attributes.length > attrs.length && <span className="dsc-muted"> …</span>}
          <span className="dsc-tok-punct">{node.children.length || node.text ? '>' : ' />'}</span>
          {node.text && (
            <>
              <span className="dsc-tok-text">{node.text}</span>
              <span className="dsc-tok-punct">&lt;/</span>
              <span className="dsc-tok-tag">{node.name}</span>
              <span className="dsc-tok-punct">&gt;</span>
            </>
          )}
          {node.children.length > 0 && !expanded && <span className="dsc-muted"> … </span>}
        </span>
      );
    }
  }
}
