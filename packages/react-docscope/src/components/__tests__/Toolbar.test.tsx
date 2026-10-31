import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { DocumentPreviewer, type DocumentResolver, type PreviewDocument } from '../../index';
import { fixtureBlob } from '../../../../../tests/setup/fixtures';
import * as pdfjs from '../../../../../tests/setup/pdfjs-mock';

const mock = pdfjs as unknown as typeof import('../../../../../tests/setup/pdfjs-mock');
const resolver: DocumentResolver = async (d) => ({
  kind: 'blob',
  blob: fixtureBlob(d.name, d.type ?? ''),
});
const ready = () =>
  waitFor(() => expect(document.querySelector('.dsc-renderer[data-ready="true"]')).not.toBeNull());

beforeEach(() => mock.__setMockPdf({ numPages: 6 }));

describe('capability-driven toolbar', () => {
  it('shows PDF controls: pages, zoom, fit, rotate, thumbnails, scroll mode', async () => {
    render(<DocumentPreviewer document={{ id: 'p', name: 'sample.pdf' }} resolver={resolver} />);
    await ready();
    const toolbar = screen.getByRole('toolbar', { name: 'Document tools' });
    const page = within(toolbar).getByRole('textbox', { name: /Page 1 of 6/ });
    expect(within(toolbar).getByRole('button', { name: 'Previous page' })).toBeDisabled();
    fireEvent.click(within(toolbar).getByRole('button', { name: 'Next page' }));
    await waitFor(() => expect(page).toHaveValue('2'));
    fireEvent.change(page, { target: { value: '5x' } });
    expect(page).toHaveValue('5');
    fireEvent.keyDown(page, { key: 'Enter' });
    await waitFor(() =>
      expect(within(toolbar).getByRole('textbox', { name: /Page 5 of 6/ })).toBeInTheDocument(),
    );
    fireEvent.change(page, { target: { value: '99' } });
    fireEvent.blur(page);
    await waitFor(() =>
      expect(within(toolbar).getByRole('textbox', { name: /Page 6 of 6/ })).toBeInTheDocument(),
    );
    expect(within(toolbar).getByRole('button', { name: 'Next page' })).toBeDisabled();
    fireEvent.keyDown(page, { key: 'a' });

    const fitWidth = within(toolbar).getByRole('button', { name: 'Fit width' });
    expect(fitWidth).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(within(toolbar).getByRole('button', { name: 'Fit page' }));
    expect(within(toolbar).getByRole('button', { name: 'Fit page' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    fireEvent.click(within(toolbar).getByRole('button', { name: 'Zoom in' }));
    expect(fitWidth).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(within(toolbar).getByRole('button', { name: /^Zoom \d+%/ }));
    expect(within(toolbar).getByRole('button', { name: /Zoom 100%/ })).toBeInTheDocument();
    fireEvent.click(within(toolbar).getByRole('button', { name: 'Rotate' }));
    fireEvent.click(within(toolbar).getByRole('button', { name: 'Thumbnails' }));
    expect(screen.getByRole('navigation', { name: 'Page thumbnails' })).toBeInTheDocument();
    fireEvent.click(within(toolbar).getByRole('button', { name: 'Single page' }));
    expect(within(toolbar).getByRole('button', { name: 'Continuous scroll' })).toBeInTheDocument();
    // keyboard paging
    const root = document.querySelector('.dsc-root') as HTMLElement;
    fireEvent.keyDown(root, { key: 'PageUp' });
    await waitFor(() =>
      expect(within(toolbar).getByRole('textbox', { name: /Page 5 of 6/ })).toBeInTheDocument(),
    );
    fireEvent.keyDown(root, { key: 'PageDown' });
    fireEvent.keyDown(root, { key: 'r' });
    // video-only controls never appear for PDFs
    expect(screen.queryByRole('button', { name: /play/i })).toBeNull();
  });

  it('shows image controls (fit window, original size) but no search', async () => {
    render(
      <DocumentPreviewer
        document={{ id: 'i', name: 'photo.jpg', type: 'image/jpeg' }}
        resolver={resolver}
      />,
    );
    const img = await screen.findByAltText('photo.jpg');
    Object.defineProperty(img, 'naturalWidth', { value: 400 });
    Object.defineProperty(img, 'naturalHeight', { value: 300 });
    fireEvent.load(img);
    await ready();
    const toolbar = screen.getByRole('toolbar', { name: 'Document tools' });
    expect(within(toolbar).getByRole('button', { name: 'Fit to window' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    fireEvent.click(within(toolbar).getByRole('button', { name: 'Original size' }));
    expect(within(toolbar).getByRole('button', { name: /Zoom 100%/ })).toBeInTheDocument();
    expect(within(toolbar).queryByRole('button', { name: 'Search' })).toBeNull();
    expect(within(toolbar).queryByRole('textbox')).toBeNull();
  });

  it('toggles raw view for markdown and hides zoom for video', async () => {
    const { unmount } = render(
      <DocumentPreviewer document={{ id: 'm', name: 'readme.md' }} resolver={resolver} />,
    );
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Show source' }));
    expect(await screen.findByRole('document', { name: 'readme.md (source)' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show formatted' }));
    expect(await screen.findByRole('article', { name: 'readme.md' })).toBeInTheDocument();
    unmount();
    render(
      <DocumentPreviewer
        document={{ id: 'v', name: 'clip.mp4', url: 'https://cdn/clip.mp4' } as PreviewDocument}
      />,
    );
    fireEvent.loadedMetadata(await screen.findByLabelText('clip.mp4'));
    await ready();
    expect(screen.queryByRole('button', { name: 'Zoom in' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Search' })).toBeNull();
  });

  it('toggles fullscreen when supported', async () => {
    Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, value: true });
    const request = jest.fn(async () => undefined);
    HTMLElement.prototype.requestFullscreen = request;
    render(<DocumentPreviewer document={{ id: 't', name: 'notes.txt' }} resolver={resolver} />);
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Fullscreen' }));
    await waitFor(() => expect(request).toHaveBeenCalled());
    fireEvent.keyDown(document.querySelector('.dsc-root')!, { key: 'f' });
    await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, value: false });
  });
});
