/* global self */
/**
 * Static-hosting stand-in for the playground's dev-server backend
 * (fixtures-server.ts), used by the GitHub Pages demo:
 *   signed/<file>?expires=<ms>&sig=  mock signed URL, 403 once expired
 *   secure/<file>                    requires "Authorization: Bearer demo-token"
 *   status/<code>                    responds with that status
 *   slow/<file>?ms=1500              delayed response
 * Fixtures themselves are plain static files under fixtures/.
 */
const scope = self.registration.scope;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (!url.href.startsWith(scope)) return;
  const [kind, ...rest] = url.pathname.slice(new URL(scope).pathname.length).split('/');
  if (!['signed', 'secure', 'status', 'slow'].includes(kind)) return;
  event.respondWith(handle(kind, rest.join('/'), url, event.request));
});

function fixture(file, request) {
  if (!/^[\w.-]+(\/[\w.-]+)*$/.test(file) || file.includes('..'))
    return Promise.resolve(new Response('Not found', { status: 404 }));
  const range = request.headers.get('range');
  return fetch(scope + 'fixtures/' + file, range ? { headers: { Range: range } } : {});
}

async function handle(kind, file, url, request) {
  if (kind === 'signed') {
    const expires = Number(url.searchParams.get('expires'));
    if (!url.searchParams.get('sig') || !Number.isFinite(expires) || Date.now() > expires) {
      return new Response(
        '<Error><Code>AccessDenied</Code><Message>Request has expired</Message></Error>',
        { status: 403, headers: { 'Content-Type': 'application/xml' } },
      );
    }
    return fixture(file, request);
  }
  if (kind === 'secure') {
    if (request.headers.get('authorization') !== 'Bearer demo-token')
      return new Response('Unauthorized', { status: 401 });
    return fixture(file, request);
  }
  if (kind === 'status') {
    const code = Number(file);
    const status = code >= 200 && code <= 599 ? code : 500;
    return new Response(`Status ${status}`, { status });
  }
  const ms = Math.min(10000, Number(url.searchParams.get('ms')) || 1500);
  await new Promise((r) => setTimeout(r, ms));
  return fixture(file, request);
}
