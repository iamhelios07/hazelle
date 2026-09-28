import { cloudflare } from '@cloudflare/vite-plugin';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), cloudflare()],
  // Inlined assets become data: URLs, which the CSP refuses (public/_headers); every asset ships as a file.
  // An explicit ?inline import (the starter prompt, runtime/prompts) is read in code as a string and never
  // loaded as a URL, so it stays within the CSP.
  build: { assetsInlineLimit: 0 },
  assetsInclude: ['**/*.risup'],
});
