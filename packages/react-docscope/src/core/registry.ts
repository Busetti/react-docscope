import type { PreviewDocument, RendererDefinition } from '../types';
import { getExtension, getMimeType, isGenericMime, normalizeMime } from './detect';

/**
 * Registry of renderer definitions. Lookup order:
 * 1. custom `match()` functions (highest priority first)
 * 2. exact MIME type (unless generic, e.g. octet-stream)
 * 3. wildcard MIME (`image/*`)
 * 4. extension
 */
export class RendererRegistry {
  private readonly renderers = new Map<string, RendererDefinition>();

  constructor(definitions: RendererDefinition[] = []) {
    for (const d of definitions) this.register(d);
  }

  register(definition: RendererDefinition): this {
    validateDefinition(definition);
    this.renderers.set(definition.id, definition);
    return this;
  }

  unregister(id: string): boolean {
    return this.renderers.delete(id);
  }

  get(id: string): RendererDefinition | undefined {
    return this.renderers.get(id);
  }

  list(): RendererDefinition[] {
    return [...this.renderers.values()];
  }

  /** Returns a new registry containing this registry's renderers plus `extra` (extra wins). */
  extend(extra: RendererDefinition[] | undefined): RendererRegistry {
    const next = new RendererRegistry(this.list());
    for (const d of extra ?? []) next.register(d);
    return next;
  }

  resolve(document: PreviewDocument, mimeOverride?: string): RendererDefinition | undefined {
    const sorted = this.list().sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
    for (const d of sorted) {
      if (d.match?.(document)) return d;
    }
    const override = normalizeMime(mimeOverride);
    const mime = override && !isGenericMime(override) ? override : getMimeType(document);
    // Servers frequently report `text/plain` for .md/.csv/.json: prefer the extension then.
    if (mime === 'text/plain') {
      const ext = getExtension(document);
      const byExt = ext ? sorted.find((d) => d.extensions.includes(ext)) : undefined;
      if (byExt) return byExt;
    }
    if (mime && !isGenericMime(mime)) {
      const exact = sorted.find((d) => d.mimeTypes.map(normalizeMime).includes(mime));
      if (exact) return exact;
    }
    const ext = getExtension(document);
    if (ext) {
      const byExt = sorted.find((d) =>
        d.extensions.some((e) => e.replace(/^\./, '').toLowerCase() === ext),
      );
      if (byExt) return byExt;
    }
    if (mime && !isGenericMime(mime)) {
      const family = mime.split('/')[0];
      const wildcard = sorted.find((d) => d.mimeTypes.includes(`${family}/*`));
      if (wildcard) return wildcard;
    }
    return undefined;
  }
}

function validateDefinition(d: RendererDefinition): void {
  if (!d || typeof d.id !== 'string' || !d.id)
    throw new TypeError('Renderer definition requires an id.');
  if (typeof d.load !== 'function')
    throw new TypeError(`Renderer "${d.id}" requires a load() function.`);
  if (!Array.isArray(d.mimeTypes) || !Array.isArray(d.extensions)) {
    throw new TypeError(`Renderer "${d.id}" requires mimeTypes and extensions arrays.`);
  }
}

/** Identity helper giving consumers type inference when declaring renderers. */
export function defineRenderer(definition: RendererDefinition): RendererDefinition {
  return definition;
}
