import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const FIXTURES = join(__dirname, '..', 'fixtures');

export function fixtureBuffer(name: string): ArrayBuffer {
  const b = readFileSync(join(FIXTURES, name));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
}

export function fixtureText(name: string): string {
  return readFileSync(join(FIXTURES, name), 'utf8');
}

export function fixtureBlob(name: string, type = ''): Blob {
  return new Blob([new Uint8Array(fixtureBuffer(name))], { type });
}

/** Minimal fetch Response stand-in for jsdom. */
export function mockResponse(
  body: BlobPart | null,
  init: { status?: number; type?: string; length?: number } = {},
): Response {
  const status = init.status ?? 200;
  const blob = new Blob(body === null ? [] : [body], { type: init.type ?? '' });
  const headers = new Map<string, string>();
  if (init.type) headers.set('content-type', init.type);
  if (init.length !== undefined) headers.set('content-length', String(init.length));
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k: string) => headers.get(k.toLowerCase()) ?? null },
    blob: async () => blob,
  } as unknown as Response;
}
