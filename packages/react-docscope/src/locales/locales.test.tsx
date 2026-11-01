import { render, screen } from '@testing-library/react';
import { de, en, es, fr, hi } from '.';
import { DocumentPreviewer } from '../components/DocumentPreviewer';
import { resolveConfig } from '../core/config';
import { fillLabel } from '../core/format';
import type { PreviewLabels } from '../types';

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

/** Flattens grouped labels to "group.key" → string. */
function flatten(labels: PreviewLabels): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(labels)) {
    if (typeof v === 'string') out[k] = v;
    else if (v) for (const [k2, v2] of Object.entries(v)) out[`${k}.${k2}`] = String(v2);
  }
  return out;
}

describe.each([
  ['de', de],
  ['es', es],
  ['fr', fr],
  ['hi', hi],
])('%s locale', (_name, pack) => {
  const ref = flatten(en);
  const flat = flatten(pack);

  it('translates every English label', () => {
    for (const key of Object.keys(ref)) {
      expect(flat[key]?.trim()).toBeTruthy();
    }
  });

  it('keeps the placeholders of every label', () => {
    for (const [key, value] of Object.entries(ref)) {
      expect([key, placeholders(flat[key]!)]).toEqual([key, placeholders(value)]);
    }
  });

  it('localizes every error code', () => {
    expect(Object.keys(pack.errorMessages ?? {}).sort()).toEqual(
      Object.keys(en.errorTitles).sort(),
    );
  });
});

describe('labels config', () => {
  it('merges grouped labels one level deep', () => {
    const labels = resolveConfig(
      { labels: { chartTypes: { bar: 'Bars' } } },
      { labels: { errorTitles: { NOT_FOUND: 'Gone' }, download: 'Save' } },
    ).labels;
    expect(labels.chartTypes).toEqual({ ...en.chartTypes, bar: 'Bars' });
    expect(labels.errorTitles.NOT_FOUND).toBe('Gone');
    expect(labels.errorTitles.ACCESS_DENIED).toBe(en.errorTitles.ACCESS_DENIED);
    expect(labels.download).toBe('Save');
  });

  it('ignores undefined overrides and adds groups the base lacks', () => {
    const labels = resolveConfig({
      labels: { download: undefined, errorMessages: { NOT_FOUND: 'Nope' } },
    }).labels;
    expect(labels.download).toBe(en.download);
    expect(labels.errorMessages).toEqual({ NOT_FOUND: 'Nope' });
  });

  it('fills placeholders and keeps unknown ones visible', () => {
    expect(fillLabel('Page {page} of {count}', { page: 2, count: 9 })).toBe('Page 2 of 9');
    expect(fillLabel('{missing} x', {})).toBe('{missing} x');
  });

  it('renders the workspace and error states in German', async () => {
    render(
      <DocumentPreviewer
        documents={[{ id: 'a', name: 'a.pdf' }]}
        resolver={async () => {
          throw new Error('backend down');
        }}
        config={{ labels: de }}
      />,
    );
    expect(await screen.findByText('Dokument kann nicht geöffnet werden')).toBeTruthy();
    expect(
      screen.getByText('Der Speicherort des Dokuments konnte nicht ermittelt werden.'),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Erneut versuchen' })).toBeTruthy();
  });
});
