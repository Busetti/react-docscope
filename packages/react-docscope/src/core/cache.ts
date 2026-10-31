/**
 * Least-recently-used cache bounded by an approximate byte budget. Used for
 * downloaded document blobs and extracted text so that switching back and forth
 * between attachments does not re-download them, while memory stays bounded.
 */
export class LruCache<V> {
  private readonly map = new Map<string, { value: V; size: number }>();
  private total = 0;

  constructor(
    private maxBytes: number,
    private readonly sizeOf: (value: V) => number = () => 1,
  ) {}

  get size(): number {
    return this.map.size;
  }

  get bytes(): number {
    return this.total;
  }

  setMaxBytes(maxBytes: number): void {
    this.maxBytes = maxBytes;
    this.evict();
  }

  get(key: string): V | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }

  has(key: string): boolean {
    return this.map.has(key);
  }

  set(key: string, value: V): void {
    const size = Math.max(0, this.sizeOf(value));
    this.delete(key);
    if (size > this.maxBytes) return; // never cache items larger than the whole budget
    this.map.set(key, { value, size });
    this.total += size;
    this.evict();
  }

  delete(key: string): boolean {
    const entry = this.map.get(key);
    if (!entry) return false;
    this.total -= entry.size;
    this.map.delete(key);
    return true;
  }

  clear(): void {
    this.map.clear();
    this.total = 0;
  }

  private evict(): void {
    while (this.total > this.maxBytes && this.map.size > 0) {
      const oldest = this.map.keys().next().value as string;
      this.delete(oldest);
    }
  }
}

/** Shared caches for one provider / previewer instance. */
export interface PreviewCaches {
  blobs: LruCache<Blob>;
  text: LruCache<string>;
}

export function createCaches(maxBytes: number): PreviewCaches {
  return {
    blobs: new LruCache<Blob>(maxBytes, (b) => b.size),
    // Strings are UTF-16 in memory: ~2 bytes per char.
    text: new LruCache<string>(Math.max(1, Math.floor(maxBytes / 4)), (s) => s.length * 2),
  };
}
