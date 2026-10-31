import { LruCache, createCaches } from '../cache';
import { DEFAULT_CONFIG, DEFAULT_SHORTCUTS, resolveConfig } from '../config';
import {
  getExtension,
  getMimeType,
  isGenericMime,
  mimeFromExtension,
  normalizeMime,
} from '../detect';
import {
  DocumentPreviewError,
  defaultMessage,
  errorFromStatus,
  isAbortError,
  sanitizeMessage,
  toPreviewError,
} from '../errors';
import { clamp, formatBytes, formatDate, humanizeKey } from '../format';
import { RendererRegistry, defineRenderer } from '../registry';
import { escapeRegExp, findTextMatches, segmentText, textIncludes, wrapIndex } from '../search';
import {
  findShortcutAction,
  isApplePlatform,
  isEditableTarget,
  isSingleKeyCombo,
  matchesShortcut,
  parseShortcut,
} from '../shortcuts';
import { builtInRenderers, createDefaultRegistry } from '../../renderers/definitions';
import type { PreviewErrorCode, RendererDefinition } from '../../types';

describe('detect', () => {
  it('derives extensions from explicit value, name and url', () => {
    expect(getExtension({ name: 'x', extension: '.PDF' })).toBe('pdf');
    expect(getExtension({ name: 'Report.Final.DOCX' })).toBe('docx');
    expect(
      getExtension({ name: 'noext', url: 'https://cdn.example.com/a/b/file.csv?sig=abc' }),
    ).toBe('csv');
    expect(getExtension({ name: 'noext', url: 'blob:http://x/123' })).toBe('');
    expect(getExtension({ name: '.hidden' })).toBe('');
    expect(getExtension({ name: 'trailing.' })).toBe('');
    expect(getExtension({ name: 'a', url: 'http://[bad' })).toBe('');
    expect(getExtension({ name: '' })).toBe('');
  });

  it('maps MIME types', () => {
    expect(mimeFromExtension('PDF')).toBe('application/pdf');
    expect(mimeFromExtension('zzz')).toBeUndefined();
    expect(normalizeMime('Text/CSV; charset=utf-8')).toBe('text/csv');
    expect(normalizeMime(undefined)).toBe('');
    expect(getMimeType({ id: '1', name: 'a.json' })).toBe('application/json');
    expect(getMimeType({ id: '1', name: 'a', type: 'image/png' })).toBe('image/png');
    expect(getMimeType({ id: '1', name: 'a' })).toBe('');
    expect(isGenericMime('application/octet-stream')).toBe(true);
    expect(isGenericMime('application/pdf')).toBe(false);
  });
});

describe('errors', () => {
  it('serialises and classifies', () => {
    const e = new DocumentPreviewError('FETCH_FAILED', 'nope', { status: 500, cause: 'x' });
    e.documentId = 'd1';
    expect(e.toJSON()).toEqual({
      code: 'FETCH_FAILED',
      message: 'nope',
      status: 500,
      documentId: 'd1',
    });
    expect(new DocumentPreviewError('RENDER_FAILED', 'm').toJSON()).toEqual({
      code: 'RENDER_FAILED',
      message: 'm',
    });
    expect(errorFromStatus(403).code).toBe('ACCESS_DENIED');
    expect(errorFromStatus(401).code).toBe('ACCESS_DENIED');
    expect(errorFromStatus(404).code).toBe('NOT_FOUND');
    expect(errorFromStatus(410).code).toBe('NOT_FOUND');
    expect(errorFromStatus(500)).toMatchObject({ code: 'FETCH_FAILED', status: 500 });
  });

  it('never leaks urls or credentials in messages', () => {
    const msg = sanitizeMessage(
      'GET https://bucket.s3.amazonaws.com/a.pdf?X-Amz-Signature=secret failed; Authorization: Bearer abc.def-ghi',
    );
    expect(msg).not.toContain('secret');
    expect(msg).not.toContain('abc.def');
    expect(msg).toContain('[url]');
    expect(toPreviewError(new Error('see blob:http://x/1'), 'RENDER_FAILED').message).toBe(
      'see [url]',
    );
    expect(toPreviewError('plain', 'RENDER_FAILED').message).toBe('plain');
    expect(toPreviewError({}, 'NOT_FOUND').message).toBe(defaultMessage('NOT_FOUND'));
    const existing = new DocumentPreviewError('TOO_LARGE', 'big');
    expect(toPreviewError(existing, 'RENDER_FAILED')).toBe(existing);
  });

  it('has a default message for every code', () => {
    const codes: PreviewErrorCode[] = [
      'RESOLVE_FAILED',
      'FETCH_FAILED',
      'ACCESS_DENIED',
      'NOT_FOUND',
      'UNSUPPORTED_FORMAT',
      'TOO_LARGE',
      'EMPTY_DOCUMENT',
      'MALFORMED_DOCUMENT',
      'RENDER_FAILED',
      'DOWNLOAD_FAILED',
    ];
    for (const c of codes) expect(defaultMessage(c).length).toBeGreaterThan(5);
  });

  it('detects abort errors', () => {
    expect(isAbortError(new DOMException('x', 'AbortError'))).toBe(true);
    expect(isAbortError({ name: 'AbortException' })).toBe(true);
    expect(isAbortError(new Error('x'))).toBe(false);
    expect(isAbortError(null)).toBe(false);
  });
});

