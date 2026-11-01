import FakeParseWorker from '../../../../../../tests/setup/parse-worker-mock';
import { fixtureBuffer } from '../../../../../../tests/setup/fixtures';
import { openWorkbook } from './client';
import { createParseHandler, type ParseResponse } from './protocol';

const realWorker = (globalThis as { Worker?: unknown }).Worker;

beforeEach(() => {
  (globalThis as { Worker?: unknown }).Worker = FakeParseWorker;
  FakeParseWorker.mode = 'ok';
  FakeParseWorker.instances = [];
  FakeParseWorker.posted = [];
});
afterAll(() => {
  (globalThis as { Worker?: unknown }).Worker = realWorker;
});

describe('XLSX in the parse worker', () => {
  it('opens a workbook and reads sheets off the main thread', async () => {
    const book = await openWorkbook(fixtureBuffer('budget.xlsx'), true);
    expect(book.inWorker).toBe(true);
    expect(book.sheets.length).toBeGreaterThan(0);
    const sheet = await book.readSheet(0);
    expect(sheet.rows.size).toBeGreaterThan(0);
    // Cached: the same promise is reused, no second request.
    const before = FakeParseWorker.posted.length;
    await book.readSheet(0);
    expect(FakeParseWorker.posted.length).toBe(before);
    book.close();
    expect(FakeParseWorker.instances[0]!.terminated).toBe(true);
  });

  it('reports parse errors without retrying on the main thread', async () => {
    const bad = new TextEncoder().encode('not a zip').buffer;
    await expect(openWorkbook(bad, true)).rejects.toThrow();
    expect(FakeParseWorker.instances[0]!.terminated).toBe(true);
  });

  it('rejects unknown sheets with the worker error', async () => {
    const book = await openWorkbook(fixtureBuffer('budget.xlsx'), true);
    await expect(book.readSheet(99)).rejects.toThrow(/does not exist/);
    book.close();
  });

  it.each(['throw', 'crash'] as const)(
    'falls back to the main thread when the worker mode is %s',
    async (mode) => {
      FakeParseWorker.mode = mode;
      const book = await openWorkbook(fixtureBuffer('budget.xlsx'), true);
      expect(book.inWorker).toBe(false);
      expect((await book.readSheet(0)).rows.size).toBeGreaterThan(0);
      book.close();
    },
  );

  it('falls back for sheets when the worker dies after opening', async () => {
    const book = await openWorkbook(fixtureBuffer('budget.xlsx'), true);
    FakeParseWorker.mode = 'crash';
    expect((await book.readSheet(0)).rows.size).toBeGreaterThan(0);
  });

  it('uses the main thread when disabled or unsupported', async () => {
    expect((await openWorkbook(fixtureBuffer('budget.xlsx'), false)).inWorker).toBe(false);
    delete (globalThis as { Worker?: unknown }).Worker;
    expect((await openWorkbook(fixtureBuffer('budget.xlsx'), true)).inWorker).toBe(false);
    expect(FakeParseWorker.instances).toHaveLength(0);
  });
});

describe('parse protocol', () => {
  it('rejects sheet requests for unknown workbooks', () => {
    const out: ParseResponse[] = [];
    const handle = createParseHandler((m) => out.push(m));
    handle({ id: 1, type: 'xlsx-sheet', book: 42, index: 0 });
    expect(out).toEqual([{ id: 1, type: 'error', message: 'Workbook is not open.' }]);
  });
});
