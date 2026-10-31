import { createContext, useContext, useMemo, useRef } from 'react';
import type { ReactNode } from 'react';
import type {
  DocumentResolver,
  PreviewConfig,
  RendererDefinition,
  ResolvedPreviewConfig,
} from '../types';
import { createCaches, type PreviewCaches } from '../core/cache';
import { resolveConfig } from '../core/config';
import { defaultResolver } from '../core/source';
import type { RendererRegistry } from '../core/registry';
import { createDefaultRegistry } from '../renderers/definitions';
import { useStableValue } from '../hooks/utils';

export interface PreviewEnvironment {
  resolver: DocumentResolver;
  config: ResolvedPreviewConfig;
  registry: RendererRegistry;
  caches: PreviewCaches;
}

interface ProviderValue {
  resolver?: DocumentResolver;
  config?: PreviewConfig;
  registry: RendererRegistry;
  caches: PreviewCaches;
}

const PreviewContext = createContext<ProviderValue | null>(null);

export interface DocumentProviderProps {
  /** Shared resolver for every previewer below. */
  resolver?: DocumentResolver;
  /** Shared configuration; component-level config is merged on top. */
  config?: PreviewConfig;
  /** Custom renderers, added to (or replacing) the built-ins. */
  renderers?: RendererDefinition[];
  children: ReactNode;
}

/**
 * Optional provider sharing a resolver, configuration, renderer registry and
 * a bounded memory cache between previewers (e.g. a list of inline previews
 * and a modal).
 */
export function DocumentProvider({ resolver, config, renderers, children }: DocumentProviderProps) {
  const stableConfig = useStableValue(config);
  const stableRenderers = useStableValue(renderers);
  const registry = useMemo(() => createDefaultRegistry(stableRenderers), [stableRenderers]);
  const cacheSize = resolveConfig(stableConfig).cacheSize;
  const caches = useMemo(() => createCaches(cacheSize), [cacheSize]);
  const value = useMemo<ProviderValue>(
    () => ({ resolver, config: stableConfig, registry, caches }),
    [resolver, stableConfig, registry, caches],
  );
  return <PreviewContext.Provider value={value}>{children}</PreviewContext.Provider>;
}

export function usePreviewContext(): ProviderValue | null {
  return useContext(PreviewContext);
}

/** Merges provider-level and component-level settings into one environment. */
export function usePreviewEnvironment(props: {
  resolver?: DocumentResolver;
  config?: PreviewConfig;
  renderers?: RendererDefinition[];
}): PreviewEnvironment {
  const ctx = usePreviewContext();
  const stableConfig = useStableValue(props.config);
  const stableRenderers = useStableValue(props.renderers);
  const config = useMemo(
    () => resolveConfig(ctx?.config, stableConfig),
    [ctx?.config, stableConfig],
  );
  const registry = useMemo(() => {
    const base = ctx?.registry ?? createDefaultRegistry();
    return stableRenderers?.length ? base.extend(stableRenderers) : base;
  }, [ctx?.registry, stableRenderers]);
  const ownCaches = useRef<PreviewCaches | null>(null);
  if (!ctx && !ownCaches.current) ownCaches.current = createCaches(config.cacheSize);
  const caches = ctx?.caches ?? ownCaches.current!;
  const resolver = props.resolver ?? ctx?.resolver ?? defaultResolver;
  return useMemo(
    () => ({ resolver, config, registry, caches }),
    [resolver, config, registry, caches],
  );
}
