import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fixturesServer } from './fixtures-server.ts';

export default defineConfig({
  // GitHub Pages serves the demo from /<repo>/; local builds use /.
  base: process.env.PLAYGROUND_BASE ?? '/',
  plugins: [react(), fixturesServer()],
  server: { port: 5173 },
  preview: { port: 4173 },
  build: { sourcemap: true, chunkSizeWarningLimit: 1500 },
});
