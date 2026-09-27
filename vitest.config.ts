import { defineConfig } from 'vitest/config';

// Kept apart from vite.config.ts so tests run in plain Node, without the Cloudflare plugin's dev runtime.
export default defineConfig({});
