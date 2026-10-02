import path from 'node:path';

// The layering of src. A module belongs to the area with the longest path that holds it: a path is a folder or a module
// without its extension, relative to the repo root (the folder above this one), and a test file belongs where the module
// it tests does. An area imports itself, the areas in `imports`, with `import type` those in `types`, and from its test
// files those in `tests`. A module in no area fails lint until this table places it.
const RUNTIME_IMPORTS = ['model', 'engine', 'connectors', 'vault'];
const BELOW_APP = ['runtime', ...RUNTIME_IMPORTS];
const FEATURES = ['account', 'library', 'chat', 'connections', 'models', 'prompts', 'personas', 'modules', 'settings'];
const FEATURE = {
  imports: ['ui', 'routes', 'common', 'root', ...BELOW_APP],
  why: 'a feature folder imports no other feature folder and nothing from the shell but routes and router (only the shell and main.tsx compose features), and reaches the server over HTTP only.',
};
const AREAS = {
  connectors: { paths: ['src/connectors'], why: 'connectors are the provider contract the engine and the model build on, so they import no other layer, and touch no DOM, network or storage so their golden tests run in node.' },
  engine: {
    paths: ['src/engine'],
    imports: ['connectors'],
    types: ['model'],
    why: 'the engine stays free of UI, network, storage and server code so its golden tests run in node, and takes only types from the model.',
  },
  model: {
    paths: ['src/model'],
    types: ['connectors', 'engine', 'vault'],
    why: 'the model is pure domain, saved values and what is computed from them with no I/O, and takes only types from connectors, the engine and the vault (a stored file\'s reference).',
  },
  vault: { paths: ['src/vault'], why: 'the vault is crypto and device storage only; it never reaches the network.' },
  server: { paths: ['src/server'], why: 'the server knows nothing about the client or providers.' },
  runtime: {
    paths: ['src/runtime'],
    imports: RUNTIME_IMPORTS,
    tests: ['harness'],
    why: 'the runtime is below the UI and reaches the server over HTTP only; only its tests run the server, through the harness.',
  },
  harness: { paths: ['src/runtime/testing'], imports: ['runtime', 'server', ...RUNTIME_IMPORTS], why: 'the runtime tests\' harness is below the UI.' },
  ui: { paths: ['src/app/ui'], why: 'the kit imports nothing outside src/app/ui, so a component never reaches the session, router, toasts, a screen or the layers below.' },
  routes: { paths: ['src/app/shell/routes', 'src/app/shell/router'], imports: BELOW_APP, why: 'the route table and router are what features take from the shell, so they compose nothing.' },
  shell: {
    paths: ['src/app/shell'],
    imports: ['ui', 'routes', 'common', 'root', ...FEATURES, ...BELOW_APP],
    why: 'the shell composes the features and reaches the server over HTTP only.',
  },
  ...Object.fromEntries(FEATURES.map((name) => [name, { paths: [`src/app/${name}`], ...FEATURE }])),
  common: { paths: ['src/app/common'], ...FEATURE },
  root: {
    paths: ['src/app/session', 'src/app/toast', 'src/app/shortcuts'],
    imports: ['ui', 'common', ...BELOW_APP],
    why: 'session, toast and shortcuts are read by every feature, so they compose no feature and take nothing from the shell.',
  },
  main: { paths: ['src/app/main'], imports: ['ui', 'shell', 'routes', 'common', 'root', ...FEATURES, ...BELOW_APP], why: 'main.tsx reaches the server over HTTP only.' },
};

const REPO = path.dirname(import.meta.dirname);
const BY_LENGTH = Object.entries(AREAS)
  .flatMap(([name, { paths }]) => paths.map((at) => ({ at, name })))
  .sort((a, b) => b.at.length - a.at.length);
const modulePath = (file) => path.relative(REPO, file).replace(/(\.test)?\.[jt]sx?$/, '');
const areaOf = (module) => BY_LENGTH.find(({ at }) => module === at || module.startsWith(`${at}/`))?.name;

export default {
  meta: {
    messages: {
      forbidden: '{{from}} may not import {{to}}: {{why}} (eslint/boundaries.js)',
      typesOnly: '{{from}} takes only types from {{to}}, with `import type`: {{why}} (eslint/boundaries.js)',
      unmapped: '{{module}} is in no area of the import table in eslint/boundaries.js.',
    },
  },
  create(context) {
    const from = areaOf(modulePath(context.filename));
    if (!from) return { Program: (node) => context.report({ node, messageId: 'unmapped', data: { module: modulePath(context.filename) } }) };
    const { imports = [], types = [], tests = [], why } = AREAS[from];
    const isTest = /\.test\.[jt]sx?$/.test(context.filename);
    // Only `import type` and `export type` are types: under verbatimModuleSyntax, `import { type X }` still loads the module.
    const check = ({ source }, typeOnly) => {
      if (typeof source?.value !== 'string' || !/^\.\.?(\/|$)/.test(source.value)) return;
      const target = modulePath(path.resolve(path.dirname(context.filename), source.value.replace(/\?.*$/, '')));
      const to = areaOf(target);
      if (!to) return context.report({ node: source, messageId: 'unmapped', data: { module: target } });
      if (to === from || imports.includes(to) || (typeOnly && types.includes(to)) || (isTest && tests.includes(to))) return;
      context.report({ node: source, messageId: types.includes(to) ? 'typesOnly' : 'forbidden', data: { from, to, why } });
    };
    return {
      ImportDeclaration: (node) => check(node, node.importKind === 'type'),
      ExportNamedDeclaration: (node) => check(node, node.exportKind === 'type'),
      ExportAllDeclaration: (node) => check(node, node.exportKind === 'type'),
      ImportExpression: (node) => check(node, false),
      TSImportType: (node) => check(node, true),
    };
  },
};
