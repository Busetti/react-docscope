import { memo } from 'react';
import type { PreviewLabels, ResolvedPreviewConfig } from '../types';
import type { PaneController } from '../hooks/usePaneController';
import { fillLabel } from '../core/format';
import { ErrorState, LoadingSkeleton, MessageState } from './states';
import { FileQuestion } from 'lucide-react';

export interface PaneViewProps {
  controller: PaneController;
  config: ResolvedPreviewConfig;
  labels: PreviewLabels;
  canDownload: boolean;
  emptyMessage?: string;
}

/** Content area of a pane: skeleton, error states or the active renderer. */
export const PaneView = memo(function PaneView({
  controller: c,
  config,
  labels,
  canDownload,
  emptyMessage,
}: PaneViewProps) {
  if (!c.document) {
    return (
      <div className="dsc-pane-content">
        <MessageState
          icon={<FileQuestion aria-hidden="true" />}
          title={emptyMessage ?? labels.noDocuments}
        />
      </div>
    );
  }
  const download = canDownload ? () => void c.actions.download() : undefined;
  if (c.status === 'unsupported') {
    return (
      <div className="dsc-pane-content">
        <ErrorState
          error={{
            code: 'UNSUPPORTED_FORMAT',
            message: fillLabel(labels.unsupportedDetail, { name: c.document.name }),
          }}
          labels={labels}
          onDownload={download}
        />
      </div>
    );
  }
  if (c.status === 'error' && c.error) {
    return (
      <div className="dsc-pane-content">
        <ErrorState
          error={c.error}
          labels={labels}
          onRetry={c.actions.retry}
          onDownload={download}
        />
      </div>
    );
  }
  const { Component, source, renderedDocument } = c;
  const showSkeleton = c.status === 'loading' || c.status === 'rendering' || c.status === 'idle';
  return (
    <div className="dsc-pane-content" aria-busy={showSkeleton}>
      {c.usingFallback && (
        <div className="dsc-banner" role="note">
          {labels.convertedNotice}
          <button type="button" className="dsc-link-button" onClick={c.actions.toggleFallback}>
            {labels.tryOriginal}
          </button>
        </div>
      )}
      {Component && source && renderedDocument && (
        <div
          className="dsc-renderer"
          data-renderer={c.definition?.id}
          data-ready={c.status === 'ready' ? 'true' : 'false'}
        >
          <Component
            key={`${renderedDocument.id}:${c.generation}`}
            document={renderedDocument}
            source={source}
            view={c.view}
            search={c.rendererSearch}
            host={c.host}
            config={config}
            signal={source.signal}
          />
        </div>
      )}
      {showSkeleton && (
        <div className="dsc-skeleton-overlay">
          <LoadingSkeleton label={`${labels.loading} ${c.document.name}`} />
        </div>
      )}
    </div>
  );
});
