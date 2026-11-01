import Papa from 'papaparse';

export interface CsvParseOptions {
  /** Empty string = auto-detect. */
  delimiter: string;
  maxRows: number;
  name: string;
}

export interface CsvParseCallbacks {
  onChunk: (rows: string[][], delimiter: string) => void;
  onDone: (truncated: boolean) => void;
  onError: (message: string) => void;
}

/**
 * Streams a CSV blob through Papa Parse in ~512 KB chunks. Runs unchanged on
 * the main thread and inside the parse worker. Returns an abort function.
 */
export function parseCsvBlob(
  blob: Blob,
  options: CsvParseOptions,
  callbacks: CsvParseCallbacks,
): () => void {
  let aborted = false;
  let parser: Papa.Parser | null = null;
  let count = 0;
  let truncated = false;
  // Papa Parse detects inputs via `instanceof File`; wrapping is free (no copy).
  const input =
    typeof File !== 'undefined' && !(blob instanceof File)
      ? new File([blob], options.name, { type: blob.type })
      : (blob as File);
  Papa.parse<string[]>(input, {
    delimiter: options.delimiter,
    skipEmptyLines: 'greedy',
    chunkSize: 1024 * 512,
    chunk: (results, p) => {
      parser = p;
      if (aborted) {
        p.abort();
        return;
      }
      let rows = results.data;
      if (count + rows.length > options.maxRows) {
        rows = rows.slice(0, options.maxRows - count);
        truncated = true;
      }
      count += rows.length;
      if (rows.length) callbacks.onChunk(rows, results.meta.delimiter);
      if (truncated) p.abort();
    },
    complete: () => {
      if (!aborted) callbacks.onDone(truncated);
    },
    error: (err) => {
      if (!aborted) callbacks.onError(err.message || 'The CSV file could not be parsed.');
    },
  });
  return () => {
    aborted = true;
    parser?.abort();
  };
}
