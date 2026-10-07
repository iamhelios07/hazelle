import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import ts from 'typescript';
import { expect, it } from 'vitest';

it('keeps runtime value imports acyclic, including re-exports and dynamic imports', () => {
  const files = new Set(readdirSync('src', { recursive: true, encoding: 'utf8' }).filter((file) => /\.tsx?$/.test(file) && !/\.test\.|\.d\.|(?:^|\/)testing(?:\.|\/)/.test(file)).map((file) => join('src', file)));
  const graph = new Map<string, string[]>();
  for (const file of files) {
    const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    const edges: string[] = [];
    const add = (specifier: ts.Node | undefined) => {
      if (!specifier || !ts.isStringLiteralLike(specifier) || !specifier.text.startsWith('.') || specifier.text.includes('?')) return;
      const target = normalize(join(dirname(file), specifier.text));
      const resolved = [target, `${target}.ts`, `${target}.tsx`, `${target}/index.ts`].find((path) => files.has(path));
      if (resolved) edges.push(resolved);
    };
    const visit = (node: ts.Node) => {
      if (ts.isImportDeclaration(node) && !node.importClause?.isTypeOnly) add(node.moduleSpecifier);
      if (ts.isExportDeclaration(node) && !node.isTypeOnly) add(node.moduleSpecifier);
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) add(node.arguments[0]);
      ts.forEachChild(node, visit);
    };
    visit(source);
    graph.set(file, edges);
  }

  const visited = new Set<string>();
  const active: string[] = [];
  const cycles: string[][] = [];
  const walk = (file: string) => {
    const at = active.indexOf(file);
    if (at !== -1) { cycles.push([...active.slice(at), file]); return; }
    if (visited.has(file)) return;
    visited.add(file);
    active.push(file);
    for (const next of graph.get(file) ?? []) walk(next);
    active.pop();
  };
  for (const file of files) if (file.startsWith('src/runtime/')) walk(file);
  expect(cycles).toEqual([]);
});
