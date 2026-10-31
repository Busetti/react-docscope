import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Papa from 'papaparse';
import type { RendererProps } from '../../types';
import { getExtension } from '../../core/detect';
import { toPreviewError } from '../../core/errors';
import { formatBytes } from '../../core/format';
import { useLatest } from '../shared/hooks';
import { DataGrid, columnLabel } from '../shared/DataGrid';
import { delimiterLabel, detectHeader, looksNumeric, searchRows } from './csvModel';

interface ParseState {
  rows: string[][];
  done: boolean;
  delimiter: string;
  colCount: number;
  truncated: boolean;
  /** Header detected from the first rows (computed once). */
  autoHeader: boolean;
  /** Character-width estimates per column from the first rows (computed once). */
  sampleWidths: number[];
}

function sampleWidths(rows: string[][], colCount: number): number[] {
  const widths = new Array<number>(colCount).fill(4);
  for (let r = 0; r < Math.min(rows.length, 101); r += 1) {
    const row = rows[r]!;
    for (let c = 0; c < row.length; c += 1) widths[c] = Math.max(widths[c]!, row[c]!.length);
  }
  return widths;
}

const MAX_ROWS = 2_000_000;
const NUMERIC_STYLE = { justifyContent: 'flex-end' } as const;

export default function CsvRenderer({
  document,
  source,
  search,
  view,
  host,
  config,
}: RendererProps) {
  const hostRef = useLatest(host);
  const [state, setState] = useState<ParseState>({
    rows: [],
    done: false,
    delimiter: ',',
    colCount: 0,
    truncated: false,
    autoHeader: false,
    sampleWidths: [],
  });
  const [headerOverride, setHeaderOverride] = useState<boolean | null>(null);
  const rowsRef = useRef<string[][]>([]);

  useEffect(() => {
    let cancelled = false;
    let parser: Papa.Parser | null = null;
    rowsRef.current = [];
    const ext = getExtension(document);
    const configured =
      config.csv.delimiter ??
      (ext === 'tsv' || ext === 'tab' || source.mimeType === 'text/tab-separated-values'
        ? '\t'
        : '');
    let colCount = 0;
    let lastFlush = 0;
    let delimiter = configured || ',';
    let truncated = false;
    let autoHeader: boolean | null = null;
    let widths: number[] | null = null;

    const flush = (done: boolean) => {
      if (cancelled) return;
      const rows = rowsRef.current;
      if (autoHeader === null || rows.length <= 101) autoHeader = detectHeader(rows.slice(0, 50));
      if (widths === null || rows.length <= 101 || widths.length < colCount)
        widths = sampleWidths(rows, colCount);
      setState({ rows, done, delimiter, colCount, truncated, autoHeader, sampleWidths: widths });
    };

    source
      .getBlob()
      .then((blob) => {
        if (cancelled) return;
        if (blob.size === 0) {
          hostRef.current.setError('EMPTY_DOCUMENT', 'This CSV file is empty.');
          return;
        }
        // Papa Parse detects inputs via `instanceof File`; wrapping is free (no copy).
        const input =
          typeof File !== 'undefined' && !(blob instanceof File)
            ? new File([blob], document.name, { type: blob.type })
            : (blob as File);
        Papa.parse<string[]>(input, {
          delimiter: configured,
          skipEmptyLines: 'greedy',
          chunkSize: 1024 * 512,
          chunk: (results, p) => {
            parser = p;
            if (cancelled) {
              p.abort();
              return;
            }
            delimiter = results.meta.delimiter || delimiter;
            for (const row of results.data) {
              if (rowsRef.current.length >= MAX_ROWS) {
                truncated = true;
                p.abort();
                break;
              }
              if (row.length > colCount) colCount = row.length;
              rowsRef.current.push(row);
            }
            // Render the first chunk immediately, then at most ~4 times a second.
            const now = Date.now();
            if (rowsRef.current.length && (lastFlush === 0 || now - lastFlush > 250)) {
              lastFlush = now;
              rowsRef.current = rowsRef.current.slice();
              flush(false);
              hostRef.current.setReady();
            }
          },
          complete: () => {
            rowsRef.current = rowsRef.current.slice();
            flush(true);
            if (rowsRef.current.length === 0)
              hostRef.current.setError('EMPTY_DOCUMENT', 'This CSV file has no rows.');
            else hostRef.current.setReady();
          },
          error: (err) => {
            if (!cancelled)
              hostRef.current.setError(
                'MALFORMED_DOCUMENT',
                err.message || 'The CSV file could not be parsed.',
              );
          },
        });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const e = toPreviewError(error, 'FETCH_FAILED');
        hostRef.current.setError(e.code, e.message);
      });
    return () => {
      cancelled = true;
      (parser as Papa.Parser | null)?.abort();
    };
  }, [source, document, config.csv.delimiter, hostRef]);

  const configuredHeader = config.csv.header;
  const hasHeader =
    headerOverride ?? (configuredHeader === 'auto' ? state.autoHeader : configuredHeader);
  const startRow = hasHeader ? 1 : 0;
  const header = hasHeader ? state.rows[0] : undefined;

  const matches = useMemo(
    () => searchRows(state.rows, startRow, search.query, search.caseSensitive),
    [state.rows, startRow, search.query, search.caseSensitive],
  );
  const matchSet = useMemo(() => new Set(matches.map((m) => `${m.row}:${m.col}`)), [matches]);
  useEffect(() => {
    hostRef.current.setSearchResults(matches.length);
  }, [matches, hostRef]);
  const active = search.activeIndex >= 0 ? matches[search.activeIndex] : undefined;

  const getCell = useCallback(
    (r: number, c: number) => {
      const v = state.rows[r + startRow]?.[c];
      if (v === undefined) return undefined;
      return looksNumeric(v) ? { text: v, style: NUMERIC_STYLE } : { text: v };
    },
    [state.rows, startRow],
  );
  const colHeader = useCallback(
    (c: number) => (header?.[c]?.trim() ? header[c]! : columnLabel(c)),
    [header],
  );
  const widths = state.sampleWidths;
  const colWidth = useCallback(
    (c: number) => Math.min(360, Math.max(72, ((widths[c] ?? 4) + 2) * 8 + 16)),
    [widths],
  );

  if (!state.rows.length) return null;
  const dataRows = Math.max(0, state.rows.length - startRow);
  return (
    <div className="dsc-stack">
      <DataGrid
        rowCount={dataRows}
        colCount={state.colCount}
        getCell={getCell}
        colHeader={colHeader}
        colWidth={colWidth}
        matches={matchSet}
        activeCell={active}
        zoom={view.zoom}
        label={document.name}
      />
      <div className="dsc-statusbar" aria-live="polite">
        <span>
          {dataRows.toLocaleString()} rows · {state.colCount} columns ·{' '}
          {delimiterLabel(state.delimiter)} delimited
          {source.size ? ` · ${formatBytes(source.size)}` : ''}
          {!state.done && ' · loading…'}
          {state.truncated && ` · showing first ${MAX_ROWS.toLocaleString()} rows`}
        </span>
        <label className="dsc-checkbox">
          <input
            type="checkbox"
            checked={hasHeader}
            onChange={(e) => setHeaderOverride(e.target.checked)}
          />
          First row is header
        </label>
      </div>
    </div>
  );
}
