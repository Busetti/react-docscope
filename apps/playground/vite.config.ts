import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fixturesServer } from './fixtures-server.ts';

export default defineConfig({
  plugins: [react(), fixturesServer()],
  server: { port: 5173 },
  preview: { port: 4173 },
  build: { sourcemap: true, chunkSizeWarningLimit: 1500 },
});