describe('config', () => {
  it('returns defaults', () => {
    const c = resolveConfig();
    expect(c.theme).toBe('system');
    expect(c.shortcuts).toEqual(DEFAULT_SHORTCUTS);
    expect(c.className).toBeUndefined();
    expect(c.pdf.workerSrc).toBeUndefined();
  });

  it('merges nested values with later configs winning', () => {
    const c = resolveConfig(
      {
        theme: 'dark',
        zoom: { step: 0.5 },
        labels: { download: 'Get' },
        pdf: { scrollMode: 'single' },
      },
      { zoom: { min: 0.5 }, className: 'x', pdf: { workerSrc: '/w.js' }, csv: { delimiter: ';' } },
    );
    expect(c.theme).toBe('dark');
    expect(c.zoom).toMatchObject({ step: 0.5, min: 0.5 });
    expect(c.labels.download).toBe('Get');
    expect(c.labels.close).toBe('Close');
    expect(c.pdf).toMatchObject({ scrollMode: 'single', workerSrc: '/w.js' });
    expect(c.csv.delimiter).toBe(';');
    expect(c.className).toBe('x');
  });

  it('falls back on invalid values', () => {
    const c = resolveConfig({
      theme: 'neon' as never,
      prefetch: 'all' as never,
      zoom: { default: 999, min: -5, defaultFit: 'bogus' as never },
      pdf: { scrollMode: 'diagonal' as never, overscan: 99 },
      searchDebounce: Number.NaN,
    });
    expect(c.theme).toBe('system');
    expect(c.prefetch).toBe('adjacent');
    expect(c.zoom.min).toBe(0.01);
    expect(c.zoom.default).toBe(c.zoom.max);
    expect(c.zoom.defaultFit).toBe(DEFAULT_CONFIG.zoom.defaultFit);
    expect(c.pdf.scrollMode).toBe('continuous');
    expect(c.pdf.overscan).toBe(20);
    expect(c.searchDebounce).toBe(DEFAULT_CONFIG.searchDebounce);
  });

  it('customises and disables shortcuts', () => {
    const c = resolveConfig({
      shortcuts: { search: ['mod+k'], rotate: false, bogus: ['x'] } as never,
    });
    expect(c.shortcuts.search).toEqual(['mod+k']);
    expect(c.shortcuts.rotate).toEqual([]);
    expect(c.shortcuts.zoomIn).toEqual(DEFAULT_SHORTCUTS.zoomIn);
    const off = resolveConfig({ shortcuts: false });
    expect(Object.values(off.shortcuts).every((v) => v.length === 0)).toBe(true);
    const reenabled = resolveConfig({ shortcuts: false }, { shortcuts: { search: ['/'] } });
    expect(reenabled.shortcuts.search).toEqual(['/']);
    expect(reenabled.shortcuts.zoomIn).toEqual(DEFAULT_SHORTCUTS.zoomIn);
  });
});

describe('LruCache', () => {
  it('evicts least recently used entries over budget', () => {
    const c = new LruCache<string>(10, (s) => s.length);
    c.set('a', 'aaaa');
    c.set('b', 'bbbb');
    expect(c.get('a')).toBe('aaaa'); // a becomes most recent
    c.set('c', 'cccc'); // evicts b
    expect(c.has('b')).toBe(false);
    expect(c.has('a')).toBe(true);
    expect(c.bytes).toBe(8);
    expect(c.size).toBe(2);
    c.set('huge', 'x'.repeat(50));
    expect(c.has('huge')).toBe(false);
    c.set('a', 'aa');
    expect(c.bytes).toBe(6);
    expect(c.delete('zzz')).toBe(false);
    c.setMaxBytes(3);
    expect(c.size).toBe(1);
    c.clear();
    expect(c.size).toBe(0);
    expect(c.get('a')).toBeUndefined();
  });

  it('creates blob and text caches', () => {
    const caches = createCaches(1000);
    caches.blobs.set('x', new Blob(['12345']));
    expect(caches.blobs.bytes).toBe(5);
    caches.text.set('t', 'abc');
    expect(caches.text.bytes).toBe(6);
    const def = new LruCache<number>(2);
    def.set('a', 1);
    def.set('b', 2);
    def.set('c', 3);
    expect(def.has('a')).toBe(false);
  });
});

