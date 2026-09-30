import { blockHead, conditionSteps, separatorOf, whenArgs } from '../../engine/cbs/evaluate';
import { parse, type Node, type Tag } from '../../engine/cbs/parse';
import { normalize, TOGGLE_GLOBAL } from '../../engine/cbs/tags';

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

function global(tag: Tag, uses: ToggleUse[]) {
  const written = source(tag);
  const sep = written && separatorOf(written.content);
  if (!written || !sep) return;
  const [name, argument] = written.content.split(sep);
  if (normalize(name!) !== 'getglobalvar' || !argument?.startsWith(TOGGLE_GLOBAL)) return;
  uses.push({ key: argument.slice(TOGGLE_GLOBAL.length), at: written.start + name!.length + sep.length + TOGGLE_GLOBAL.length });
}

function when(head: Tag, uses: ToggleUse[]) {
  const written = source(head);
  const block = written && blockHead(written.content);
  const sep = block && separatorOf(block.rest);
  if (!written || block?.name !== 'when' || !sep) return;
  const { modes, condition } = whenArgs(block.rest);
  const start = written.start + written.content.length - block.rest.length + sep.length;
  const at = (index: number) => [...modes, ...condition.slice(0, index)].reduce((place, arg) => place + arg.length + sep.length, start);
  const use = (index: number) => uses.push({ key: condition[index]!, at: at(index) });
  // Only the first step's operand is the key as written; a later one is an operator's result.
  conditionSteps(condition).steps.forEach(({ op, left }, step) => {
    if (op === 'toggle' && step === 0) use(condition.length - 1);
    if (op === 'tis' || op === 'tisnot') use(left!);
  });
}
