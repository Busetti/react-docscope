import { parseCsvBlob } from './csvParse';

function run(text: string, maxRows = 1000) {
  return new Promise<{ rows: string[][]; truncated?: boolean; error?: string; delimiter?: string }>(
    (resolve) => {
      const rows: string[][] = [];
      let delimiter: string | undefined;
      parseCsvBlob(
        new Blob([text], { type: 'text/csv' }),
        { delimiter: '', maxRows, name: 'a.csv' },
        {
          onChunk: (r, d) => {
            rows.push(...r);
            delimiter = d;
          },
          onDone: (truncated) => resolve({ rows, truncated, delimiter }),
          onError: (error) => resolve({ rows, error }),
        },
      );
    },
  );
}

describe('parseCsvBlob', () => {
  it('streams rows, detects the delimiter and completes', async () => {
    const res = await run('a;b\n1;2\n3;4\n');
    expect(res.rows).toEqual([
      ['a', 'b'],
      ['1', '2'],
      ['3', '4'],
    ]);
    expect(res.delimiter).toBe(';');
    expect(res.truncated).toBe(false);
  });

  it('truncates at maxRows', async () => {
    const res = await run('a\n1\n2\n3\n4\n', 2);
    expect(res.rows).toHaveLength(2);
    expect(res.truncated).toBe(true);
  });

  it('stops delivering after abort', async () => {
    const onChunk = jest.fn();
    const onDone = jest.fn();
    const abort = parseCsvBlob(
      new Blob(['a\n1\n']),
      { delimiter: '', maxRows: 10, name: 'a.csv' },
      { onChunk, onDone, onError: jest.fn() },
    );
    abort();
    await new Promise((r) => setTimeout(r, 50));
    expect(onChunk).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
  });
});
