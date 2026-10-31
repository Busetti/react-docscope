import { useCallback, useEffect, useMemo } from 'react';
import type { RendererProps } from '../../types';
import { toPreviewError } from '../../core/errors';
import { useAsync, useLineSearch } from '../shared/hooks';
import { TextLines } from '../shared/TextLines';

export function splitLines(text: string): string[] {
  const lines = text.split(/\r\n|\r|\n/);
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

export default function TextRenderer({ document, source, search, view, host }: RendererProps) {
  const { value: text, error } = useAsync(() => source.getText(), [source]);
  const lines = useMemo(() => (text === undefined ? [] : splitLines(text)), [text]);
  const { byLine, active } = useLineSearch(lines, search, host);
  const onReady = useCallback(() => {
    if (text !== undefined) host.setReady();
  }, [host, text]);

  useEffect(() => {
    if (error) {
      const e = toPreviewError(error, 'FETCH_FAILED');
      host.setError(e.code, e.message);
    }
  }, [error, host]);

  if (text === undefined) return null;
  return (
    <TextLines
      lines={lines}
      matches={byLine}
      activeMatch={active}
      activeIndex={search.activeIndex}
      zoom={view.zoom}
      wrap
      label={document.name}
      onReady={onReady}
    />
  );
}
