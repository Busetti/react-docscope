import { render, waitFor } from '@testing-library/react';
import type { ComponentType } from 'react';
import { ManagedSource } from '../../packages/react-docscope/src/core/source';
import { resolveConfig } from '../../packages/react-docscope/src/core/config';
import type {
  PreviewConfig,
  RendererHost,
  RendererProps,
  ResolvedDocument,
  SearchState,
  ViewState,
} from '../../packages/react-docscope/src/types';
import { fixtureBlob } from './fixtures';

export function createHost(): jest.Mocked<RendererHost> {
  return {
    setPageCount: jest.fn(),
    setCurrentPage: jest.fn(),
    setSearchResults: jest.fn(),
    setEffectiveZoom: jest.fn(),
    requestZoom: jest.fn(),
    setReady: jest.fn(),
    setError: jest.fn(),
  };
}

export const defaultView: ViewState = {
  zoom: 1,
  fitMode: 'none',
  rotation: 0,
  page: 1,
  scrollMode: 'continuous',
  rawView: false,
  showThumbnails: false,
};

export const noSearch: SearchState = { query: '', caseSensitive: false, activeIndex: -1 };

export interface HarnessOptions {
  name: string;
  fixture?: string;
  blob?: Blob;
  resolved?: ResolvedDocument;
  view?: Partial<ViewState>;
  search?: Partial<SearchState>;
  config?: PreviewConfig;
  type?: string;
}

/** Renders a renderer component directly with a mocked host. */
export function renderRenderer(Component: ComponentType<RendererProps>, options: HarnessOptions) {
  const host = createHost();
  const blob =
    options.blob ??
    (options.fixture ? fixtureBlob(options.fixture, options.type ?? '') : new Blob([]));
  const document = {
    id: options.name,
    name: options.name,
    ...(options.type ? { type: options.type } : {}),
  };
  const ctrl = new AbortController();
  const source = new ManagedSource({
    document,
    resolved: options.resolved ?? { kind: 'blob', blob },
    signal: ctrl.signal,
    maxFileSize: 1e9,
  });
  const config = resolveConfig(options.config);
  const props = (
    view: Partial<ViewState> = {},
    search: Partial<SearchState> = {},
  ): RendererProps => ({
    document,
    source,
    view: { ...defaultView, ...options.view, ...view },
    search: { ...noSearch, ...options.search, ...search },
    host,
    config,
    signal: ctrl.signal,
  });
  const utils = render(<Component {...props()} />);
  return {
    ...utils,
    host,
    source,
    ctrl,
    update: (view: Partial<ViewState> = {}, search: Partial<SearchState> = {}) =>
      utils.rerender(<Component {...props(view, search)} />),
    ready: () => waitFor(() => expect(host.setReady).toHaveBeenCalled(), { timeout: 10000 }),
    failed: () => waitFor(() => expect(host.setError).toHaveBeenCalled(), { timeout: 10000 }),
  };
}

export function lastCall<T extends (...args: never[]) => unknown>(
  fn: jest.Mock | T,
): Parameters<T> {
  const calls = (fn as jest.Mock).mock.calls;
  return calls[calls.length - 1] as Parameters<T>;
}
