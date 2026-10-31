import { memo, useEffect, useRef } from 'react';
import type { KeyboardEvent } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { PreviewDocument, PreviewLabels } from '../types';
import type { RendererRegistry } from '../core/registry';
import { formatBytes } from '../core/format';
import { getExtension } from '../core/detect';
import { FileIcon } from './fileIcons';

export interface SidebarProps {
  documents: PreviewDocument[];
  activeId: string | null;
  onSelect: (id: string) => void;
  registry: RendererRegistry;
  labels: PreviewLabels;
}

const ITEM_H = 52;

/** Attachment list. Virtualized so thousands of attachments stay cheap. */
export const Sidebar = memo(function Sidebar({
  documents,
  activeId,
  onSelect,
  registry,
  labels,
}: SidebarProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: documents.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ITEM_H,
    overscan: 8,
    initialRect: { width: 240, height: 600 },
  });
  const activeIndex = documents.findIndex((d) => d.id === activeId);

  useEffect(() => {
    if (activeIndex >= 0) virtualizer.scrollToIndex(activeIndex, { align: 'auto' });
  }, [activeIndex, virtualizer]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    let next = -1;
    if (e.key === 'ArrowDown') next = Math.min(documents.length - 1, activeIndex + 1);
    else if (e.key === 'ArrowUp') next = Math.max(0, activeIndex - 1);
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = documents.length - 1;
    if (next < 0) return;
    e.preventDefault();
    onSelect(documents[next]!.id);
    requestAnimationFrame(() =>
      scrollRef.current?.querySelector<HTMLElement>(`[data-doc-index="${next}"]`)?.focus(),
    );
  };

  return (
    <aside className="dsc-sidebar" aria-label={labels.attachments}>
      <div className="dsc-sidebar-title">
        {labels.attachments} <span className="dsc-badge">{documents.length}</span>
      </div>
      <div
        ref={scrollRef}
        className="dsc-sidebar-list"
        role="listbox"
        aria-label={labels.attachments}
        onKeyDown={onKeyDown}
      >
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
          {virtualizer.getVirtualItems().map((item) => {
            const doc = documents[item.index]!;
            const active = doc.id === activeId;
            const meta = [getExtension(doc).toUpperCase(), formatBytes(doc.metadata?.size)]
              .filter(Boolean)
              .join(' · ');
            return (
              <div
                key={doc.id}
                role="option"
                aria-selected={active}
                tabIndex={active || (activeIndex < 0 && item.index === 0) ? 0 : -1}
                data-doc-index={item.index}
                className={`dsc-sidebar-item${active ? ' dsc-sidebar-item--active' : ''}`}
                style={{ transform: `translateY(${item.start}px)`, height: ITEM_H }}
                onClick={() => onSelect(doc.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelect(doc.id);
                  }
                }}
                title={doc.name}
              >
                <FileIcon document={doc} registry={registry} />
                <span className="dsc-sidebar-text">
                  <span className="dsc-sidebar-name">{doc.name}</span>
                  {meta && <span className="dsc-sidebar-meta">{meta}</span>}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </aside>
  );
});