describe('search', () => {
  it('finds matches case-insensitively by default', () => {
    expect(findTextMatches('Invoice and invoice', 'invoice')).toEqual([
      { start: 0, end: 7 },
      { start: 12, end: 19 },
    ]);
    expect(findTextMatches('Invoice and invoice', 'invoice', true)).toEqual([
      { start: 12, end: 19 },
    ]);
    expect(findTextMatches('a  b\nc', 'a b')).toEqual([{ start: 0, end: 4 }]);
    expect(findTextMatches('text', '   ')).toEqual([]);
    expect(findTextMatches('', 'x')).toEqual([]);
    expect(findTextMatches('aaaa', 'a', false, 2)).toHaveLength(2);
    expect(findTextMatches('a.b', '.')).toEqual([{ start: 1, end: 2 }]);
  });

  it('helpers', () => {
    expect(escapeRegExp('a+b?')).toBe('a\\+b\\?');
    expect(textIncludes('Hello', 'hell')).toBe(true);
    expect(textIncludes('Hello', 'hell', true)).toBe(false);
    expect(textIncludes('Hello', ' ')).toBe(false);
    expect(wrapIndex(5, 3)).toBe(2);
    expect(wrapIndex(-1, 3)).toBe(2);
    expect(wrapIndex(0, 0)).toBe(-1);
    expect(
      segmentText('abcabc', [
        { start: 1, end: 2 },
        { start: 4, end: 5 },
      ]),
    ).toEqual([
      { text: 'a', match: null },
      { text: 'b', match: 0 },
      { text: 'ca', match: null },
      { text: 'b', match: 1 },
      { text: 'c', match: null },
    ]);
    expect(segmentText('abc', [])).toEqual([{ text: 'abc', match: null }]);
    expect(segmentText('ab', [{ start: 0, end: 2 }])).toEqual([{ text: 'ab', match: 0 }]);
  });
});

describe('shortcuts', () => {
  const ev = (key: string, mods: Partial<KeyboardEvent> = {}) =>
    ({
      key,
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      shiftKey: false,
      ...mods,
    }) as KeyboardEvent;

  it('parses combos', () => {
    expect(parseShortcut('mod+shift+F')).toMatchObject({ key: 'F', mod: true, shift: true });
    expect(parseShortcut('mod++')).toMatchObject({ key: '+', mod: true });
    expect(parseShortcut('+')).toMatchObject({ key: '+' });
    expect(parseShortcut('ctrl+alt+meta+x')).toMatchObject({ ctrl: true, alt: true, meta: true });
    expect(parseShortcut('control+option+cmd+y')).toMatchObject({
      ctrl: true,
      alt: true,
      meta: true,
    });
  });

  it('matches mod per platform', () => {
    expect(matchesShortcut(ev('f', { ctrlKey: true }), 'mod+f', false)).toBe(true);
    expect(matchesShortcut(ev('f', { metaKey: true }), 'mod+f', true)).toBe(true);
    expect(matchesShortcut(ev('f', { metaKey: true }), 'mod+f', false)).toBe(false);
    expect(matchesShortcut(ev('F3', { shiftKey: true }), 'shift+F3', false)).toBe(true);
    expect(matchesShortcut(ev('F3', { shiftKey: true }), 'F3', false)).toBe(false);
    expect(matchesShortcut(ev('F3'), 'shift+F3', false)).toBe(false);
    expect(matchesShortcut(ev('+', { shiftKey: true }), '+', false)).toBe(true);
    expect(matchesShortcut(ev('x'), 'shift', false)).toBe(false);
  });

  it('finds actions and filters editable targets', () => {
    expect(findShortcutAction(ev('ArrowRight', { altKey: true }), DEFAULT_SHORTCUTS, false)).toBe(
      'nextDocument',
    );
    expect(findShortcutAction(ev('q'), DEFAULT_SHORTCUTS, false)).toBeUndefined();
    const input = document.createElement('input');
    expect(isEditableTarget(input)).toBe(true);
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    expect(isEditableTarget(cb)).toBe(false);
    expect(isEditableTarget(document.createElement('textarea'))).toBe(true);
    expect(isEditableTarget(document.createElement('select'))).toBe(true);
    const div = document.createElement('div');
    Object.defineProperty(div, 'isContentEditable', { value: true });
    expect(isEditableTarget(div)).toBe(true);
    expect(isEditableTarget(document.createElement('button'))).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
    expect(isSingleKeyCombo('f')).toBe(true);
    expect(isSingleKeyCombo('mod+f')).toBe(false);
    expect(isSingleKeyCombo('PageDown')).toBe(false);
    expect(typeof isApplePlatform()).toBe('boolean');
  });
});

