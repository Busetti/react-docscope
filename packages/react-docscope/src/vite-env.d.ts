declare module 'virtual:pdf-worker-source' {
  /** Source code of the bundled pdf.js worker (ES module). */
  const source: string;
  export default source;
}

declare module 'pdfjs-dist/build/pdf.worker.min.mjs' {
  export const WorkerMessageHandler: unknown;
}
