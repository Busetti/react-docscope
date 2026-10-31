import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { useEffect, useState } from 'react';
import {
  DocumentPreviewer,
  DocumentProvider,
  defineRenderer,
  type DocumentPreviewerHandle,
  type DocumentResolver,
  type PreviewDocument,
  type RendererProps,
} from '../../index';
import { clearRendererComponentCache } from '../../hooks/usePaneController';
import { fixtureBlob } from '../../../../../tests/setup/fixtures';

const text = (id: string, body: string, extra: Partial<PreviewDocument> = {}): PreviewDocument => ({
  id,
  name: `${id}.txt`,
  metadata: {
    size: body.length,
    uploadedBy: 'Guru',
    uploadedAt: '2026-01-02T10:00:00Z',
    description: `About ${id}`,
  },
  ...extra,
});

const bodies: Record<string, string> = {
  a: 'alpha document invoice',
  b: 'beta document',
  c: 'gamma invoice invoice',
};
const docs = [text('a', bodies.a!), text('b', bodies.b!), text('c', bodies.c!)];
const blobResolver: DocumentResolver = async (d) => ({
  kind: 'blob',
  blob: new Blob([bodies[d.id] ?? 'x']),
});

const ready = () =>
  waitFor(() => expect(document.querySelector('.dsc-renderer[data-ready="true"]')).not.toBeNull());

beforeEach(() => clearRendererComponentCache());

