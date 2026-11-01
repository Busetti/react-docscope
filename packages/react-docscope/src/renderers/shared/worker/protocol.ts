import { readWorkbook, type SheetInfo, type XlsxWorkbook } from '../../xlsx/xlsxReader';
import { packSheet } from '../../xlsx/sheetPacking';

/** Messages from the main thread to the parse worker. */
export type ParseRequest =
  | { id: number; type: 'xlsx-open'; data: ArrayBuffer }
  | { id: number; type: 'xlsx-sheet'; book: number; index: number };

/** Messages from the parse worker to the main thread. */
export type ParseResponse =
  | { id: number; type: 'xlsx-open'; sheets: SheetInfo[]; date1904: boolean }
  /** Sheet packed with `packSheet` (see sheetPacking.ts). */
  | { id: number; type: 'xlsx-sheet'; sheet: string }
  | { id: number; type: 'error'; message: string };

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * The worker's message handler, kept DOM-free and independent of the worker
 * global so it can be unit-tested (and reused) on the main thread.
 */
export function createParseHandler(post: (msg: ParseResponse) => void) {
  const books = new Map<number, XlsxWorkbook>();
  return (req: ParseRequest) => {
    try {
      if (req.type === 'xlsx-open') {
        const book = readWorkbook(req.data);
        books.set(req.id, book);
        post({ id: req.id, type: 'xlsx-open', sheets: book.sheets, date1904: book.date1904 });
      } else {
        const book = books.get(req.book);
        if (!book) throw new Error('Workbook is not open.');
        post({ id: req.id, type: 'xlsx-sheet', sheet: packSheet(book.readSheet(req.index)) });
      }
    } catch (e) {
      post({ id: req.id, type: 'error', message: message(e) });
    }
  };
}
