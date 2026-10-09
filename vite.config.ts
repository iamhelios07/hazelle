import { sandbox } from './scripts/sandbox';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), sandbox()],
  // The server (src/server/node.ts) answers /api; in development Vite proxies it to `npm run server`.
  server: { proxy: { '/api': 'http://localhost:8080' } },
  // Inlined assets become data: URLs, which the CSP refuses (the CSP constant the server sends); every asset ships as a file.
  // An explicit ?inline import (the starter prompt, runtime/prompts) is read in code as a string and never
  // loaded as a URL, so it stays within the CSP.
  // sandbox.html is the tool document (server/static SANDBOX_CSP). Vite builds only its stylesheet; its classic host
  // script is emitted by scripts/sandbox, since a module script would be a CORS fetch from the opaque frame.
  build: { assetsInlineLimit: 0, outDir: 'dist/client', rollupOptions: { input: { main: 'index.html', sandbox: 'sandbox.html' } } },
  // Workers are module workers (runtime/worker moduleWorker), so a worker's dynamic import stays its own chunk: the
  // evaluation worker starts small and loads the tokenizer apart (runtime/tokenizer).
  worker: { format: 'es' },
  assetsInclude: ['**/*.risup'],
});
