import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';
import boundaries from './eslint/boundaries.js';

const CSS_IMPORT = { regex: '\\.css$', message: 'Only src/app/ui imports CSS (src/app/ui/README.md).' };
const HEX_COLOR = {
  selector: 'Literal[value=/^#(?:[0-9a-fA-F]{3,4}){1,2}$/]',
  message: 'Colors live in src/app/ui/foundation/tokens.css.',
};
const STYLE_PROPS = {
  selector: 'JSXAttribute[name.name=/^(className|style)$/]',
  message: 'Only src/app/ui styles elements (src/app/ui/README.md).',
};

export default defineConfig([
  globalIgnores(['dist/', '.wrangler/', '.claude/', 'worker-configuration.d.ts', '**/*.module.d.css.ts']),
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ['src/**'],
    plugins: { local: { rules: { boundaries } } },
    rules: { 'local/boundaries': 'error' },
  },
  {
    files: ['src/app/**'],
    rules: { 'no-restricted-syntax': ['error', HEX_COLOR] },
  },
  {
    files: ['src/app/**'],
    ignores: ['src/app/ui/**', 'src/app/main.tsx'],
    rules: { 'no-restricted-imports': ['error', { patterns: [CSS_IMPORT] }], 'no-restricted-syntax': ['error', HEX_COLOR, STYLE_PROPS] },
  },
]);