describe('DocumentPreviewer — multiple attachments', () => {
  it('navigates, updates metadata and fires callbacks', async () => {
    const onDocumentChange = jest.fn();
    const onLoad = jest.fn();
    render(
      <DocumentPreviewer
        documents={docs}
        resolver={blobResolver}
        onDocumentChange={onDocumentChange}
        onLoad={onLoad}
        config={{ metadata: 'open', prefetch: 'none' }}
      />,
    );
    await ready();
    expect(screen.getByRole('heading', { name: 'a.txt' })).toBeInTheDocument();
    expect(screen.getByText('1 / 3')).toBeInTheDocument();
    expect(onLoad).toHaveBeenCalledWith(docs[0]);
    const details = screen.getByRole('complementary', { name: 'Details' });
    expect(within(details).getByText('About a')).toBeInTheDocument();
    expect(within(details).getByText('Guru')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Next document' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'b.txt' })).toBeInTheDocument());
    expect(onDocumentChange).toHaveBeenLastCalledWith(docs[1], 1);
    await waitFor(() => expect(screen.getByText(/beta document/)).toBeInTheDocument());
    expect(
      within(screen.getByRole('complementary', { name: 'Details' })).getByText('About b'),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Previous document' }));
    fireEvent.click(screen.getByRole('button', { name: 'Previous document' })); // wraps to last
    await waitFor(() => expect(screen.getByRole('heading', { name: 'c.txt' })).toBeInTheDocument());

    const list = screen.getByRole('listbox', { name: 'Attachments' });
    fireEvent.click(within(list).getByRole('option', { name: /a\.txt/ }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'a.txt' })).toBeInTheDocument());
    fireEvent.keyDown(list, { key: 'ArrowDown' });
    await waitFor(() => expect(screen.getByRole('heading', { name: 'b.txt' })).toBeInTheDocument());
    fireEvent.keyDown(list, { key: 'End' });
    fireEvent.keyDown(list, { key: 'Home' });
    fireEvent.keyDown(list, { key: 'ArrowUp' });
    fireEvent.keyDown(list, { key: 'x' });
    fireEvent.keyDown(within(list).getAllByRole('option')[2]!, { key: 'Enter' });
    fireEvent.keyDown(within(list).getAllByRole('option')[1]!, { key: ' ' });
    fireEvent.keyDown(within(list).getAllByRole('option')[1]!, { key: 'Tab' });
    fireEvent.keyDown(within(list).getAllByRole('option')[2]!, { key: 'Enter' });
    await waitFor(() => expect(screen.getByRole('heading', { name: 'c.txt' })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Attachments' }));
    expect(screen.queryByRole('listbox')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Details' }));
    expect(screen.queryByRole('complementary', { name: 'Details' })).toBeNull();
  });

  it('supports keyboard shortcuts', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <DocumentPreviewer
        documents={docs}
        resolver={blobResolver}
        config={{ prefetch: 'none', searchDebounce: 0 }}
      />,
    );
    await ready();
    const root = container.querySelector('.dsc-root') as HTMLElement;
    root.focus();
    fireEvent.keyDown(root, { key: 'ArrowRight', altKey: true });
    await waitFor(() => expect(screen.getByRole('heading', { name: 'b.txt' })).toBeInTheDocument());
    fireEvent.keyDown(root, { key: ']' });
    await waitFor(() => expect(screen.getByRole('heading', { name: 'c.txt' })).toBeInTheDocument());
    fireEvent.keyDown(root, { key: '[' });
    await waitFor(() => expect(screen.getByRole('heading', { name: 'b.txt' })).toBeInTheDocument());
    await ready();
    fireEvent.keyDown(root, { key: '+' });
    expect(screen.getByRole('button', { name: /Zoom 125%/ })).toBeInTheDocument();
    fireEvent.keyDown(root, { key: '-' });
    fireEvent.keyDown(root, { key: '-' });
    expect(screen.getByRole('button', { name: /Zoom 75%/ })).toBeInTheDocument();
    fireEvent.keyDown(root, { key: '0' });
    expect(screen.getByRole('button', { name: /Zoom 100%/ })).toBeInTheDocument();
    fireEvent.keyDown(root, { key: 'b', ctrlKey: true });
    expect(screen.queryByRole('listbox')).toBeNull();
    fireEvent.keyDown(root, { key: 'r' }); // text has no rotate capability → ignored
    fireEvent.keyDown(root, { key: 'f', ctrlKey: true });
    const input = await screen.findByRole('searchbox');
    await user.type(input, 'document');
    await waitFor(() => expect(screen.getByRole('status', { name: '' }) ?? null).toBeTruthy());
    await waitFor(() => expect(screen.getByText('1 of 1')).toBeInTheDocument());
    // single-key shortcuts don't fire while typing
    fireEvent.keyDown(input, { key: '+' });
    expect(screen.getByRole('button', { name: /Zoom 100%/ })).toBeInTheDocument();
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(input).toHaveValue('');
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('searchbox')).toBeNull();
  });

  it('searches with next / previous / case options', async () => {
    const user = userEvent.setup();
    render(
      <DocumentPreviewer
        documents={[docs[2]!]}
        resolver={blobResolver}
        config={{ searchDebounce: 0 }}
      />,
    );
    await ready();
    expect(screen.queryByRole('listbox')).toBeNull(); // single document → no sidebar
    await user.click(screen.getByRole('button', { name: 'Search' }));
    const input = screen.getByRole('searchbox');
    await user.type(input, 'INVOICE');
    await waitFor(() => expect(screen.getByText('1 of 2')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Next match' }));
    expect(screen.getByText('2 of 2')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Next match' }));
    expect(screen.getByText('1 of 2')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Previous match' }));
    expect(screen.getByText('2 of 2')).toBeInTheDocument();
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    expect(screen.getByText('1 of 2')).toBeInTheDocument();
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByText('2 of 2')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Match case' }));
    await waitFor(() => expect(screen.getByText('No results')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(screen.queryByRole('searchbox')).toBeNull();
  });

  it('accepts document changes without remounting and keeps a sensible selection', async () => {
    function Host() {
      const [list, setList] = useState(docs);
      return (
        <>
          <button onClick={() => setList((l) => l.filter((d) => d.id !== 'b'))}>remove b</button>
          <button onClick={() => setList((l) => [...l, text('d', 'delta')])}>add d</button>
          <DocumentPreviewer
            documents={list}
            resolver={blobResolver}
            defaultDocumentId="b"
            config={{ prefetch: 'none' }}
          />
        </>
      );
    }
    render(<Host />);
    await ready();
    const root = document.querySelector('.dsc-root');
    expect(screen.getByRole('heading', { name: 'b.txt' })).toBeInTheDocument();
    fireEvent.click(screen.getByText('add d'));
    expect(screen.getByText('2 / 4')).toBeInTheDocument();
    fireEvent.click(screen.getByText('remove b'));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'c.txt' })).toBeInTheDocument());
    expect(document.querySelector('.dsc-root')).toBe(root);
  });

  it('supports controlled selection', async () => {
    const onDocumentChange = jest.fn();
    const { rerender } = render(
      <DocumentPreviewer
        documents={docs}
        activeDocumentId="c"
        resolver={blobResolver}
        onDocumentChange={onDocumentChange}
      />,
    );
    await ready();
    expect(screen.getByRole('heading', { name: 'c.txt' })).toBeInTheDocument();
    rerender(
      <DocumentPreviewer
        documents={docs}
        activeDocumentId="a"
        resolver={blobResolver}
        onDocumentChange={onDocumentChange}
      />,
    );
    await waitFor(() => expect(screen.getByRole('heading', { name: 'a.txt' })).toBeInTheDocument());
    expect(onDocumentChange).toHaveBeenCalledWith(docs[0], 0);
  });

  it('renders the empty state', () => {
    render(<DocumentPreviewer documents={[]} />);
    expect(screen.getAllByText('No documents to preview').length).toBeGreaterThan(0);
  });

  it('applies dimensions, theme and class names', async () => {
    render(
      <DocumentPreviewer
        document={docs[0]}
        resolver={blobResolver}
        className="custom"
        config={{ width: 500, height: '50vh', theme: 'dark', className: 'cfg' }}
      />,
    );
    const root = document.querySelector('.dsc-root') as HTMLElement;
    expect(root).toHaveClass('custom', 'cfg', 'dsc-root--inline');
    expect(root).toHaveStyle({ width: '500px', height: '50vh' });
    expect(root).toHaveAttribute('data-dsc-theme', 'dark');
    expect(root).toHaveAttribute('aria-label', 'Document preview: a.txt');
    await ready();
  });

  it('hides features through configuration', async () => {
    render(
      <DocumentPreviewer
        documents={docs}
        resolver={blobResolver}
        config={{
          toolbar: false,
          download: false,
          metadata: false,
          fullscreen: false,
          sidebar: false,
        }}
      />,
    );
    await ready();
    expect(screen.queryByRole('toolbar')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Download' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Details' })).toBeNull();
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('has no detectable accessibility violations', async () => {
    const { container } = render(
      <DocumentPreviewer
        documents={docs}
        resolver={blobResolver}
        config={{ metadata: 'open', prefetch: 'none' }}
      />,
    );
    await ready();
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('DocumentPreviewer — loading, errors and downloads', () => {
  it('shows errors with retry, and retries with reason "retry"', async () => {
    let attempt = 0;
    const resolver = jest.fn<ReturnType<DocumentResolver>, Parameters<DocumentResolver>>(
      async () => {
        attempt += 1;
        if (attempt === 1) throw new Error('backend down');
        return { kind: 'blob', blob: new Blob(['recovered']) };
      },
    );
    const onError = jest.fn();
    render(<DocumentPreviewer document={docs[0]} resolver={resolver} onError={onError} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('backend down');
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'RESOLVE_FAILED', documentId: 'a' }),
      docs[0],
    );
    fireEvent.click(screen.getByRole('button', { name: /Retry/ }));
    await waitFor(() => expect(screen.getByText('recovered')).toBeInTheDocument());
    expect(resolver.mock.calls[1]![1]).toMatchObject({ reason: 'retry', attempt: 1 });
  });

  it('handles unsupported formats', async () => {
    const onError = jest.fn();
    render(
      <DocumentPreviewer
        document={{ id: 'z', name: 'archive.bin' }}
        resolver={blobResolver}
        onError={onError}
      />,
    );
    expect(await screen.findByText('Preview not available')).toBeInTheDocument();
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'UNSUPPORTED_FORMAT' }),
      expect.anything(),
    );
  });

  it('uses a consumer fallback when the original cannot be rendered', async () => {
    const resolver: DocumentResolver = async (d) => ({
      kind: 'blob',
      blob: d.name.endsWith('.bin') ? new Blob(['?']) : new Blob(['converted text']),
    });
    render(
      <DocumentPreviewer
        document={{ id: 'p', name: 'deck.bin', fallback: { name: 'deck.txt' } }}
        resolver={resolver}
      />,
    );
    expect(await screen.findByText('converted text')).toBeInTheDocument();
    expect(screen.getByRole('note')).toHaveTextContent('converted version');
    fireEvent.click(screen.getByRole('button', { name: 'Show original' }));
    await waitFor(() => expect(screen.getByText('Preview not available')).toBeInTheDocument());
  });

  it('falls back after a malformed original', async () => {
    const resolver: DocumentResolver = async (d) =>
      d.name.endsWith('.json')
        ? { kind: 'blob', blob: fixtureBlob('malformed.xlsx') }
        : { kind: 'blob', blob: new Blob(['fallback ok']) };
    render(
      <DocumentPreviewer
        document={{ id: 'q', name: 'broken.xlsx', fallback: { name: 'broken.txt' } }}
        resolver={async (d) =>
          d.name.endsWith('.xlsx')
            ? { kind: 'blob', blob: fixtureBlob('malformed.xlsx') }
            : resolver(d, {} as never)
        }
      />,
    );
    expect(await screen.findByText('fallback ok', {}, { timeout: 5000 })).toBeInTheDocument();
  });

  it('shows empty documents as such', async () => {
    render(
      <DocumentPreviewer
        document={docs[0]}
        resolver={async () => ({ kind: 'blob', blob: new Blob([]) })}
      />,
    );
    expect(await screen.findByText('Empty document')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Retry/ })).toBeNull();
  });

  it('downloads via default handler, override and reports failures', async () => {
    const clicks: string[] = [];
    jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicks.push(this.download);
    });
    const { rerender } = render(<DocumentPreviewer document={docs[0]} resolver={blobResolver} />);
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Download' }));
    await waitFor(() => expect(clicks).toEqual(['a.txt']));

    const onDownload = jest.fn(async (_d, ctx) => {
      await ctx.defaultDownload();
    });
    rerender(
      <DocumentPreviewer document={docs[0]} resolver={blobResolver} onDownload={onDownload} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Download' }));
    await waitFor(() => expect(onDownload).toHaveBeenCalled());
    await waitFor(() => expect(clicks).toHaveLength(2));

    const onError = jest.fn();
    rerender(
      <DocumentPreviewer
        document={docs[0]}
        resolver={blobResolver}
        onError={onError}
        onDownload={() => {
          throw new Error('quota exceeded');
        }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Download' }));
    expect(await screen.findByText('quota exceeded')).toBeInTheDocument();
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'DOWNLOAD_FAILED' }),
      docs[0],
    );
    jest.restoreAllMocks();
  });

  it('respects downloadable: false', async () => {
    render(
      <DocumentPreviewer document={{ ...docs[0]!, downloadable: false }} resolver={blobResolver} />,
    );
    await ready();
    expect(screen.queryByRole('button', { name: 'Download' })).toBeNull();
  });

  it('cancels in-flight resolution and revokes object URLs when switching documents', async () => {
    const signals: AbortSignal[] = [];
    const resolver: DocumentResolver = (d, { signal }) => {
      signals.push(signal);
      if (d.id === 'slow') return new Promise(() => undefined);
      return Promise.resolve({ kind: 'blob', blob: fixtureBlob('photo.jpg', 'image/jpeg') });
    };
    const list: PreviewDocument[] = [
      { id: 'slow', name: 'slow.txt' },
      { id: 'img', name: 'p.jpg' },
    ];
    const { unmount } = render(
      <DocumentPreviewer documents={list} resolver={resolver} config={{ prefetch: 'none' }} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Next document' }));
    await waitFor(() => expect(signals[0]!.aborted).toBe(true));
    const img = await screen.findByAltText('p.jpg');
    const url = img.getAttribute('src');
    (URL.revokeObjectURL as jest.Mock).mockClear();
    unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(url);
  });

  it('re-resolves streaming documents once when the renderer reports an expired URL', async () => {
    const streaming = defineRenderer({
      id: 'stream',
      label: 'Stream',
      mimeTypes: [],
      extensions: ['stream'],
      capabilities: {},
      loadingStrategy: 'url',
      load: async () => ({ default: ExpiringRenderer }),
    });
    const resolver = jest.fn<ReturnType<DocumentResolver>, Parameters<DocumentResolver>>(
      async (_d, ctx) => ({
        kind: 'url',
        url: `https://cdn/v?attempt=${ctx.attempt}`,
      }),
    );
    const onError = jest.fn();
    render(
      <DocumentPreviewer
        document={{ id: 'v', name: 'v.stream' }}
        resolver={resolver}
        renderers={[streaming]}
        onError={onError}
      />,
    );
    expect(await screen.findByText('streamed https://cdn/v?attempt=1')).toBeInTheDocument();
    expect(resolver.mock.calls[1]![1]).toMatchObject({ attempt: 1, reason: 'expired' });
    expect(onError).not.toHaveBeenCalled();
  });
});

