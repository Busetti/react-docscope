import { createReadStream, existsSync, statSync, cpSync, mkdirSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import type { Connect, Plugin } from 'vite';

const FIXTURES = resolve(import.meta.dirname, '../../tests/fixtures');

const TYPES: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.tsv': 'text/tab-separated-values; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
};

function fixturePath(rel: string): string | null {
  const p = normalize(join(FIXTURES, decodeURIComponent(rel)));
  if (!p.startsWith(FIXTURES) || !existsSync(p) || !statSync(p).isFile()) return null;
  return p;
}

function send(
  res: import('node:http').ServerResponse,
  req: import('node:http').IncomingMessage,
  file: string,
) {
  const size = statSync(file).size;
  const type = TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream';
  res.setHeader('Content-Type', type);
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Cache-Control', 'no-store');
  const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range ?? '');
  if (range && size > 0) {
    const start = range[1] ? Number(range[1]) : 0;
    const end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start > end || start >= size) {
      res.statusCode = 416;
      res.setHeader('Content-Range', `bytes */${size}`);
      res.end();
      return;
    }
    res.statusCode = 206;
    res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
    res.setHeader('Content-Length', String(end - start + 1));
    createReadStream(file, { start, end }).pipe(res);
    return;
  }
  res.setHeader('Content-Length', String(size));
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  createReadStream(file).pipe(res);
}

/**
 * Demo backend for the playground (dev + preview servers):
 *   /fixtures/<file>                  static fixtures with Range support
 *   /signed/<file>?expires=<ms>&sig=  mock signed URL, 403 once expired
 *   /secure/<file>                    requires "Authorization: Bearer demo-token"
 *   /status/<code>                    responds with that status
 *   /slow/<file>?ms=1500              delayed response
 */
const middleware: Connect.NextHandleFunction = (req, res, next) => {
  let url: URL;
  try {
    url = new URL(req.url ?? '/', 'http://localhost');
  } catch {
    return next();
  }
  const [, kind, ...rest] = url.pathname.split('/');
  const rel = rest.join('/');
  if (kind === 'fixtures') {
    const file = fixturePath(rel);
    if (!file) return void ((res.statusCode = 404), res.end('Not found'));
    return send(res, req, file);
  }
  if (kind === 'signed') {
    const expires = Number(url.searchParams.get('expires'));
    if (!url.searchParams.get('sig') || !Number.isFinite(expires) || Date.now() > expires) {
      res.statusCode = 403;
      res.setHeader('Content-Type', 'application/xml');
      return void res.end(
        '<Error><Code>AccessDenied</Code><Message>Request has expired</Message></Error>',
      );
    }
    const file = fixturePath(rel);
    if (!file) return void ((res.statusCode = 404), res.end('Not found'));
    return send(res, req, file);
  }
  if (kind === 'secure') {
    if (req.headers.authorization !== 'Bearer demo-token') {
      res.statusCode = 401;
      return void res.end('Unauthorized');
    }
    const file = fixturePath(rel);
    if (!file) return void ((res.statusCode = 404), res.end('Not found'));
    return send(res, req, file);
  }
  if (kind === 'status') {
    res.statusCode = Number(rel) || 500;
    return void res.end(`Status ${res.statusCode}`);
  }
  if (kind === 'slow') {
    const file = fixturePath(rel);
    const ms = Math.min(10_000, Number(url.searchParams.get('ms')) || 1500);
    if (!file) return void ((res.statusCode = 404), res.end('Not found'));
    setTimeout(() => send(res, req, file), ms);
    return;
  }
  next();
};

export function fixturesServer(): Plugin {
  let outDir = 'dist';
  return {
    name: 'docscope-playground-fixtures',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
    closeBundle() {
      // Copy the small fixtures so a static deployment of the playground still works.
      const target = join(outDir, 'fixtures');
      mkdirSync(target, { recursive: true });
      // Large generated fixtures only when asked (the Pages demo includes them).
      const withLarge = process.env.PLAYGROUND_LARGE_FIXTURES === '1';
      cpSync(FIXTURES, target, {
        recursive: true,
        filter: (src) => withLarge || !src.includes(`${'/'}large`),
      });
    },
  };
}
