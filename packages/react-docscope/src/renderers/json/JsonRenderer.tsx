import { useCallback, useEffect, useMemo, useState } from 'react';
import { Copy, Check } from 'lucide-react';
import type { RendererProps } from '../../types';
import { toPreviewError } from '../../core/errors';
import { useAsync, useLatest, useLineSearch } from '../shared/hooks';
import { TextLines } from '../shared/TextLines';
import { TreeView } from '../shared/TreeView';
import { tokenizeJsonLine } from '../shared/tokenize';
import { copyText } from '../shared/clipboard';
import { splitLines } from '../text/TextRenderer';
import {
  ancestorsOf,
  defaultExpanded,
  describeJsonError,
  flattenJson,
  indexJson,
  previewOf,
  searchJson,
  type JsonRow,
} from './jsonModel';

type Parsed = { ok: true; value: unknown; pretty: string } | { ok: false; error: ReturnType<typeof describeJsonError> };

export default function JsonRenderer({ document, source, search, view, host }: RendererProps) {
  const { value: text, error } = useAsync(() => source.getText(), [source]);
  const hostRef = useLatest(host);

  const parsed = useMemo<Parsed | null>(() => {
    if (text === undefined) return null;
    try {
      const value = JSON.parse(text) as unknown;
      return { ok: true, value, pretty: JSON.stringify(value, null, 2) };
    } catch (e) {
      return { ok: false, error: describeJsonError(e, text) };
    }
  }, [text]);

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
            <strong>Invalid JSON.</strong> {parsed.error.message}
            {parsed.error.line !== undefined && ` (line ${parsed.error.line}, column ${parsed.error.column})`}
          </div>
        )}
        <RawJson
          text={parsed.ok ? parsed.pretty : text}
          search={search}
          host={host}
          zoom={view.zoom}
          label={`${document.name} (source)`}
        />
      </div>
    );
  }
  return <JsonTree value={parsed.value} search={search} host={host} zoom={view.zoom} label={document.name} />;
}

function RawJson({
  text,
  search,
  host,
  zoom,
  label,
}: {
  text: string;
  search: RendererProps['search'];
  host: RendererProps['host'];
  zoom: number;
  label: string;
}) {
  const lines = useMemo(() => splitLines(text), [text]);
  const { byLine, active } = useLineSearch(lines, search, host);
  return (
    <TextLines
      lines={lines}
      matches={byLine}
      activeMatch={active}
      activeIndex={search.activeIndex}
      zoom={zoom}
      wrap={false}
      tokenize={tokenizeJsonLine}
      label={label}
    />
  );
}

function JsonTree({
  value,
  search,
  host,
  zoom,
  label,
}: {
  value: unknown;
  search: RendererProps['search'];
  host: RendererProps['host'];
  zoom: number;
  label: string;
}) {
  const index = useMemo(() => indexJson(value), [value]);
  const [expanded, setExpanded] = useState(() => defaultExpanded(index));
  const [selected, setSelected] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const hostRef = useLatest(host);

  const matches = useMemo(() => searchJson(index, search.query, search.caseSensitive), [index, search.query, search.caseSensitive]);
  const matchSet = useMemo(() => new Set(matches), [matches]);
  const activeId = search.activeIndex >= 0 ? matches[search.activeIndex] : undefined;

  useEffect(() => {
    hostRef.current.setSearchResults(matches.length);
  }, [matches, hostRef]);

  // Reveal the active match.
  useEffect(() => {
    if (!activeId) return;
    const ancestors = ancestorsOf(index, activeId);
    setExpanded((prev) => {
      if (ancestors.every((a) => prev.has(a))) return prev;
      const next = new Set(prev);
      ancestors.forEach((a) => next.add(a));
      return next;
    });
  }, [activeId, index]);

  const rows = useMemo(() => flattenJson(index, expanded), [index, expanded]);
  const toggle = useCallback((row: JsonRow) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(row.id)) next.delete(row.id);
      else next.add(row.id);
      return next;
    });
  }, []);

  const onCopy = useCallback(async (path: string) => {
    if (await copyText(path)) {
      setCopied(path);
      setTimeout(() => setCopied((c) => (c === path ? null : c)), 1500);
    }
  }, []);

  const renderRow = useCallback(
    (row: JsonRow) => {
      const n = row.node;
      return (
        <>
          {n.key !== null && (
            <>
              <span className={typeof n.key === 'number' ? 'dsc-tok-index' : 'dsc-tok-key'}>
                {typeof n.key === 'number' ? n.key : JSON.stringify(n.key)}
              </span>
              <span className="dsc-tok-punct">:&nbsp;</span>
            </>
          )}
          <span className={`dsc-tok-${n.kind === 'object' || n.kind === 'array' ? 'meta' : n.kind}`}>{previewOf(n)}</span>
          <button
            type="button"
            className="dsc-tree-action"
            tabIndex={-1}
            aria-label={`Copy path ${n.id}`}
            title={`Copy path ${n.id}`}
            onClick={(e) => {
              e.stopPropagation();
              void onCopy(n.id);
            }}
          >
            {copied === n.id ? <Check size="1em" aria-hidden="true" /> : <Copy size="1em" aria-hidden="true" />}
          </button>
        </>
      );
    },
    [copied, onCopy],
  );

  return (
    <div className="dsc-stack">
      <TreeView
        rows={rows}
        renderRow={renderRow}
        onToggle={toggle}
        activeRowId={activeId}
        matchedRowIds={matchSet}
        selectedId={selected}
        onSelect={(r) => setSelected(r.id)}
        zoom={zoom}
        label={label}
      />
      <div className="dsc-statusbar" aria-live="polite">
        <span className="dsc-statusbar-path">{selected ?? '$'}</span>
        <button type="button" className="dsc-link-button" onClick={() => void onCopy(selected ?? '$')}>
          {copied === (selected ?? '$') ? 'Copied' : 'Copy path'}
        </button>
        <button type="button" className="dsc-link-button" onClick={() => setExpanded(new Set(index.keys()))}>
          Expand all
        </button>
        <button type="button" className="dsc-link-button" onClick={() => setExpanded(new Set(['$']))}>
          Collapse all
        </button>
      </div>
    </div>
  );
}
