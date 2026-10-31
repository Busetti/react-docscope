import { fireEvent, screen, waitFor } from '@testing-library/react';
import DocxRenderer from '../docx/DocxRenderer';
import PptxRenderer from '../pptx/PptxRenderer';
import ImageRenderer, { computeImageScale } from '../image/ImageRenderer';
import VideoRenderer from '../video/VideoRenderer';
import {
  borderOf,
  fillToCss,
  fixParagraphSpacing,
  safeContent,
  slideText,
  transformOf,
} from '../pptx/slideModel';
import { lastCall, renderRenderer } from '../../../../../tests/setup/renderer-harness';

describe('DocxRenderer', () => {
  it('renders a real .docx and supports search + fit width', async () => {
    const r = renderRenderer(DocxRenderer, {
      name: 'proposal.docx',
      fixture: 'proposal.docx',
      view: { fitMode: 'width' },
    });
    await r.ready();
    const doc = screen.getByRole('document', { name: 'proposal.docx' });
    expect(doc).toHaveTextContent('Project Proposal');
    expect(doc).toHaveTextContent('Discovery');
    expect(doc.querySelector('table')).not.toBeNull();
    expect(doc.querySelector('img')?.getAttribute('src')).toMatch(/^data:image\//);
    await waitFor(() => expect(r.host.setEffectiveZoom).toHaveBeenCalled());
    r.update({ fitMode: 'none', zoom: 1.5 }, { query: 'proposal', activeIndex: 1 });
    await waitFor(() => expect(lastCall(r.host.setSearchResults)[0]).toBeGreaterThanOrEqual(3));
    expect(doc.querySelectorAll('mark.dsc-mark').length).toBeGreaterThanOrEqual(3);
    r.update({ fitMode: 'none', zoom: 1.5 }, { query: '', activeIndex: -1 });
    await waitFor(() => expect(doc.querySelector('mark.dsc-mark')).toBeNull());
  });

  it('reports damaged documents', async () => {
    const r = renderRenderer(DocxRenderer, { name: 'malformed.docx', fixture: 'malformed.docx' });
    await r.failed();
    expect(r.host.setError).toHaveBeenCalledWith(
      'MALFORMED_DOCUMENT',
      expect.stringMatching(/Word document/),
    );
  });
});

describe('PptxRenderer', () => {
  it('renders slides, thumbnails and page navigation', async () => {
    const r = renderRenderer(PptxRenderer, {
      name: 'deck.pptx',
      fixture: 'deck.pptx',
      view: { fitMode: 'width' },
    });
    await r.ready();
    expect(r.host.setPageCount).toHaveBeenCalledWith(4);
    const slides = screen.getAllByRole('group', { name: /^Slide \d$/ });
    expect(slides).toHaveLength(4);
    expect(slides[0]).toHaveTextContent('Quarterly Business Review');
    expect(slides[3]!.querySelector('table')).not.toBeNull();
    expect(slides[2]!.querySelector('img')?.getAttribute('src')).toMatch(/^data:image\/jpeg/);
    r.update({ fitMode: 'width', showThumbnails: true });
    const nav = screen.getByRole('navigation', { name: 'Slide thumbnails' });
    fireEvent.click(screen.getByRole('button', { name: /Slide 3:/ }));
    expect(r.host.setCurrentPage).toHaveBeenCalledWith(3);
    expect(nav).toHaveAttribute('data-dsc-search-ignore');
    r.update(
      { fitMode: 'none', zoom: 0.5, page: 3, showThumbnails: true },
      { query: 'retention', activeIndex: 0 },
    );
    await waitFor(() => expect(lastCall(r.host.setSearchResults)[0]).toBe(1)); // thumbnails are not double counted
  });

  it('reports damaged presentations', async () => {
    const r = renderRenderer(PptxRenderer, { name: 'malformed.pptx', fixture: 'malformed.pptx' });
    await r.failed();
    expect(r.host.setError).toHaveBeenCalledWith(
      'MALFORMED_DOCUMENT',
      expect.stringMatching(/presentation/),
    );
  });

  it('slide model helpers', () => {
    // pptxtojson 2.2 emits percentage spacing divided by 1000 instead of 100000.
    expect(fixParagraphSpacing('<p style="margin-top: 20em;margin-bottom: 0.5em">')).toBe(
      '<p style="margin-top: 0.200em;margin-bottom: 0.5em">',
    );
    expect(safeContent('<p onclick="x">A&nbsp;B<script>bad()</script></p>')).toBe('<p>A B</p>');
    expect(safeContent(undefined)).toBe('');
    expect(fillToCss({ type: 'color', value: '#fff' })).toEqual({ background: '#fff' });
    expect(fillToCss({ type: 'color', value: '' })).toEqual({});
    expect(
      fillToCss({ type: 'image', value: { base64: 'data:image/png;base64,AA' } }),
    ).toMatchObject({ backgroundSize: 'cover' });
    expect(fillToCss({ type: 'image', value: { base64: 'javascript:x' } })).toEqual({});
    expect(
      fillToCss({ type: 'gradient', value: { rot: 0, colors: [{ pos: '0%', color: 'red' }] } }),
    ).toEqual({ background: 'linear-gradient(90deg, red 0%)' });
    expect(
      fillToCss({
        type: 'gradient',
        value: { path: 'circle', colors: [{ pos: '0%', color: 'red' }] },
      }),
    ).toEqual({ background: 'radial-gradient(red 0%)' });
    expect(fillToCss({ type: 'gradient', value: { colors: [] } })).toEqual({});
    expect(fillToCss({ type: 'pattern', value: { backgroundColor: '#000' } })).toEqual({
      background: '#000',
    });
    expect(fillToCss({ type: 'pattern', value: {} })).toEqual({});
    expect(fillToCss(null)).toEqual({});
    expect(fillToCss({ type: 'other' } as never)).toEqual({});
    expect(transformOf({ rotate: 90, isFlipH: true, isFlipV: true } as never)).toBe(
      'rotate(90deg) scaleX(-1) scaleY(-1)',
    );
    expect(transformOf({} as never)).toBeUndefined();
    expect(
      borderOf({ borderWidth: 1, borderColor: '#000', borderType: 'dashed' } as never),
    ).toEqual({ border: '1pt dashed #000' });
    expect(borderOf({ borderWidth: 1, borderColor: '#000', borderType: 'wavy' } as never)).toEqual({
      border: '1pt solid #000',
    });
    expect(borderOf({} as never)).toEqual({});
    expect(
      slideText({
        elements: [{ content: '<p>A&nbsp;b</p>', elements: [{ content: '<i>c</i>' }] }],
      } as never),
    ).toBe('A b c');
  });
});

describe('ImageRenderer', () => {
  function load(img: HTMLImageElement, w = 800, h = 600) {
    Object.defineProperty(img, 'naturalWidth', { configurable: true, value: w });
    Object.defineProperty(img, 'naturalHeight', { configurable: true, value: h });
    fireEvent.load(img);
  }

  it('renders, fits, rotates and pans', async () => {
    const r = renderRenderer(ImageRenderer, {
      name: 'photo.jpg',
      fixture: 'photo.jpg',
      type: 'image/jpeg',
      view: { fitMode: 'page' },
    });
    const img = await screen.findByAltText('photo.jpg');
    expect(img.getAttribute('src')).toMatch(/^blob:/);
    load(img as HTMLImageElement);
    await r.ready();
    expect(r.host.setEffectiveZoom).toHaveBeenCalled();
    r.update({ fitMode: 'none', zoom: 3, rotation: 90 });
    expect(img.style.transform).toContain('rotate(90deg)');
    const scroller = img.closest('.dsc-image') as HTMLElement;
    expect(scroller).toHaveAttribute('data-pannable', 'true');
    fireEvent.pointerDown(scroller, { button: 0, clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(scroller, { clientX: 50, clientY: 70, pointerId: 1 });
    fireEvent.pointerUp(scroller, { pointerId: 1 });
    expect(scroller.scrollLeft).toBe(50);
    expect(scroller.scrollTop).toBe(30);
    fireEvent.pointerMove(scroller, { clientX: 0, clientY: 0, pointerId: 1 }); // no drag in progress
    expect(scroller.scrollLeft).toBe(50);
    fireEvent.wheel(scroller, { deltaY: -100, ctrlKey: true });
    expect(r.host.requestZoom).toHaveBeenCalled();
    fireEvent.wheel(scroller, { deltaY: -100 });
  });

  it('reports undecodable images', async () => {
    const r = renderRenderer(ImageRenderer, { name: 'broken.png', fixture: 'broken-image.png' });
    fireEvent.error(await screen.findByAltText('broken.png'));
    expect(r.host.setError).toHaveBeenCalledWith('MALFORMED_DOCUMENT', expect.any(String));
  });

  it('computes fit scales', () => {
    const natural = { width: 1000, height: 500 };
    const box = { width: 548, height: 448 };
    expect(computeImageScale('original', 3, natural, box, 0, false)).toBe(1);
    expect(computeImageScale('none', 3, natural, box, 0, false)).toBe(3);
    expect(computeImageScale('page', 1, natural, box, 0, false)).toBeCloseTo(0.5);
    expect(computeImageScale('width', 1, natural, box, 0, false)).toBeCloseTo(0.5);
    expect(computeImageScale('page', 1, natural, box, 90, false)).toBeCloseTo(0.4);
    expect(computeImageScale('page', 1, { width: 10, height: 10 }, box, 0, false)).toBe(1);
    expect(computeImageScale('page', 1, { width: 10, height: 10 }, box, 0, true)).toBeCloseTo(40);
    expect(computeImageScale('page', 1, { width: 0, height: 0 }, box, 0, false)).toBe(1);
  });
});

describe('VideoRenderer', () => {
  it('streams URL sources with native controls', async () => {
    const r = renderRenderer(VideoRenderer, {
      name: 'clip.mp4',
      resolved: { kind: 'url', url: 'https://cdn/clip.mp4' },
    });
    const video = (await screen.findByLabelText('clip.mp4')) as HTMLVideoElement;
    expect(video).toHaveAttribute('src', 'https://cdn/clip.mp4');
    expect(video).toHaveAttribute('controls');
    expect(video).toHaveAttribute('preload', 'metadata');
    fireEvent.loadedMetadata(video);
    expect(r.host.setReady).toHaveBeenCalled();
    fireEvent.error(video);
    expect(r.host.setError).toHaveBeenCalledWith(
      'RENDER_FAILED',
      expect.stringMatching(/not be played/),
    );
    r.unmount();
  });

  it('surfaces source failures', async () => {
    (globalThis as { fetch?: unknown }).fetch = jest.fn(async () => {
      throw new TypeError('offline');
    });
    const r = renderRenderer(VideoRenderer, {
      name: 'clip.mp4',
      resolved: { kind: 'url', url: 'https://cdn/clip.mp4', headers: { A: 'b' } },
    });
    await r.failed();
    expect(r.host.setError).toHaveBeenCalledWith('FETCH_FAILED', expect.any(String));
  });
});
