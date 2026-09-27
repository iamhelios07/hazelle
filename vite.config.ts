import { cloudflare } from '@cloudflare/vite-plugin';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), cloudflare()],
  // Inlined assets become data: URLs, which the CSP refuses (public/_headers); every asset ships as a file.
  build: { assetsInlineLimit: 0 },
});
