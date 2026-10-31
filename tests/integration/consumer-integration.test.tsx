/**
 * Integration tests written the way a consuming application would use the
 * package: only public exports, real fixture files, and a fetch-backed
 * resolver that issues expiring "signed URLs".
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DocumentPreviewer,
  useDocumentPreview,
  type DocumentResolver,
  type PreviewDocument,
} from '../../packages/react-docscope/src';
import { FIXTURES, fixtureBlob } from '../setup/fixtures';

/** A fake storage backend: `GET /files/<name>?exp=<ms>` → 403 once expired. */
function installFakeBackend() {
  const requests: string[] = [];
  (globalThis as { fetch?: unknown }).fetch = jest.fn(async (url: string, init?: RequestInit) => {
    requests.push(url);
    const u = new URL(url, 'https://storage.test');
    if (init?.signal?.aborted) throw new DOMException('aborted', 'AbortError');
    if (Number(u.searchParams.get('exp')) < Date.now()) {
      return { ok: false, status: 403, headers: { get: () => null } };
    }
    const name = u.pathname.split('/').pop()!;
    const body = readFileSync(join(FIXTURES, name));
    return {
      ok: true,
      status: 200,
      headers: { get: (k: string) => (k === 'content-length' ? String(body.length) : null) },
      blob: async () => new Blob([new Uint8Array(body)]),
    };
  });
  return requests;
}

const attachments: PreviewDocument[] = [
  { id: 'notes', name: 'notes.txt', metadata: { size: 8520 } },
  { id: 'data', name: 'config.json' },
  { id: 'catalog', name: 'catalog.xml' },
  { id: 'sheet', name: 'customers.csv' },
];

describe('consumer integration', () => {
  it('works with a signed-URL resolver, refreshing expired URLs transparently', async () => {
    const requests = installFakeBackend();
    const calls: Array<{ id: string; attempt: number; reason: string }> = [];
    // The consumer's resolver: first URL handed out is already expired.
    const resolveDocument: DocumentResolver = async (doc, { attempt, reason }) => {
      calls.push({ id: doc.id, attempt, reason });
      const exp = attempt === 0 ? Date.now() - 1 : Date.now() + 60_000;
      return { kind: 'url', url: `https://storage.test/files/${doc.name}?exp=${exp}&sig=SECRET` };
    };
    const consoleSpy = jest.spyOn(console, 'error');
    render(
      <DocumentPreviewer
        documents={attachments}
        resolver={resolveDocument}
        config={{ prefetch: 'none' }}
      />,
    );
    expect(await screen.findByText(/Line 001: meeting notes/)).toBeInTheDocument();
    expect(calls).toEqual([
      { id: 'notes', attempt: 0, reason: 'initial' },
      { id: 'notes', attempt: 1, reason: 'expired' },
    ]);
    expect(requests).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Next document' }));
    expect(await screen.findByRole('tree', { name: 'config.json' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Next document' }));
    expect(await screen.findByRole('tree', { name: 'catalog.xml' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Next document' }));
    expect(await screen.findByRole('grid', { name: 'customers.csv' })).toBeInTheDocument();
    // Signed URLs never end up in console output.
    for (const call of consoleSpy.mock.calls) expect(JSON.stringify(call)).not.toContain('SECRET');
    consoleSpy.mockRestore();
  });

  it('opens attachments from an existing list in ~15 lines of consumer code', async () => {
    function AttachmentList({ files }: { files: PreviewDocument[] }) {
      const { open, PreviewPortal } = useDocumentPreview({
        documents: files,
        resolver: async (doc) => ({ kind: 'blob', blob: fixtureBlob(doc.name) }),
      });
      return (
        <ul>
          {files.map((f) => (
            <li key={f.id}>
              <button onClick={() => open(f.id)}>{f.name}</button>
            </li>
          ))}
          <PreviewPortal />
        </ul>
      );
    }
    render(
      <AttachmentList
        files={[
          { id: 'md', name: 'readme.md' },
          { id: 'x', name: 'budget.xlsx' },
        ]}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'budget.xlsx' }));
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('FY2026 Budget')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Previous document' }));
    expect(
      await within(dialog).findByRole('heading', { level: 1, name: 'DocScope Markdown sample' }),
    ).toBeInTheDocument();
  });

  it('surfaces malformed and too-large documents without crashing', async () => {
    const onError = jest.fn();
    render(
      <DocumentPreviewer
        documents={[
          { id: 'bad', name: 'malformed.docx' },
          { id: 'big', name: 'notes.txt', metadata: { size: 10_000_000 } },
        ]}
        resolver={async (doc) => ({ kind: 'blob', blob: fixtureBlob(doc.name) })}
        onError={onError}
        config={{ maxFileSize: 1_000_000, prefetch: 'none' }}
      />,
    );
    expect(
      await screen.findByText('Unable to read document', {}, { timeout: 8000 }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Next document' }));
    expect(await screen.findByText('Document too large')).toBeInTheDocument();
    await waitFor(() =>
      expect(onError.mock.calls.map(([e]) => e.code)).toEqual(['MALFORMED_DOCUMENT', 'TOO_LARGE']),
    );
  });
});
