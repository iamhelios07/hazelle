import { configDefaults, defineConfig } from 'vitest/config';

// Kept apart from vite.config.ts so tests run in plain Node, without the Cloudflare plugin's dev runtime.
// Vitest stubs out stylesheets; one imported ?raw keeps its text, for src/app/ui/foundation/media.test.ts.
// Agents' git worktrees live under .claude/, and each is a whole copy of the repository. e2e/ and shots/ are Playwright's.
// maxWorkers: this machine has crashed from an unbounded run; four workers keep the suite under its memory.
export default defineConfig({ assetsInclude: ['**/*.risup'], test: { maxWorkers: 4, setupFiles: ['src/runtime/object-codec-setup.test.ts'], exclude: [...configDefaults.exclude, '.claude/**', 'e2e/**', 'shots/**', '**/*-setup.test.ts'], css: { include: [/\.css\?raw$/] } } });