describe('format', () => {
  it('formats bytes, dates and keys', () => {
    expect(formatBytes(500)).toBe('500 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(20 * 1024 * 1024)).toBe('20 MB');
    expect(formatBytes(-1)).toBe('');
    expect(formatBytes(undefined)).toBe('');
    expect(formatDate('2026-01-02T03:04:05Z', 'en-US')).toMatch(/2026/);
    expect(formatDate(new Date(0), 'en-US')).toMatch(/19(69|70)/);
    expect(formatDate('not a date')).toBe('not a date');
    expect(formatDate({})).toBe('');
    expect(humanizeKey('uploadedAt')).toBe('Uploaded at');
    expect(humanizeKey('file_size')).toBe('File size');
    expect(clamp(5, 0, 3)).toBe(3);
  });
});

describe('RendererRegistry', () => {
  const stub = (id: string, extra: Partial<RendererDefinition> = {}): RendererDefinition => ({
    id,
    label: id,
    mimeTypes: [],
    extensions: [],
    capabilities: {},
    loadingStrategy: 'blob',
    load: async () => ({ default: () => null }),
    ...extra,
  });

  it('resolves built-ins by mime, extension and wildcard', () => {
    const r = createDefaultRegistry();
    const id = (doc: Parameters<RendererRegistry['resolve']>[0], mime?: string) =>
      r.resolve(doc, mime)?.id;
    expect(id({ id: '1', name: 'a.pdf' })).toBe('pdf');
    expect(id({ id: '1', name: 'file', type: 'application/pdf' })).toBe('pdf');
    expect(id({ id: '1', name: 'a.PNG' })).toBe('image');
    expect(id({ id: '1', name: 'x', type: 'image/x-portable-bitmap' })).toBe('image');
    expect(id({ id: '1', name: 'a.docx', type: 'application/octet-stream' })).toBe('docx');
    expect(id({ id: '1', name: 'a.md', type: 'text/plain' })).toBe('markdown');
    expect(id({ id: '1', name: 'a.txt', type: 'text/plain' })).toBe('text');
    expect(id({ id: '1', name: 'readme', type: 'text/x-unknown' })).toBe('text');
    expect(id({ id: '1', name: 'notes.log' })).toBe('text');
    expect(id({ id: '1', name: 'a.svg' })).toBe('image');
    expect(id({ id: '1', name: 'feed.xml' })).toBe('xml');
    expect(id({ id: '1', name: 'x', type: 'application/vnd.api+json' })).toBe('json');
    expect(id({ id: '1', name: 'a.tsv' })).toBe('csv');
    expect(id({ id: '1', name: 'a.xlsx' })).toBe('xlsx');
    expect(id({ id: '1', name: 'a.pptx' })).toBe('pptx');
    expect(id({ id: '1', name: 'clip.webm' })).toBe('video');
    expect(id({ id: '1', name: 'clip', type: 'video/x-matroska' })).toBe('video');
    expect(id({ id: '1', name: 'blob' }, 'application/json')).toBe('json');
    expect(id({ id: '1', name: 'thing.bin' })).toBeUndefined();
    expect(id({ id: '1', name: 'archive', type: 'application/zip' })).toBeUndefined();
    expect(id({ id: '1', name: 'p', type: 'text/plain' })).toBe('text');
  });

  it('supports custom renderers, priority, replacement and removal', () => {
    const r = createDefaultRegistry([stub('dwg', { extensions: ['dwg'] })]);
    expect(r.resolve({ id: '1', name: 'plan.dwg' })?.id).toBe('dwg');
    r.register(stub('pdf2', { mimeTypes: ['application/pdf'], priority: 5 }));
    expect(r.resolve({ id: '1', name: 'x', type: 'application/pdf' })?.id).toBe('pdf2');
    r.register(stub('special', { match: (d) => d.name.startsWith('special'), priority: 1 }));
    expect(r.resolve({ id: '1', name: 'special.pdf' })?.id).toBe('special');
    expect(r.unregister('special')).toBe(true);
    expect(r.get('dwg')?.id).toBe('dwg');
    expect(r.list().length).toBe(builtInRenderers.length + 2);
    expect(defineRenderer(stub('z')).id).toBe('z');
  });

  it('validates definitions', () => {
    const r = new RendererRegistry();
    expect(() => r.register({} as RendererDefinition)).toThrow(/id/);
    expect(() =>
      r.register({ ...stub('a'), load: undefined } as unknown as RendererDefinition),
    ).toThrow(/load/);
    expect(() =>
      r.register({ ...stub('a'), mimeTypes: undefined } as unknown as RendererDefinition),
    ).toThrow(/arrays/);
  });

  it('every built-in renderer lazily exposes a component', () => {
    for (const d of builtInRenderers) {
      expect(typeof d.load).toBe('function');
      expect(d.extensions.length).toBeGreaterThan(0);
    }
  });
});
