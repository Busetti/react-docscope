import ParseWorker from './parse.worker?worker&inline';
import type { ParseRequest, ParseResponse } from './protocol';
import { readWorkbook, type SheetInfo, type XlsxSheet } from '../../xlsx/xlsxReader';
import { unpackSheet } from '../../xlsx/sheetPacking';

/** Raised when the worker cannot start or crashes (e.g. CSP blocks `blob:` workers). */
class WorkerUnavailable extends Error {}

type RequestBody = ParseRequest extends infer R
  ? R extends unknown
    ? Omit<R, 'id'>
    : never
  : never;

type Listener = (msg: ParseResponse | { type: 'crash' }) => void;

/**
 * One dedicated worker per open workbook. Terminating it is the abort
 * mechanism for long parses, so instances are never shared between documents.
 */
class ParseChannel {
  private worker: Worker | null = null;
  private nextId = 1;
  private listeners = new Map<number, Listener>();
  broken = false;

  constructor() {
    try {
      this.worker = new ParseWorker();
    } catch {
      this.broken = true;
      return;
    }
    this.worker.onmessage = (e: MessageEvent<ParseResponse>) =>
      this.listeners.get(e.data.id)?.(e.data);
    this.worker.onerror = (e) => {
      e.preventDefault?.();
      this.crash();
    };
  }

  private crash() {
    this.broken = true;
    this.worker?.terminate();
    this.worker = null;
    const ls = [...this.listeners.values()];
    this.listeners.clear();
    for (const l of ls) l({ type: 'crash' });
  }

  send(req: RequestBody, listener: Listener): number {
    const id = this.nextId++;
    if (this.broken || !this.worker) {
      queueMicrotask(() => listener({ type: 'crash' }));
      return id;
    }
    this.listeners.set(id, listener);
    try {
      this.worker.postMessage({ ...req, id } as ParseRequest);
    } catch {
      // e.g. a non-cloneable payload: treat like a missing worker.
      this.listeners.delete(id);
      queueMicrotask(() => listener({ type: 'crash' }));
    }
    return id;
  }

  done(id: number) {
    this.listeners.delete(id);
  }

  request<T extends ParseResponse['type']>(
    req: RequestBody,
  ): Promise<Extract<ParseResponse, { type: T }>> {
    return new Promise((resolve, reject) => {
      const id = this.send(req, (msg) => {
        this.done(id);
        if (msg.type === 'crash') reject(new WorkerUnavailable('Parse worker unavailable.'));
        else if (msg.type === 'error') reject(new Error(msg.message));
        else resolve(msg as Extract<ParseResponse, { type: T }>);
      });
    });
  }

  terminate() {
    this.worker?.terminate();
    this.worker = null;
    this.broken = true;
    this.listeners.clear();
  }
}

export interface AsyncWorkbook {
  sheets: SheetInfo[];
  date1904: boolean;
  readSheet(index: number): Promise<XlsxSheet>;
  /** Releases the worker (if any). */
  close(): void;
  /** True when parsing runs off the main thread. */
  inWorker: boolean;
}

function mainThreadWorkbook(data: ArrayBuffer): AsyncWorkbook {
  const book = readWorkbook(data);
  return {
    sheets: book.sheets,
    date1904: book.date1904,
    readSheet: async (index) => book.readSheet(index),
    close: () => undefined,
    inWorker: false,
  };
}

/**
 * Opens an XLSX workbook in the parse worker, falling back to the main thread
 * when workers are disabled, unavailable or crash. Parse errors are not
 * retried on the main thread — they would fail the same way.
 */
export async function openWorkbook(data: ArrayBuffer, useWorker: boolean): Promise<AsyncWorkbook> {
  if (!useWorker || typeof Worker === 'undefined') return mainThreadWorkbook(data);
  const channel = new ParseChannel();
  let opened: Extract<ParseResponse, { type: 'xlsx-open' }>;
  try {
    // The buffer is copied (not transferred): it may live in the shared byte cache.
    opened = await channel.request<'xlsx-open'>({ type: 'xlsx-open', data });
  } catch (e) {
    channel.terminate();
    if (e instanceof WorkerUnavailable) return mainThreadWorkbook(data);
    throw e;
  }
  let fallback: AsyncWorkbook | null = null;
  const sheetCache = new Map<number, Promise<XlsxSheet>>();
  return {
    sheets: opened.sheets,
    date1904: opened.date1904,
    inWorker: true,
    readSheet(index) {
      const hit = sheetCache.get(index);
      if (hit) return hit;
      const p = channel.request<'xlsx-sheet'>({ type: 'xlsx-sheet', book: opened.id, index }).then(
        (r) => unpackSheet(r.sheet),
        (e: unknown) => {
          if (!(e instanceof WorkerUnavailable)) throw e;
          fallback ??= mainThreadWorkbook(data);
          return fallback.readSheet(index);
        },
      );
      sheetCache.set(index, p);
      p.catch(() => sheetCache.delete(index));
      return p;
    },
    close: () => channel.terminate(),
  };
}
