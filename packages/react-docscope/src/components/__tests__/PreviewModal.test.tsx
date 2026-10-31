import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { useState } from 'react';
import {
  PreviewModal,
  useDocumentPreview,
  type DocumentResolver,
  type PreviewDocument,
} from '../../index';

const docs: PreviewDocument[] = [
  { id: 'one', name: 'one.txt' },
  { id: 'two', name: 'two.txt' },
  { id: 'three', name: 'three.md' },
];
const resolver: DocumentResolver = async (d) => ({
  kind: 'blob',
  blob: new Blob([`content of ${d.name}`]),
});

describe('PreviewModal', () => {
  function Harness(props: Partial<React.ComponentProps<typeof PreviewModal>>) {
    const [open, setOpen] = useState(true);
    return (
      <>
        <button onClick={() => setOpen(true)}>reopen</button>
        <PreviewModal
          open={open}
          onOpenChange={setOpen}
          documents={docs}
          resolver={resolver}
          config={{ prefetch: 'none', searchDebounce: 0 }}
          {...props}
        />
      </>
    );
  }

  it('opens as an accessible dialog, focuses the workspace and closes on Escape', async () => {
    const onOpen = jest.fn();
    const onClose = jest.fn();
    render(<Harness onOpen={onOpen} onClose={onClose} />);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: 'one.txt' })).toBeInTheDocument();
    expect(onOpen).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(document.activeElement).toHaveClass('dsc-root'));
    expect(await within(dialog).findByText('content of one.txt')).toBeInTheDocument();
    expect(await axe(dialog)).toHaveNoViolations();
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText('reopen'));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(onOpen).toHaveBeenCalledTimes(2);
  });

  it('closes the search bar before the dialog on Escape', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByText('content of one.txt');
    await user.click(within(dialog).getByRole('button', { name: 'Search' }));
    expect(within(dialog).getByRole('searchbox')).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(within(dialog).queryByRole('searchbox')).toBeNull();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('closes with the close button and honours closeOnBackdrop=false', async () => {
    render(<Harness config={{ modal: { closeOnBackdrop: false, width: 800, height: '70vh' } }} />);
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveStyle({ width: '800px', height: '70vh' });
    fireEvent.pointerDown(document.querySelector('.dsc-overlay')!);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('exposes the imperative handle', async () => {
    const ref = {
      current: null as null | {
        compare(a: string, b: string): void;
        exitCompare(): void;
        select(id: string): void;
        handleEscape(): boolean;
      },
    };
    render(
      <PreviewModal
        ref={ref}
        open
        onOpenChange={() => undefined}
        documents={docs}
        resolver={resolver}
      />,
    );
    await screen.findByRole('dialog');
    act(() => ref.current!.select('two'));
    expect(await screen.findByRole('heading', { name: 'two.txt' })).toBeInTheDocument();
    act(() => ref.current!.compare('one', 'three'));
    expect(screen.getByRole('heading', { name: 'one.txt ↔ three.md' })).toBeInTheDocument();
    act(() => ref.current!.exitCompare());
    expect(ref.current!.handleEscape()).toBe(false);
  });
});

describe('useDocumentPreview', () => {
  function Attachments({
    list,
    onDocumentChange,
  }: {
    list: PreviewDocument[];
    onDocumentChange?: (d: PreviewDocument) => void;
  }) {
    const { open, close, compare, isOpen, activeDocument, PreviewPortal } = useDocumentPreview({
      documents: list,
      resolver,
      config: { prefetch: 'none' },
      ...(onDocumentChange ? { onDocumentChange } : {}),
    });
    (window as unknown as { portalType: unknown }).portalType ??= PreviewPortal;
    (window as unknown as { portalStable: boolean }).portalStable =
      (window as unknown as { portalType: unknown }).portalType === PreviewPortal;
    return (
      <div>
        {list.map((d) => (
          <button key={d.id} onClick={() => open(d.id)}>
            open {d.id}
          </button>
        ))}
        <button onClick={() => open()}>open default</button>
        <button onClick={() => compare('one', 'two')}>compare</button>
        <button onClick={close}>close</button>
        <output>{isOpen ? `open:${activeDocument?.id ?? ''}` : 'closed'}</output>
        <PreviewPortal />
      </div>
    );
  }

  it('opens by document id, tracks the active document and closes', async () => {
    const onDocumentChange = jest.fn();
    const { rerender } = render(<Attachments list={docs} onDocumentChange={onDocumentChange} />);
    expect(document.querySelector('output')).toHaveTextContent('closed');
    fireEvent.click(screen.getByText('open two'));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: 'two.txt' })).toBeInTheDocument();
    expect(document.querySelector('output')).toHaveTextContent('open:two');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Next document' }));
    await waitFor(() =>
      expect(within(dialog).getByRole('heading', { name: 'three.md' })).toBeInTheDocument(),
    );
    expect(onDocumentChange).toHaveBeenCalledWith(docs[2], 2);
    // documents can change while open without remounting the modal
    rerender(
      <Attachments
        list={[...docs, { id: 'four', name: 'four.txt' }]}
        onDocumentChange={onDocumentChange}
      />,
    );
    expect(within(screen.getByRole('dialog')).getByText('3 / 4')).toBeInTheDocument();
    expect((window as unknown as { portalStable: boolean }).portalStable).toBe(true);
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    fireEvent.click(screen.getByText('open default'));
    expect(
      within(await screen.findByRole('dialog')).getByRole('heading', { name: 'one.txt' }),
    ).toBeInTheDocument();
    act(() => {
      screen.getByText('close', { selector: 'button' }).click();
    });
  });

  it('opens directly in compare mode', async () => {
    render(<Attachments list={docs} />);
    fireEvent.click(screen.getByText('compare'));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: 'one.txt ↔ two.txt' })).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Exit compare' }));
    expect(within(dialog).getByRole('heading', { name: 'one.txt' })).toBeInTheDocument();
  });
});
