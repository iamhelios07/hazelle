import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  // The server (src/server/node.ts) answers /api; in development Vite proxies it to `npm run server`.
  server: { proxy: { '/api': 'http://localhost:8080' } },
  // Inlined assets become data: URLs, which the CSP refuses (the CSP constant the server sends); every asset ships as a file.
  // An explicit ?inline import (the starter prompt, runtime/prompts) is read in code as a string and never
  // loaded as a URL, so it stays within the CSP.
  build: { assetsInlineLimit: 0, outDir: 'dist/client' },
  // Workers are module workers (runtime/worker moduleWorker), so a worker's dynamic import stays its own chunk: the
  // evaluation worker starts small and loads the tokenizer apart (runtime/tokenizer).
  worker: { format: 'es' },
  assetsInclude: ['**/*.risup'],
});
