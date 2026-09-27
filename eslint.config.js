import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';

const folders = (names, message) => ({ regex: `(^|/)(${names.join('|')})(/|$)`, message });
const restrictImports = (...patterns) => ({ 'no-restricted-imports': ['error', { patterns }] });

const CLIENT_TO_SERVER = folders(['server'], 'Client code reaches the server over HTTP only (tech-spec §3).');
const CSS_IMPORT = { regex: '\\.css$', message: 'Only src/app/ui imports CSS (src/app/ui/README.md).' };
const HEX_COLOR = {
  selector: 'Literal[value=/^#(?:[0-9a-fA-F]{3,4}){1,2}$/]',
  message: 'Colors live in src/app/ui/tokens.css.',
};
const STYLE_PROPS = {
  selector: 'JSXAttribute[name.name=/^(className|style)$/]',
  message: 'Only src/app/ui styles elements (src/app/ui/README.md).',
};

export default defineConfig([
  globalIgnores(['dist/', '.wrangler/', 'worker-configuration.d.ts', '**/*.module.d.css.ts']),
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ['src/engine/**', 'src/connectors/**'],
    rules: restrictImports(
      folders(['app', 'vault', 'server'], 'The engine and connectors stay free of UI, storage and server code (tech-spec §3).'),
    ),
  },
  {
    files: ['src/server/**'],
    rules: restrictImports(
      folders(['app', 'vault', 'engine', 'connectors'], 'The server knows nothing about the client or providers (tech-spec §3).'),
    ),
  },
  {
    files: ['src/app/**', 'src/vault/**'],
    rules: { ...restrictImports(CLIENT_TO_SERVER), 'no-restricted-syntax': ['error', HEX_COLOR] },
  },
  {
    files: ['src/app/**'],
    ignores: ['src/app/ui/**', 'src/app/main.tsx'],
    rules: { ...restrictImports(CLIENT_TO_SERVER, CSS_IMPORT), 'no-restricted-syntax': ['error', HEX_COLOR, STYLE_PROPS] },
  },
]);
