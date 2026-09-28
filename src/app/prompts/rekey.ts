import { parse, type Node, type Tag } from '../../engine/cbs/parse';
import { normalize } from '../../engine/cbs/tags';

// The #when operators, kept in step with UNARY and BINARY in engine/cbs/evaluate.
const UNARY = new Set(['not', 'var', 'toggle']);
const BINARY = new Set(['and', 'or', 'is', 'isnot', '>', '<', '>=', '<=', 'vis', 'visnot', 'tis', 'tisnot']);
const MODES = new Set(['keep', 'legacy']);

// A toggle key written in the text, and where it stands.
export type ToggleUse = { key: string; at: number };

// Every place CBS reads a toggle by a written key, found the way the evaluator reads them: the literal `toggle` applies
// to and the left side of `tis`/`tisnot` in a #when, and `toggle_KEY` in getglobalvar. A key built by a nested tag is
// computed, not written, so it is not one.
export function toggleUses(text: string): ToggleUse[] {
  const uses: ToggleUse[] = [];
  const visit = (nodes: Node[]) => {
    for (const node of nodes) {
      if (typeof node === 'string') continue;
      if (node.kind === 'tag') {
        global(node, uses);
        visit(node.parts);
      } else {
        when(node.head, uses);
        visit(node.head.parts);
        visit(node.body);
        visit(node.close.parts);
      }
    }
  };
  visit(parse(text));
  return uses;
}

// design §4.2: changing a toggle's key rewrites its conditions.
export function renameToggle(text: string, from: string, to: string): string {
  return toggleUses(text)
    .filter((use) => use.key === from)
    .sort((a, b) => b.at - a.at)
    .reduce((result, use) => result.slice(0, use.at) + to + result.slice(use.at + from.length), text);
}

// A tag's written source, when no tag is nested in it, and where that source starts.
function source(tag: Tag): { content: string; start: number } | null {
  const [content, ...rest] = tag.parts;
  return typeof content === 'string' && rest.length === 0 ? { content, start: tag.at + 2 } : null;
}

// engine/cbs/evaluate splitArgs: `::` when the first colon is doubled, else `:`.
function separator(content: string): string | null {
  const colon = content.indexOf(':');
  return colon === -1 ? null : content[colon + 1] === ':' ? '::' : ':';
}

function global(tag: Tag, uses: ToggleUse[]) {
  const written = source(tag);
  const sep = written && separator(written.content);
  if (!written || !sep) return;
  const [name, argument] = written.content.split(sep);
  if (normalize(name!) !== 'getglobalvar' || !argument?.startsWith('toggle_')) return;
  uses.push({ key: argument.slice('toggle_'.length), at: written.start + name!.length + sep.length + 'toggle_'.length });
}

function when(head: Tag, uses: ToggleUse[]) {
  const written = source(head);
  const match = written && /^\s*#([^\s:]*)([\s\S]*)$/.exec(written.content);
  if (!written || !match || normalize(match[1]!) !== 'when') return;
  const rest = match[2]!;
  if (!rest.startsWith(':')) return;
  const sep = rest[1] === ':' ? '::' : ':';
  const args = rest.split(sep).slice(1);
  const places: number[] = [];
  let at = written.start + written.content.length - rest.length + sep.length;
  for (const arg of args) {
    places.push(at);
    at += arg.length + sep.length;
  }
  const use = (index: number) => uses.push({ key: args[index]!, at: places[index]! });
  let first = 0;
  while (MODES.has(args[first]!)) first += 1;
  // As evaluate's fold reads it, right to left: the value is a written literal until an operator has applied.
  let literal = true;
  for (let i = args.length - 2; i >= first; i--) {
    const op = args[i]!;
    if (UNARY.has(op)) {
      if (op === 'toggle' && literal) use(args.length - 1);
    } else if (BINARY.has(op) && i > first) {
      i -= 1;
      if (op === 'tis' || op === 'tisnot') use(i);
    } else return;
    literal = false;
  }
}
