import { memo } from 'react';
import type { ReactNode } from 'react';
import type {
  MetadataField,
  MetadataRenderContext,
  PreviewDocument,
  PreviewLabels,
} from '../types';
import { formatBytes, formatDate, humanizeKey } from '../core/format';
import { getExtension, getMimeType } from '../core/detect';
import type { RendererRegistry } from '../core/registry';

const LABELS: Record<string, string> = {
  type: 'Type',
  size: 'Size',
  uploadedAt: 'Uploaded',
  uploadedBy: 'Uploaded by',
  description: 'Description',
};

function defaultFormat(key: string, value: unknown): ReactNode {
  if (value === undefined || value === null || value === '') return null;
  if (key === 'size' && typeof value === 'number') return formatBytes(value);
  if (/(At|Date|Time|On)$/.test(key) && (typeof value === 'string' || typeof value === 'number'))
    return formatDate(value);
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/** Computes the rows of the metadata panel for a document. */
export function metadataRows(
  document: PreviewDocument,
  fields: Array<string | MetadataField>,
  registry: RendererRegistry,
): MetadataRenderContext['fields'] {
  const rows: MetadataRenderContext['fields'] = [];
  for (const f of fields) {
    const field: MetadataField = typeof f === 'string' ? { key: f } : f;
    let value: unknown;
    if (field.key === 'type') {
      const def = registry.resolve(document);
      const ext = getExtension(document);
      value = def
        ? `${def.label}${ext ? ` (.${ext})` : ''}`
        : getMimeType(document) || ext.toUpperCase() || undefined;
    } else if (field.key === 'name') value = document.name;
    else value = document.metadata?.[field.key];
    const rendered = field.format ? field.format(value, document) : defaultFormat(field.key, value);
    if (rendered === null || rendered === undefined || rendered === '') continue;
    rows.push({
      key: field.key,
      label: field.label ?? LABELS[field.key] ?? humanizeKey(field.key),
      value: rendered,
    });
  }
  return rows;
}

export interface MetadataPanelProps {
  document: PreviewDocument;
  fields: Array<string | MetadataField>;
  registry: RendererRegistry;
  labels: PreviewLabels;
  render?: ((ctx: MetadataRenderContext) => ReactNode) | undefined;
}

export const MetadataPanel = memo(function MetadataPanel({
  document,
  fields,
  registry,
  labels,
  render,
}: MetadataPanelProps) {
  const rows = metadataRows(document, fields, registry);
  return (
    <aside className="dsc-details" aria-label={labels.details}>
      <div className="dsc-details-title">{labels.details}</div>
      {render ? (
        render({ document, fields: rows })
      ) : (
        <dl className="dsc-details-list">
          <div className="dsc-details-row">
            <dt>Name</dt>
            <dd className="dsc-details-name">{document.name}</dd>
          </div>
          {rows.map((r) => (
            <div key={r.key} className="dsc-details-row">
              <dt>{r.label}</dt>
              <dd>{r.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </aside>
  );
});
