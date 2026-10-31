/**
 * pdf.js worker bootstrap.
 *
 * Zero-config by default: the pdf.js worker source is bundled into a lazily
 * loaded chunk and started from a `blob:` URL, which works with every bundler
 * (Vite, webpack, Rspack, Next.js, Parcel) and in dev servers, without copying
 * files. Consumers with a strict CSP (no `worker-src blob:`) can set
 * `config.pdf.workerSrc` to a hosted worker file. If the worker cannot be
 * started at all, pdf.js runs in the main thread as a last resort.
 */

type PdfjsLib = typeof import('pdfjs-dist');

let blobWorker: Promise<Worker | null> | null = null;
let fallbackEnabled = false;

async function createBlobWorker(): Promise<Worker | null> {
  if (typeof Worker === 'undefined' || typeof Blob === 'undefined') return null;
  try {
    const { default: source } = await import('virtual:pdf-worker-source');
    const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
    // The URL stays alive for the lifetime of the page: the worker is shared.
    return new Worker(url, { type: 'module', name: 'docscope-pdf' });
  } catch {
    return null;
  }
}

export async function enableMainThreadFallback(pdfjs: PdfjsLib): Promise<void> {
  if (fallbackEnabled) return;
  const mod = await import('pdfjs-dist/build/pdf.worker.min.mjs');
  (globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = mod;
  pdfjs.GlobalWorkerOptions.workerPort = null;
  fallbackEnabled = true;
}

export async function ensurePdfWorker(pdfjs: PdfjsLib, workerSrc?: string): Promise<void> {
  if (fallbackEnabled) return;
  if (workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;
    return;
  }
  if (pdfjs.GlobalWorkerOptions.workerPort || pdfjs.GlobalWorkerOptions.workerSrc) return;
  blobWorker ??= createBlobWorker();
  const worker = await blobWorker;
  if (worker) pdfjs.GlobalWorkerOptions.workerPort = worker;
  else await enableMainThreadFallback(pdfjs);
}

/** Test helper. */
export function resetPdfWorkerForTests(): void {
  blobWorker = null;
  fallbackEnabled = false;
}
