import { globSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

// Every piece of Korean the source shows, for a model to rewrite: `extract <out.json>` lists them, the model edits only
// `text`, and `apply <out.json> <revised.json>` writes the changed ones back where they were found.

export type Entry = {
  id: string;
  kind: 'string' | 'template' | 'jsx' | 'html';
  owner: string;
  context: string;
  text: string;
  span: [number, number];
  // A template's literal runs, between its ${…}: only these are rewritten, so a string nested in an expression stays
  // an entry of its own and the two never overlap.
  parts?: [number, number][];
};
export type Source = { path: string; source: string };

const KOREAN = /[ㄱ-ㆎ가-힣]/;
const SOURCES = ['src/**/*.ts', 'src/**/*.tsx'];
const PAGES = ['index.html', 'sandbox.html', 'public/site.webmanifest'];
// A prompt the model reads, and code shipped as a string, are not copy: INLAY_EXPORT's two alerts are edited by hand.
const NOT_COPY = new Set(['INSTRUCTIONS', 'INLAY_EXPORT']);
const HTML_TEXT = /(?<=>)[^<>]+(?=<)|(?<=")[^"\n<>]+(?=")/g;

function lineOf(source: string, at: number) {
  const start = source.lastIndexOf('\n', at - 1) + 1;
  const end = source.indexOf('\n', at);
  return { line: source.slice(0, at).split('\n').length, text: source.slice(start, end < 0 ? undefined : end).trim().slice(0, 240) };
}

function ownerOf(node: ts.Node): string {
  const names: string[] = [];
  for (let at = node.parent; at; at = at.parent) {
    if ((ts.isVariableDeclaration(at) || ts.isFunctionDeclaration(at) || ts.isPropertyAssignment(at) || ts.isMethodDeclaration(at) || ts.isJsxAttribute(at)) && at.name) {
      names.unshift(at.name.getText());
    }
  }
  return names.join(' › ');
}

// Types and keys are matched against, not shown.
function isMatched(node: ts.Node): boolean {
  const parent = node.parent;
  return ts.isLiteralTypeNode(parent) || ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent) || ((ts.isPropertyAssignment(parent) || ts.isPropertySignature(parent)) && parent.name === node);
}

function codeEntries({ path, source }: Source): Entry[] {
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const entries: Entry[] = [];
  const add = (node: ts.Node, kind: Entry['kind'], span: [number, number], parts?: [number, number][]) => {
    const owner = ownerOf(node);
    if (NOT_COPY.has(owner.split(' › ')[0]!)) return;
    const { line, text } = lineOf(source, span[0]);
    entries.push({ id: `${path}:${line}:${span[0]}`, kind, owner, context: text, text: source.slice(...span), span, ...(parts && { parts }) });
  };
  const visit = (node: ts.Node) => {
    if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && KOREAN.test(node.text) && !isMatched(node)) {
      add(node, ts.isStringLiteral(node) ? 'string' : 'template', [node.getStart() + 1, node.end - 1], ts.isStringLiteral(node) ? undefined : [[node.getStart() + 1, node.end - 1]]);
    } else if (ts.isTemplateExpression(node)) {
      const literals = [node.head, ...node.templateSpans.map((span) => span.literal)];
      if (literals.some((literal) => KOREAN.test(literal.text))) {
        add(node, 'template', [node.getStart() + 1, node.end - 1], literals.map((literal) => [literal.getStart() + 1, literal.end - (ts.isTemplateTail(literal) ? 1 : 2)]));
      }
    } else if (ts.isJsxText(node) && KOREAN.test(node.text)) {
      const raw = node.getText();
      const start = node.getStart() + raw.length - raw.trimStart().length;
      add(node, 'jsx', [start, start + raw.trim().length]);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return entries;
}

function pageEntries({ path, source }: Source): Entry[] {
  return [...source.matchAll(HTML_TEXT)]
    .filter((match) => KOREAN.test(match[0]))
    .map((match) => {
      const { line, text } = lineOf(source, match.index);
      return { id: `${path}:${line}:${match.index}`, kind: 'html', owner: '', context: text, text: match[0], span: [match.index, match.index + match[0].length] };
    });
}

export function extract(sources: readonly Source[]): Entry[] {
  return sources.flatMap((source) => (/\.tsx?$/.test(source.path) ? codeEntries(source) : pageEntries(source)));
}

function parseTemplate(inner: string) {
  const file = ts.createSourceFile('x.ts', `(\`${inner}\`)`, ts.ScriptTarget.Latest, true);
  const statement = file.statements[0];
  const expression = statement && ts.isExpressionStatement(statement) && ts.isParenthesizedExpression(statement.expression) ? statement.expression.expression : null;
  if (expression && ts.isNoSubstitutionTemplateLiteral(expression) && expression.getText() === `\`${inner}\``) return { literals: [inner], expressions: [] };
  if (!expression || !ts.isTemplateExpression(expression) || expression.getText() !== `\`${inner}\``) return null;
  const literals = [expression.head, ...expression.templateSpans.map((span) => span.literal)];
  return { literals: literals.map((literal) => literal.getText().slice(1, ts.isTemplateTail(literal) ? -1 : -2)), expressions: expression.templateSpans.map((span) => span.expression.getText()) };
}

function isOneString(inner: string, quote: string) {
  const file = ts.createSourceFile('x.ts', `(${quote}${inner}${quote})`, ts.ScriptTarget.Latest, true);
  const statement = file.statements[0];
  const expression = statement && ts.isExpressionStatement(statement) && ts.isParenthesizedExpression(statement.expression) ? statement.expression.expression : null;
  return !!expression && ts.isStringLiteral(expression) && expression.getText() === `${quote}${inner}${quote}`;
}

type Edit = { start: number; end: number; text: string };

// Why an entry's new text cannot go back in its place, or its edits.
function editsFor(entry: Entry, text: string, source: string): Edit[] | string {
  if (source.slice(...entry.span) !== entry.text) return 'the source changed since extract';
  if (entry.kind === 'template') {
    const before = parseTemplate(entry.text);
    const after = parseTemplate(text);
    if (!after || !before || after.expressions.join('\0') !== before.expressions.join('\0')) return 'the ${…} expressions changed';
    return entry.parts!.map(([start, end], index) => ({ start, end, text: after.literals[index]! }));
  }
  if (entry.kind === 'string' && !isOneString(text, source[entry.span[0] - 1]!)) return 'not one string literal in its quotes';
  if (entry.kind === 'jsx' && /[{}<>]/.test(text)) return 'JSX text cannot hold { } < >';
  if (entry.kind === 'html' && /[<>"\n]/.test(text)) return 'page text cannot hold < > " or a line break';
  return [{ start: entry.span[0], end: entry.span[1], text }];
}

export function apply(sources: readonly Source[], original: readonly Entry[], revised: readonly Pick<Entry, 'id' | 'text'>[]) {
  const byId = new Map(original.map((entry) => [entry.id, entry]));
  const rejected: { id: string; reason: string }[] = [];
  const edits = new Map<string, Edit[]>();
  for (const { id, text } of revised) {
    const entry = byId.get(id);
    if (!entry) {
      rejected.push({ id, reason: 'no such entry' });
      continue;
    }
    if (entry.text === text) continue;
    const path = id.slice(0, id.indexOf(':'));
    const source = sources.find((each) => each.path === path)!.source;
    const result = editsFor(entry, text, source);
    if (typeof result === 'string') rejected.push({ id, reason: result });
    else edits.set(path, [...(edits.get(path) ?? []), ...result]);
  }
  const written = [...edits].map(([path, list]) => {
    let source = sources.find((each) => each.path === path)!.source;
    for (const edit of list.sort((a, b) => b.start - a.start)) source = source.slice(0, edit.start) + edit.text + source.slice(edit.end);
    return { path, source };
  });
  return { written, rejected };
}

function read(paths: readonly string[]): Source[] {
  return paths.map((path) => ({ path, source: readFileSync(path, 'utf8') }));
}

function main([command, out, revisedPath]: string[]) {
  const paths = [...globSync(SOURCES, { exclude: (path) => /\.test\.tsx?$|testing\.ts$/.test(path) }), ...PAGES].sort();
  if (command === 'extract' && out) {
    const entries = extract(read(paths));
    writeFileSync(out, JSON.stringify(entries, null, 1) + '\n');
    console.log(`${entries.length} entries from ${new Set(entries.map((entry) => entry.id.slice(0, entry.id.indexOf(':')))).size} files → ${out}`);
  } else if (command === 'apply' && out && revisedPath) {
    const original = JSON.parse(readFileSync(out, 'utf8')) as Entry[];
    const revised = JSON.parse(readFileSync(revisedPath, 'utf8')) as Pick<Entry, 'id' | 'text'>[];
    const { written, rejected } = apply(read([...new Set(original.map((entry) => entry.id.slice(0, entry.id.indexOf(':'))))]), original, revised);
    for (const { path, source } of written) writeFileSync(path, source);
    for (const { id, reason } of rejected) console.log(`rejected ${id}: ${reason}`);
    console.log(`${written.length} files written, ${rejected.length} entries rejected`);
  } else {
    console.log('usage: copy-text extract <out.json> | copy-text apply <out.json> <revised.json>');
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2));
