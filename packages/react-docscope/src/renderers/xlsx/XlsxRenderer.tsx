import { useCallback, useEffect, useMemo, useState } from 'react';
import type { RendererProps } from '../../types';
import { toPreviewError } from '../../core/errors';
import { textIncludes } from '../../core/search';
import { useAsync, useLatest } from '../shared/hooks';
import { DataGrid, columnLabel } from '../shared/DataGrid';
import type { XlsxSheet } from './xlsxReader';
import { openWorkbook, type AsyncWorkbook } from '../shared/worker/client';

/**
 * Strictly read-only workbook preview. There is intentionally no editing,
 * formula evaluation or save path: formula cells show their cached results.
 */
export default function XlsxRenderer({
  document,
  source,
  search,
  view,
  host,
  config,
}: RendererProps) {
  const hostRef = useLatest(host);
  const useWorker = config.workers;
  const { value: workbook, error } = useAsync<AsyncWorkbook>(async () => {
    const buf = await source.getArrayBuffer();
    // Yield so the loading skeleton paints before (possibly synchronous) parsing.
    await new Promise((r) => setTimeout(r, 0));
    return openWorkbook(buf, useWorker);
  }, [source, useWorker]);
  useEffect(() => () => workbook?.close(), [workbook]);

  const visible = useMemo(
    () =>
      workbook
        ? workbook.sheets.map((s, i) => ({ ...s, index: i })).filter((s) => s.state === 'visible')
        : [],
    [workbook],
  );
  const [sheetIndex, setSheetIndex] = useState<number | null>(null);
  const activeIndex = sheetIndex ?? visible[0]?.index ?? 0;

  const [sheetResult, setSheetResult] = useState<{
    sheet?: XlsxSheet;
    error?: unknown;
  }>({});
  useEffect(() => {
    if (!workbook) return;
    let live = true;
    workbook.readSheet(activeIndex).then(
      (sheet) => live && setSheetResult({ sheet }),
      (e: unknown) => live && setSheetResult({ error: e }),
    );
    return () => {
      live = false;
    };
  }, [workbook, activeIndex]);

  useEffect(() => {
    const err = error ?? sheetResult.error;
    if (err) {
      const isData = err instanceof Error && /xlsx|workbook|sheet|xml/i.test(err.message);
      const e = toPreviewError(err, isData ? 'MALFORMED_DOCUMENT' : 'FETCH_FAILED');
      hostRef.current.setError(isData ? 'MALFORMED_DOCUMENT' : e.code, e.message);
    } else if (sheetResult.sheet) hostRef.current.setReady();
  }, [error, sheetResult, hostRef]);

  const sheet = sheetResult.sheet;
  const matches = useMemo(() => {
    if (!sheet || !search.query.trim()) return [];
    const out: Array<{ row: number; col: number }> = [];
    const rowKeys = [...sheet.rows.keys()].sort((a, b) => a - b);
    for (const r of rowKeys) {
      const row = sheet.rows.get(r)!;
      const colKeys = [...row.keys()].sort((a, b) => a - b);
      for (const c of colKeys) {
        if (textIncludes(row.get(c)!.text, search.query, search.caseSensitive))
          out.push({ row: r, col: c });
        if (out.length >= 10_000) return out;
      }
    }
    return out;
  }, [sheet, search.query, search.caseSensitive]);
  const matchSet = useMemo(() => new Set(matches.map((m) => `${m.row}:${m.col}`)), [matches]);
  useEffect(() => {
    hostRef.current.setSearchResults(matches.length);
  }, [matches, hostRef]);
  const active = search.activeIndex >= 0 ? matches[search.activeIndex] : undefined;

  const getCell = useCallback(
    (r: number, c: number) => {
      const cell = sheet?.rows.get(r)?.get(c);
      if (!cell) return undefined;
      return {
        text: cell.text,
        ...(cell.style ? { style: cell.style } : {}),
        ...(cell.formula ? { title: `=${cell.formula}${cell.text ? ` → ${cell.text}` : ''}` } : {}),
      };
    },
    [sheet],
  );
  const colWidth = useCallback(
    (c: number) => sheet?.colWidths.get(c) ?? sheet?.defaultColWidth ?? 64,
    [sheet],
  );
  const rowHeight = useCallback(
    (r: number) => sheet?.rowHeights.get(r) ?? sheet?.defaultRowHeight ?? 20,
    [sheet],
  );

  if (!workbook || !sheet) return null;
  const hiddenCount = workbook.sheets.length - visible.length;
  return (
    <div className="dsc-stack">
      <DataGrid
        key={activeIndex}
        rowCount={sheet.rowCount}
        colCount={sheet.colCount}
        getCell={getCell}
        colHeader={columnLabel}
        colWidth={colWidth}
        rowHeight={rowHeight}
        merges={sheet.merges}
        matches={matchSet}
        activeCell={active}
        zoom={view.zoom}
        label={`${document.name} — ${sheet.name}`}
        className="dsc-grid--xlsx"
      />
      <div className="dsc-sheet-tabs" role="tablist" aria-label="Worksheets">
        {visible.map((s) => (
          <button
            key={s.index}
            type="button"
            role="tab"
            aria-selected={s.index === activeIndex}
            className="dsc-sheet-tab"
            onClick={() => setSheetIndex(s.index)}
          >
            {s.name}
          </button>
        ))}
        {hiddenCount > 0 && (
          <span className="dsc-muted dsc-sheet-hidden">
            {hiddenCount} hidden {hiddenCount === 1 ? 'sheet' : 'sheets'}
          </span>
        )}
        <span className="dsc-sheet-readonly">Read-only</span>
      </div>
    </div>
  );
}
