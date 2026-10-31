import { memo, useEffect, useMemo, useRef } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';

export interface GridCell {
  text: string;
  style?: CSSProperties;
  title?: string;
}

export interface GridMerge {
  r1: number;
  c1: number;
  r2: number;
  c2: number;
}

export interface DataGridProps {
  rowCount: number;
  colCount: number;
  getCell: (row: number, col: number) => GridCell | undefined;
  colHeader: (col: number) => string;
  rowHeader?: (row: number) => string;
  colWidth?: (col: number) => number;
  rowHeight?: (row: number) => number;
  merges?: GridMerge[];
  /** Keys `row:col` of matching cells. */
  matches?: Set<string>;
  activeCell?: { row: number; col: number } | undefined;
  zoom: number;
  label: string;
  /** Applied to the scroll container (font for xlsx). */
  className?: string;
}

const DEFAULT_COL = 120;
const DEFAULT_ROW = 26;
const HEADER_H = 26;

/** Read-only 2D virtualized grid with sticky row / column headers and merged cells. */
export const DataGrid = memo(function DataGrid({
  rowCount,
  colCount,
  getCell,
  colHeader,
  rowHeader = (r) => String(r + 1),
  colWidth = () => DEFAULT_COL,
  rowHeight = () => DEFAULT_ROW,
  merges = [],
  matches,
  activeCell,
  zoom,
  label,
  className,
}: DataGridProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const rowHeaderW = Math.round(Math.max(44, String(rowCount).length * 9 + 20) * zoom);
  const headerH = Math.round(HEADER_H * zoom);

  const rows = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => rowHeight(i) * zoom,
    overscan: 10,
    initialRect: { width: 1000, height: 600 },
  });
  const cols = useVirtualizer({
    horizontal: true,
    count: colCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => colWidth(i) * zoom,
    overscan: 4,
    initialRect: { width: 1000, height: 600 },
  });

  useEffect(() => {
    rows.measure();
    cols.measure();
  }, [zoom, rows, cols, colWidth, rowHeight]);

  useEffect(() => {
    if (!activeCell) return;
    rows.scrollToIndex(activeCell.row, { align: 'center' });
    cols.scrollToIndex(activeCell.col, { align: 'center' });
  }, [activeCell, rows, cols]);

  // Cells covered by a merge (excluding its anchor) are skipped.
  const covered = useMemo(() => {
    const set = new Set<string>();
    for (const m of merges) {
      for (let r = m.r1; r <= m.r2; r += 1) {
        for (let c = m.c1; c <= m.c2; c += 1) if (r !== m.r1 || c !== m.c1) set.add(`${r}:${c}`);
      }
    }
    return set;
  }, [merges]);
  const mergeByAnchor = useMemo(() => new Map(merges.map((m) => [`${m.r1}:${m.c1}`, m])), [merges]);

  const vRows = rows.getVirtualItems();
  const vCols = cols.getVirtualItems();
  const totalW = cols.getTotalSize();
  const totalH = rows.getTotalSize();
  const firstRow = vRows[0]?.index ?? 0;
  const lastRow = vRows[vRows.length - 1]?.index ?? -1;
  const firstCol = vCols[0]?.index ?? 0;
  const lastCol = vCols[vCols.length - 1]?.index ?? -1;

  const offsetOf = (v: typeof rows, index: number) => {
    const m = v.measurementsCache[index];
    return m ? { start: m.start, size: m.size } : { start: 0, size: 0 };
  };

  const renderCell = (r: number, c: number, merge?: GridMerge) => {
    const rr = offsetOf(rows, r);
    const cc = offsetOf(cols, c);
    let width = cc.size;
    let height = rr.size;
    if (merge) {
      width = offsetOf(cols, merge.c2).start + offsetOf(cols, merge.c2).size - cc.start;
      height = offsetOf(rows, merge.r2).start + offsetOf(rows, merge.r2).size - rr.start;
    }
    const cell = getCell(r, c);
    const key = `${r}:${c}`;
    const cls = ['dsc-cell'];
    if (merge) cls.push('dsc-cell--merged');
    if (matches?.has(key)) cls.push('dsc-cell--match');
    if (activeCell?.row === r && activeCell?.col === c) cls.push('dsc-cell--active');
    return (
      <div
        key={key}
        role="gridcell"
        aria-colindex={c + 2}
        className={cls.join(' ')}
        title={cell?.title ?? (cell?.text && cell.text.length > 12 ? cell.text : undefined)}
        style={{ ...cell?.style, left: cc.start + rowHeaderW, width, height }}
      >
        {cell?.text}
      </div>
    );
  };

  // Rows to render: visible rows plus anchor rows of merges intersecting the viewport.
  const rowSet = new Map<number, GridMerge[]>();
  for (const vr of vRows) rowSet.set(vr.index, []);
  for (const m of merges) {
    const intersects = m.r2 >= firstRow && m.r1 <= lastRow && m.c2 >= firstCol && m.c1 <= lastCol;
    if (!intersects) continue;
    const list = rowSet.get(m.r1) ?? [];
    list.push(m);
    rowSet.set(m.r1, list);
  }
  const rowIndexes = [...rowSet.keys()].sort((a, b) => a - b);
  return (
    <div
      ref={scrollRef}
      className={`dsc-scroll dsc-grid ${className ?? ''}`}
      data-dsc-scroll-container=""
      role="grid"
      aria-label={label}
      aria-rowcount={rowCount + 1}
      aria-colcount={colCount + 1}
      aria-readonly="true"
      tabIndex={0}
      style={{ fontSize: `${12.5 * zoom}px`, ['--dsc-grid-header-h' as string]: `${headerH}px` }}
    >
      <div className="dsc-grid-canvas" style={{ width: totalW + rowHeaderW, height: totalH + headerH }}>
        <div className="dsc-grid-colheaders" role="row" aria-rowindex={1} style={{ height: headerH, width: totalW + rowHeaderW }}>
          <div className="dsc-grid-corner" style={{ width: rowHeaderW, height: headerH }} />
          {vCols.map((vc) => (
            <div
              key={vc.key}
              role="columnheader"
              aria-colindex={vc.index + 2}
              className="dsc-grid-colheader"
              style={{ left: vc.start + rowHeaderW, width: vc.size, height: headerH }}
            >
              {colHeader(vc.index)}
            </div>
          ))}
        </div>
        <div className="dsc-grid-body" style={{ height: totalH, width: totalW + rowHeaderW }}>
          {rowIndexes.map((r) => {
            const rr = offsetOf(rows, r);
            const rowMerges = rowSet.get(r)!;
            const cells: ReactNode[] = [];
            const done = new Set<number>();
            for (const vc of vCols) {
              const key = `${r}:${vc.index}`;
              if (covered.has(key)) continue;
              done.add(vc.index);
              cells.push(renderCell(r, vc.index, mergeByAnchor.get(key)));
            }
            for (const m of rowMerges) if (!done.has(m.c1)) cells.push(renderCell(r, m.c1, m));
            return (
              <div
                key={r}
                role="row"
                aria-rowindex={r + 2}
                className="dsc-grid-row"
                style={{ top: rr.start, height: rr.size, width: totalW + rowHeaderW }}
              >
                <div role="rowheader" className="dsc-grid-rowheader" style={{ width: rowHeaderW, height: rr.size }}>
                  {rowHeader(r)}
                </div>
                {cells}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
});

/** Excel-style column label: 0 → A, 25 → Z, 26 → AA. */
export function columnLabel(index: number): string {
  let n = index + 1;
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}
