import type { ReactNode } from 'react';
import {
  Download,
  FileQuestion,
  FileX2,
  RefreshCw,
  ShieldAlert,
  TriangleAlert,
} from 'lucide-react';
import type { PreviewError, PreviewLabels } from '../types';

export function LoadingSkeleton({ label }: { label: string }) {
  return (
    <div className="dsc-skeleton" role="status" aria-live="polite" aria-label={label}>
      <div className="dsc-skeleton-page">
        <div className="dsc-skeleton-line dsc-skeleton-line--title" />
        <div className="dsc-skeleton-line" />
        <div className="dsc-skeleton-line" />
        <div className="dsc-skeleton-line dsc-skeleton-line--short" />
        <div className="dsc-skeleton-block" />
        <div className="dsc-skeleton-line" />
        <div className="dsc-skeleton-line dsc-skeleton-line--short" />
      </div>
      <span className="dsc-visually-hidden">{label}…</span>
    </div>
  );
}

export interface MessageStateProps {
  icon?: ReactNode;
  title: string;
  message?: ReactNode;
  actions?: ReactNode;
  tone?: 'neutral' | 'error' | 'warning';
}

export function MessageState({
  icon,
  title,
  message,
  actions,
  tone = 'neutral',
}: MessageStateProps) {
  return (
    <div className={`dsc-state dsc-state--${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      {icon && <div className="dsc-state-icon">{icon}</div>}
      <h3 className="dsc-state-title">{title}</h3>
      {message && <p className="dsc-state-message">{message}</p>}
      {actions && <div className="dsc-state-actions">{actions}</div>}
    </div>
  );
}

export function ErrorState({
  error,
  labels,
  onRetry,
  onDownload,
}: {
  error: PreviewError;
  labels: PreviewLabels;
  onRetry?: (() => void) | undefined;
  onDownload?: (() => void) | undefined;
}) {
  const neutral =
    error.code === 'EMPTY_DOCUMENT' ||
    error.code === 'UNSUPPORTED_FORMAT' ||
    error.code === 'TOO_LARGE';
  const icon =
    error.code === 'ACCESS_DENIED' || error.code === 'PASSWORD_REQUIRED' ? (
      <ShieldAlert aria-hidden="true" />
    ) : error.code === 'UNSUPPORTED_FORMAT' ? (
      <FileQuestion aria-hidden="true" />
    ) : error.code === 'MALFORMED_DOCUMENT' || error.code === 'EMPTY_DOCUMENT' ? (
      <FileX2 aria-hidden="true" />
    ) : (
      <TriangleAlert aria-hidden="true" />
    );
  const retryable = ![
    'UNSUPPORTED_FORMAT',
    'EMPTY_DOCUMENT',
    'MALFORMED_DOCUMENT',
    'TOO_LARGE',
  ].includes(error.code);
  return (
    <MessageState
      tone={neutral ? 'neutral' : 'error'}
      icon={icon}
      title={labels.errorTitles[error.code]}
      message={labels.errorMessages?.[error.code] ?? error.message}
      actions={
        <>
          {retryable && onRetry && (
            <button type="button" className="dsc-action" onClick={onRetry}>
              <RefreshCw aria-hidden="true" size={16} /> {labels.retry}
            </button>
          )}
          {onDownload && (
            <button
              type="button"
              className={retryable && onRetry ? 'dsc-action dsc-action--secondary' : 'dsc-action'}
              onClick={onDownload}
            >
              <Download aria-hidden="true" size={16} /> {labels.download}
            </button>
          )}
        </>
      }
    />
  );
}
