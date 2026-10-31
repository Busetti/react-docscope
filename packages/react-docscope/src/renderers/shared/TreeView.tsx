import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ChevronRight } from 'lucide-react';

export interface FlatTreeRow {
  id: string;
  depth: number;
  hasChildren: boolean;
  expanded: boolean;
  parentId: string | null;
}

export interface TreeViewProps<R extends FlatTreeRow> {
  rows: R[];
  renderRow: (row: R) => ReactNode;
  onToggle: (row: R) => void;
  /** Row index to scroll to and mark active (search). */
  activeRowId?: string | undefined;
  matchedRowIds?: Set<string>;
  selectedId?: string | null;
  onSelect?: (row: R) => void;
  zoom: number;
  label: string;
}

/** Virtualized, keyboard-accessible tree (WAI-ARIA tree pattern with aria-activedescendant). */
export function TreeView<R extends FlatTreeRow>({
  rows,
  renderRow,
  onToggle,
  activeRowId,
  matchedRowIds,
  selectedId,
  onSelect,
  zoom,
  label,
}: TreeViewProps<R>) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const baseId = useId();
  const [focusIndex, setFocusIndex] = useState(0);
  const rowHeight = Math.round(24 * zoom);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: 15,
    initialRect: { width: 800, height: 600 },
  });

  useEffect(() => {
    virtualizer.measure();
  }, [rowHeight, virtualizer]);

  useEffect(() => {
    if (!activeRowId) return;
    const idx = rows.findIndex((r) => r.id === activeRowId);
    if (idx >= 0) {
      virtualizer.scrollToIndex(idx, { align: 'center' });
      setFocusIndex(idx);
    }
  }, [activeRowId, rows, virtualizer]);

  const focusRow = useCallback(
    (index: number) => {
      const i = Math.max(0, Math.min(rows.length - 1, index));
      setFocusIndex(i);
      virtualizer.scrollToIndex(i, { align: 'auto' });
    },
    [rows.length, virtualizer],
  );

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const row = rows[focusIndex];
    if (!row) return;
    switch (e.key) {
      case 'ArrowDown':
        focusRow(focusIndex + 1);
        break;
      case 'ArrowUp':
        focusRow(focusIndex - 1);
        break;
      case 'Home':
        focusRow(0);
        break;
      case 'End':
        focusRow(rows.length - 1);
        break;
      case 'ArrowRight':
        if (row.hasChildren && !row.expanded) onToggle(row);
        else if (row.hasChildren) focusRow(focusIndex + 1);
        break;
      case 'ArrowLeft':
        if (row.hasChildren && row.expanded) onToggle(row);
        else if (row.parentId) focusRow(rows.findIndex((r) => r.id === row.parentId));
        break;
      case 'Enter':
      case ' ':
        if (row.hasChildren) onToggle(row);
        onSelect?.(row);
        break;
      default:
        return;
    }
    e.preventDefault();
  };

  const focused = rows[focusIndex];
  return (
    <div
      ref={scrollRef}
      className="dsc-scroll dsc-tree"
      data-dsc-scroll-container=""
      role="tree"
      aria-label={label}
      tabIndex={0}
      aria-activedescendant={focused ? `${baseId}-${focusIndex}` : undefined}
      onKeyDown={onKeyDown}
      style={{ fontSize: `${13 * zoom}px` }}
    >
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative', minWidth: '100%' }}>
        {virtualizer.getVirtualItems().map((item) => {
          const row = rows[item.index]!;
          const classes = ['dsc-tree-row'];
          if (item.index === focusIndex) classes.push('dsc-tree-row--focused');
          if (row.id === selectedId) classes.push('dsc-tree-row--selected');
          if (matchedRowIds?.has(row.id)) classes.push('dsc-tree-row--match');
          if (row.id === activeRowId) classes.push('dsc-tree-row--active-match');
          return (
            <div
              key={row.id}
              id={`${baseId}-${item.index}`}
              role="treeitem"
              aria-level={row.depth + 1}
              aria-expanded={row.hasChildren ? row.expanded : undefined}
              aria-selected={row.id === selectedId}
              className={classes.join(' ')}
              style={{
                transform: `translateY(${item.start}px)`,
                height: rowHeight,
                paddingInlineStart: `${row.depth * 1.25 + 0.25}em`,
              }}
              onClick={() => {
                setFocusIndex(item.index);
                onSelect?.(row);
              }}
            >
              {row.hasChildren ? (
                <button
                  type="button"
                  className="dsc-tree-toggle"
                  tabIndex={-1}
                  aria-label={row.expanded ? 'Collapse' : 'Expand'}
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggle(row);
                  }}
                >
                  <ChevronRight
                    size="1em"
                    aria-hidden="true"
                    data-expanded={row.expanded ? 'true' : 'false'}
                  />
                </button>
              ) : (
                <span className="dsc-tree-toggle-spacer" />
              )}
              {renderRow(row)}
            </div>
          );
        })}
      </div>
    </div>
  );
}
