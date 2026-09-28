import { configDefaults, defineConfig } from 'vitest/config';

// Kept apart from vite.config.ts so tests run in plain Node, without the Cloudflare plugin's dev runtime.
// Vitest stubs out stylesheets; one imported ?raw keeps its text, for src/app/ui/foundation/media.test.ts.
// Agents' git worktrees live under .claude/, and each is a whole copy of the repository.
export default defineConfig({ test: { exclude: [...configDefaults.exclude, '.claude/**'], css: { include: [/\.css\?raw$/] } } });
