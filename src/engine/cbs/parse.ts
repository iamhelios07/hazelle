// The whole tree is read before anything is evaluated, so a #when evaluates only the branch it takes and a pure
// block still has its source.
export type Node = string | Tag | Block;
// at: where the tag's `{{` stands in the text it was read from; it places the tag's random rolls.
export type Tag = { kind: 'tag'; at: number; parts: Node[] };
// A block is any tag starting with `#`, up to the next `{{/…}}` on its level, whatever name follows
// the slash. raw is the body's source.
export type Block = { kind: 'block'; at: number; head: Tag; body: Node[]; raw: string; close: Tag };

type Frame = { nodes: Node[] } & ({ kind: 'root' } | { kind: 'tag'; at: number } | { kind: 'block'; head: Tag; from: number });

export function parse(text: string): Node[] {
  const root: Frame = { kind: 'root', nodes: [] };
  const stack: Frame[] = [root];
  const top = () => stack.at(-1)!;
  let at = 0;
  let from = 0;

  for (;;) {
    const open = text.indexOf('{{', at);
    const close = text.indexOf('}}', at);
    if (open === -1 && close === -1) break;
    if (open !== -1 && (close === -1 || open < close)) {
      append(top().nodes, text.slice(from, open));
      stack.push({ kind: 'tag', at: open, nodes: [] });
      at = from = open + 2;
      continue;
    }
    at = close + 2;
    const frame = top();
    // A `}}` that closes no tag is text.
    if (frame.kind !== 'tag') continue;
    append(frame.nodes, text.slice(from, close));
    from = at;
    stack.pop();
    const tag: Tag = { kind: 'tag', at: frame.at, parts: frame.nodes };
    const first = tag.parts[0];
    const lead = typeof first === 'string' ? first.trimStart() : '';
    const parent = top();
    if (lead.startsWith('#')) {
      stack.push({ kind: 'block', head: tag, from: at, nodes: [] });
    } else if (lead.startsWith('/') && !lead.startsWith('//') && parent.kind === 'block') {
      stack.pop();
      append(top().nodes, { kind: 'block', at: parent.head.at, head: parent.head, body: parent.nodes, raw: text.slice(parent.from, tag.at), close: tag });
    } else {
      append(parent.nodes, tag);
    }
  }
  append(top().nodes, text.slice(from));

  // Unclosed at the end: a tag's `{{` is text and a block's head a lone tag, and what each held is read
  // in its place, so one stray `{{` leaves the tags after it working.
  while (stack.length > 1) {
    const frame = stack.pop()!;
    const parent = top().nodes;
    if (frame.kind === 'tag') append(parent, '{{');
    if (frame.kind === 'block') append(parent, frame.head);
    for (const node of frame.nodes) append(parent, node);
  }
  return root.nodes;
}

// Adjacent text is kept as one string, so a block's body starts and ends with its own text.
function append(nodes: Node[], node: Node) {
  if (node === '') return;
  const last = nodes.at(-1);
  if (typeof node === 'string' && typeof last === 'string') nodes[nodes.length - 1] = last + node;
  else nodes.push(node);
}

// Removes {{//…}} and {{comment:…}} from text that is searched rather than evaluated (lorebook keys). A comment
// ends at its first `}}`, so a tag nested inside one ends it early.
const COMMENT = /\{\{(?:\/\/|comment:)[\s\S]*?\}\}/gi;
export const stripComments = (text: string) => text.replace(COMMENT, '');
