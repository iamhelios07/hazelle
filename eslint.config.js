import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';

const restrict = (folders, message) => ({
  'no-restricted-imports': ['error', { patterns: [{ regex: `(^|/)(${folders.join('|')})(/|$)`, message }] }],
});

export default defineConfig([
  globalIgnores(['dist/']),
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ['src/engine/**', 'src/connectors/**'],
    rules: restrict(['app', 'vault', 'server'], 'The engine and connectors stay free of UI, storage and server code (tech-spec §3).'),
  },
  {
    files: ['src/server/**'],
    rules: restrict(['app', 'vault', 'engine', 'connectors'], 'The server knows nothing about the client or providers (tech-spec §3).'),
  },
  {
    files: ['src/app/**', 'src/vault/**'],
    rules: restrict(['server'], 'Client code reaches the server over HTTP only (tech-spec §3).'),
  },
]);
