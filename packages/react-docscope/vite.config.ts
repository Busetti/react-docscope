import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  dependencies: Record<string, string>;
  peerDependencies: Record<string, string>;
};

const externals = [...Object.keys(pkg.dependencies), ...Object.keys(pkg.peerDependencies)];
const isExternal = (id: string) => externals.some((dep) => id === dep || id.startsWith(`${dep}/`));

/**
 * Provides `virtual:pdf-worker-source`: the pdf.js worker code as a string.
 * It ends up in its own lazily-loaded chunk and is started from a blob: URL,
 * so consumers need no bundler configuration for PDF rendering.
 */
function pdfWorkerSource(): Plugin {
  const id = 'virtual:pdf-worker-source';
  return {
    name: 'docscope:pdf-worker-source',
    resolveId(source) {
      return source === id ? `\0${id}` : null;
    },
    load(resolved) {
      if (resolved !== `\0${id}`) return null;
      const file = require.resolve('pdfjs-dist/build/pdf.worker.min.mjs');
      return `export default ${JSON.stringify(readFileSync(file, 'utf8'))};`;
    },
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), pdfWorkerSource()],
  build: {
    target: 'es2020',
    outDir: 'dist',
    emptyOutDir: mode !== 'development',
    sourcemap: true,
    minify: false,
    cssCodeSplit: false,
    lib: {
      entry: { index: 'src/index.ts', locales: 'src/locales/index.ts' },
      formats: ['es'],
      fileName: (_format, name) => `${name}.js`,
      cssFileName: 'styles',
    },
    rollupOptions: {
      external: isExternal,
      output: {
        chunkFileNames: 'chunks/[name]-[hash].js',
      },
    },
  },
}));
