import { defineConfig } from 'vitest/config';

// Kept apart from vite.config.ts so tests run in plain Node, without the Cloudflare plugin's dev runtime.
// Vitest stubs out stylesheets; one imported ?raw keeps its text, for src/app/ui/foundation/media.test.ts.
export default defineConfig({ test: { css: { include: [/\.css\?raw$/] } } });
