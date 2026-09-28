import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';

const folders = (names, message) => ({ regex: `(^|/)(${names.join('|')})(/|$)`, message });
const restrictImports = (...patterns) => ({ 'no-restricted-imports': ['error', { patterns }] });
// The typed rule, for patterns that let `import type` through (allowTypeImports).
const restrictValueImports = (...patterns) => ({ '@typescript-eslint/no-restricted-imports': ['error', { patterns }] });

const CLIENT_TO_SERVER = folders(['server'], 'Client code reaches the server over HTTP only (tech-spec §3).');
const CSS_IMPORT = { regex: '\\.css$', message: 'Only src/app/ui imports CSS (src/app/ui/README.md).' };
// Relative paths only know depth: src/app is one level up from src/app/ui and two from a file in one of its
// folders. A deeper file would slip past this, so KIT_DEPTH fails any file there outright.
const appOutsideUi = (levels) => ({
  regex: `^(\\.\\./){${levels}}(?!\\.\\.)`,
  message: 'src/app/ui imports nothing else from src/app, so a component never reaches the session, router, toasts or a screen (tech-spec §3).',
});
const KIT_DEPTH = {
  selector: 'Program',
  message: 'The kit is one folder deep (src/app/ui/<group>/); the ../-counting boundary rule cannot see deeper files.',
};
// A pattern sees the import as written, so it counts the steps up to src/app: from a file depth folders
// below it, another feature's file is ../ × depth, then <feature>/…; ../../model/library from a feature's
// top folder is not the library feature.
const FEATURES = ['account', 'library', 'chat', 'connections'];
const toApp = (depth) => '\\.\\./'.repeat(depth);
const OTHER_FEATURE = (depth) => ({
  regex: `^${toApp(depth)}(${FEATURES.join('|')})(/|$)`,
  message: 'A feature folder imports no other feature folder; only the shell and main.tsx compose them (tech-spec §3).',
});
const SHELL_INSIDE = (depth) => ({
  regex: `^${toApp(depth)}shell(/(?!(routes|router)$)|$)`,
  message: 'Feature folders take only routes and router from the shell (tech-spec §3).',
});
const HEX_COLOR = {
  selector: 'Literal[value=/^#(?:[0-9a-fA-F]{3,4}){1,2}$/]',
  message: 'Colors live in src/app/ui/foundation/tokens.css.',
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
    files: ['src/model/**'],
    rules: restrictValueImports(
      folders(['app', 'runtime', 'vault', 'server'], 'The model is pure domain: saved values and what is computed from them, with no I/O (tech-spec §3).'),
      { ...folders(['connectors', 'engine'], 'The model takes only types from connectors and the engine (tech-spec §3).'), allowTypeImports: true },
    ),
  },
  {
    files: ['src/engine/**'],
    rules: {
      ...restrictImports(folders(['app', 'runtime', 'vault', 'server'], 'The engine and connectors stay free of UI, network, storage and server code (tech-spec §3).')),
      ...restrictValueImports({ ...folders(['model'], 'The engine takes only types from the model (tech-spec §3).'), allowTypeImports: true }),
    },
  },
  {
    files: ['src/connectors/**'],
    rules: restrictImports(
      folders(['app', 'runtime', 'vault', 'server'], 'The engine and connectors stay free of UI, network, storage and server code (tech-spec §3).'),
      folders(['model'], 'Connectors are the provider contract the model builds on, so they import nothing from it (tech-spec §3).'),
    ),
  },
  {
    files: ['src/server/**'],
    rules: restrictImports(
      folders(['app', 'model', 'runtime', 'vault', 'engine', 'connectors'], 'The server knows nothing about the client or providers (tech-spec §3).'),
    ),
  },
  {
    files: ['src/vault/**'],
    rules: restrictImports(
      folders(['app', 'model', 'runtime', 'server'], 'The vault is crypto and device storage only; it never reaches the network (tech-spec §3).'),
    ),
  },
  {
    files: ['src/runtime/**'],
    ignores: ['src/runtime/testing.ts'],
    rules: restrictImports(folders(['app', 'server'], 'The runtime is below the UI and reaches the server over HTTP only (tech-spec §3).')),
  },
  {
    files: ['src/runtime/testing.ts'],
    rules: restrictImports(folders(['app'], 'The runtime is below the UI; only its test harness runs the real server in process (tech-spec §3).')),
  },
  {
    files: ['src/app/**'],
    rules: { ...restrictImports(CLIENT_TO_SERVER), 'no-restricted-syntax': ['error', HEX_COLOR] },
  },
  {
    files: ['src/app/ui/*'],
    rules: restrictImports(CLIENT_TO_SERVER, appOutsideUi(1)),
  },
  {
    files: ['src/app/ui/*/**'],
    rules: restrictImports(CLIENT_TO_SERVER, appOutsideUi(2)),
  },
  {
    files: ['src/app/ui/*/*/**'],
    rules: { 'no-restricted-syntax': ['error', KIT_DEPTH] },
  },
  {
    files: ['src/app/**'],
    ignores: ['src/app/ui/**', 'src/app/main.tsx'],
    rules: { ...restrictImports(CLIENT_TO_SERVER, CSS_IMPORT), 'no-restricted-syntax': ['error', HEX_COLOR, STYLE_PROPS] },
  },
  // Depth 2 is a feature's own folder, such as library/gallery. A folder nested deeper needs its depth here.
  ...[1, 2].map((depth) => ({
    files: [`src/app/{${FEATURES.join(',')},common}/${'*/'.repeat(depth - 1)}*`],
    rules: restrictImports(CLIENT_TO_SERVER, CSS_IMPORT, OTHER_FEATURE(depth), SHELL_INSIDE(depth)),
  })),
]);