function ExpiringRenderer({ source, host }: RendererProps) {
  const url = source.getRequest()?.url ?? '';
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (url.endsWith('attempt=0')) host.setError('ACCESS_DENIED', 'expired');
    else {
      setShown(true);
      host.setReady();
    }
  }, [url, host]);
  return shown ? <div>streamed {url}</div> : null;
}

describe('custom renderers, toolbar actions and provider', () => {
  it('registers a custom renderer, a toolbar action and custom metadata', async () => {
    const dwg = defineRenderer({
      id: 'dwg',
      label: 'Drawing',
      mimeTypes: [],
      extensions: ['dwg'],
      capabilities: { zoom: true },
      loadingStrategy: 'text',
      load: async () => ({
        default: function Dwg({ source, host }: RendererProps) {
          void source.getText().then(() => host.setReady());
          return <div>custom drawing view</div>;
        },
      }),
    });
    const onClick = jest.fn();
    render(
      <DocumentPreviewer
        document={{ id: 'd', name: 'plan.dwg', metadata: { revision: 3 } }}
        resolver={blobResolver}
        renderers={[dwg]}
        toolbarActions={[
          { id: 'share', label: 'Share', onClick },
          { id: 'hidden', label: 'Hidden', onClick, isVisible: () => false },
          { id: 'disabled', label: 'Disabled', onClick, disabled: () => true },
        ]}
        config={{
          metadata: 'open',
          metadataFields: [
            'type',
            { key: 'revision', label: 'Rev', format: (v) => `r${String(v)}` },
          ],
        }}
        renderMetadata={({ fields }) => (
          <ul aria-label="custom meta">
            {fields.map((f) => (
              <li key={f.key}>
                {f.label}: {f.value}
              </li>
            ))}
          </ul>
        )}
      />,
    );
    expect(await screen.findByText('custom drawing view')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Share' }));
    expect(onClick).toHaveBeenCalledWith(
      expect.objectContaining({ document: expect.objectContaining({ id: 'd' }), index: 0 }),
    );
    expect(screen.queryByRole('button', { name: 'Hidden' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Disabled' })).toBeDisabled();
    const meta = screen.getByRole('list', { name: 'custom meta' });
    expect(meta).toHaveTextContent('Type: Drawing (.dwg)');
    expect(meta).toHaveTextContent('Rev: r3');
  });

  it('shares resolver and config through DocumentProvider', async () => {
    const resolver = jest.fn(blobResolver);
    render(
      <DocumentProvider
        resolver={resolver}
        config={{ theme: 'dark', labels: { download: 'Save' } }}
      >
        <DocumentPreviewer document={docs[0]} />
        <DocumentPreviewer document={docs[1]} config={{ theme: 'light' }} />
      </DocumentProvider>,
    );
    await waitFor(() =>
      expect(document.querySelectorAll('.dsc-renderer[data-ready="true"]')).toHaveLength(2),
    );
    const roots = document.querySelectorAll('.dsc-root');
    expect(roots[0]).toHaveAttribute('data-dsc-theme', 'dark');
    expect(roots[1]).toHaveAttribute('data-dsc-theme', 'light');
    expect(screen.getAllByRole('button', { name: 'Save' })).toHaveLength(2);
    expect(resolver).toHaveBeenCalledTimes(2);
  });

  it('prefetches small adjacent documents into the cache', async () => {
    const resolver = jest.fn(blobResolver);
    const small = docs.map((d) => ({ ...d, metadata: { ...d.metadata, size: 10 } }));
    render(<DocumentPreviewer documents={small} resolver={resolver} />);
    await ready();
    await waitFor(() => expect(resolver).toHaveBeenCalledTimes(2), { timeout: 3000 }); // a + prefetched b
    fireEvent.click(screen.getByRole('button', { name: 'Next document' }));
    await waitFor(() => expect(screen.getByText('beta document')).toBeInTheDocument());
    expect(resolver.mock.calls.filter(([d]) => d.id === 'b')).toHaveLength(1); // served from cache
  });
});

describe('compare mode', () => {
  it('compares two documents with independent panes', async () => {
    const onCompareChange = jest.fn();
    const ref: { current: DocumentPreviewerHandle | null } = { current: null };
    render(
      <DocumentPreviewer
        ref={ref}
        documents={docs}
        resolver={blobResolver}
        onCompareChange={onCompareChange}
        config={{ prefetch: 'none', searchDebounce: 0 }}
      />,
    );
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Compare' }));
    expect(onCompareChange).toHaveBeenLastCalledWith(['a', 'b']);
    expect(screen.getByRole('heading', { name: 'a.txt ↔ b.txt' })).toBeInTheDocument();
    const left = screen.getByRole('region', { name: 'Left document' });
    const right = screen.getByRole('region', { name: 'Right document' });
    await waitFor(() =>
      expect(within(left).getByText('alpha document invoice')).toBeInTheDocument(),
    );
    await waitFor(() => expect(within(right).getByText('beta document')).toBeInTheDocument());

    // independent zoom
    fireEvent.click(within(left).getByRole('button', { name: 'Zoom in' }));
    expect(within(left).getByRole('button', { name: /Zoom 125%/ })).toBeInTheDocument();
    expect(within(right).getByRole('button', { name: /Zoom 100%/ })).toBeInTheDocument();

    // sync zoom
    fireEvent.click(screen.getByRole('button', { name: 'Synchronise zoom' }));
    await waitFor(() =>
      expect(within(right).getByRole('button', { name: /Zoom 125%/ })).toBeInTheDocument(),
    );
    fireEvent.click(within(right).getByRole('button', { name: 'Zoom in' }));
    await waitFor(() =>
      expect(within(left).getByRole('button', { name: /Zoom 150%/ })).toBeInTheDocument(),
    );

    // select another document on the right
    fireEvent.change(within(right).getByRole('combobox', { name: 'Right document' }), {
      target: { value: 'c' },
    });
    await waitFor(() => expect(within(right).getByText(/gamma/)).toBeInTheDocument());
    expect(onCompareChange).toHaveBeenLastCalledWith(['a', 'c']);

    // swap keeps pane state
    fireEvent.click(screen.getByRole('button', { name: 'Swap documents' }));
    expect(onCompareChange).toHaveBeenLastCalledWith(['c', 'a']);
    expect(screen.getByRole('heading', { name: 'c.txt ↔ a.txt' })).toBeInTheDocument();

    // orientation, sync scroll, splitter
    fireEvent.click(screen.getByRole('button', { name: 'Stacked' }));
    expect(document.querySelector('.dsc-compare-panes--vertical')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Side by side' }));
    fireEvent.click(screen.getByRole('button', { name: 'Synchronise scrolling' }));
    const scrollers = document.querySelectorAll<HTMLElement>('[data-dsc-scroll-container]');
    const sh = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollHeight');
    const sw = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollWidth');
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
      configurable: true,
      get: () => 2768,
    });
    Object.defineProperty(HTMLElement.prototype, 'scrollWidth', {
      configurable: true,
      get: () => 2048,
    });
    scrollers[0]!.scrollTop = 1000;
    scrollers[0]!.scrollLeft = 512;
    fireEvent.scroll(scrollers[0]!);
    expect(scrollers[1]!.scrollTop).toBe(1000);
    expect(scrollers[1]!.scrollLeft).toBe(512);
    fireEvent.scroll(scrollers[1]!); // echo is ignored
    fireEvent.scroll(scrollers[0]!); // already in sync
    fireEvent.scroll(right); // not a scroll container
    if (sh) Object.defineProperty(HTMLElement.prototype, 'scrollHeight', sh);
    else delete (HTMLElement.prototype as { scrollHeight?: number }).scrollHeight;
    if (sw) Object.defineProperty(HTMLElement.prototype, 'scrollWidth', sw);
    else delete (HTMLElement.prototype as { scrollWidth?: number }).scrollWidth;
    const splitter = screen.getByRole('separator', { name: 'Resize panes' });
    fireEvent.keyDown(splitter, { key: 'ArrowRight' });
    expect(splitter).toHaveAttribute('aria-valuenow', '55');
    fireEvent.keyDown(splitter, { key: 'ArrowLeft' });
    fireEvent.keyDown(splitter, { key: 'Home' });
    fireEvent.keyDown(splitter, { key: 'q' });
    expect(splitter).toHaveAttribute('aria-valuenow', '50');
    fireEvent.pointerDown(splitter, { pointerId: 1, clientX: 0 });
    fireEvent.pointerMove(splitter, { pointerId: 1, clientX: 900 });
    fireEvent.pointerUp(splitter, { pointerId: 1 });
    expect(Number(splitter.getAttribute('aria-valuenow'))).toBeLessThanOrEqual(80);
    fireEvent.doubleClick(splitter);

    // per-pane search via shortcut routes to the focused pane
    const root = document.querySelector('.dsc-root') as HTMLElement;
    // panes moved on swap: query the current right pane
    fireEvent.focusIn(
      screen.getByRole('region', { name: 'Right document' }).querySelector('select')!,
    );
    fireEvent.keyDown(root, { key: 'f', ctrlKey: true });
    expect(
      within(screen.getByRole('region', { name: 'Right document' })).getByRole('searchbox'),
    ).toBeInTheDocument();
    expect(ref.current!.handleEscape()).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Exit compare' }));
    expect(onCompareChange).toHaveBeenLastCalledWith(null);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'c.txt' })).toBeInTheDocument());
    act(() => ref.current!.compare('a', 'b'));
    expect(screen.getByRole('heading', { name: 'a.txt ↔ b.txt' })).toBeInTheDocument();
    act(() => ref.current!.exitCompare());
    act(() => ref.current!.select('b'));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'b.txt' })).toBeInTheDocument());
    expect(ref.current!.handleEscape()).toBe(false);
  });

  it('can start in compare mode and passes axe', async () => {
    const { container } = render(
      <DocumentPreviewer documents={docs} resolver={blobResolver} defaultCompare={['a', 'c']} />,
    );
    await waitFor(() =>
      expect(document.querySelectorAll('.dsc-renderer[data-ready="true"]')).toHaveLength(2),
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('stale renderer hosts', () => {
  it('ignores updates from a renderer of a previous document', async () => {
    const hosts: RendererProps['host'][] = [];
    const spy = defineRenderer({
      id: 'spy',
      label: 'Spy',
      mimeTypes: [],
      extensions: ['spy'],
      capabilities: { pages: true, zoom: true, search: true },
      loadingStrategy: 'url',
      load: async () => ({
        default: function Spy({ host, document }: RendererProps) {
          useEffect(() => {
            hosts.push(host);
            host.setReady();
          }, [host]);
          return <div>spy {document.name}</div>;
        },
      }),
    });
    const list = [
      { id: '1', name: 'one.spy', url: 'u1' },
      { id: '2', name: 'two.spy', url: 'u2' },
    ];
    render(<DocumentPreviewer documents={list} renderers={[spy]} config={{ prefetch: 'none' }} />);
    expect(await screen.findByText('spy one.spy')).toBeInTheDocument();
    const stale = hosts[hosts.length - 1]!;
    fireEvent.click(screen.getByRole('button', { name: 'Next document' }));
    expect(await screen.findByText('spy two.spy')).toBeInTheDocument();
    act(() => {
      stale.setPageCount(99);
      stale.setCurrentPage(5);
      stale.setSearchResults(3);
      stale.setEffectiveZoom(4);
      stale.requestZoom(4);
      stale.setReady();
      stale.setError('RENDER_FAILED', 'late');
    });
    expect(screen.queryByText(/99/)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    const live = hosts[hosts.length - 1]!;
    act(() => {
      live.setPageCount(3);
      live.requestZoom(50);
    });
    expect(screen.getByRole('button', { name: /Zoom 800%/ })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /of 3/ })).toBeInTheDocument();
  });
});
