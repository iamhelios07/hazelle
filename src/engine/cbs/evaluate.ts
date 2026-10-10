import type { BotAsset } from '../assets';
import type { HistoryMessage } from '../history';
import type { Card, LoreEntry } from '../import/types';
import { seeded } from '../random';
import type { Stage } from '../render';
import { escapeCbs } from './escape';
import type { PreviousMessages } from './history';
import { parse, type Block, type Node, type Tag } from './parse';
import { bool, handlerFor, items, normalize, readToggle, readVar, Return, truthy, type Env, type Erase } from './tags';

export type CbsContext = {
  stage: Stage;
  card: Card | null;
  // With none, the account's username and no description.
  persona: { name: string; description: string } | null;
  // The prompt's own main text and global note, not a card's replacements, and the author's note in effect.
  // persona and prompt are null when the chat's is gone, which only the display renders through.
  prompt: { main: string; globalNote: string; authorNote: string } | null;
  lore: readonly Omit<LoreEntry, 'folder'>[];
  messages: HistoryMessage[];
  previous: PreviousMessages;
  // A chat message, by its index in messages: its seed rolls its random tags, and its setvar, addvar
  // and setdefaultvar write the variables. Or text outside messages: its random tags roll from a seed fresh
  // for each request, and its variable writes are removed without effect.
  source: { message: number } | { seed: string };
  // The greeting the chat opened with, which is then messages[0], and its index in card.greetings: null when
  // the version shown is not one of the card's (the card changed, or the model rewrote it). null when the chat
  // opened with none.
  greeting: { index: number | null } | null;
  // The chat's variables as of this text, written in place, replayed over the card's defaults in message order.
  variables: Map<string, string>;
  // null when nothing declares the toggle.
  toggle: (key: string) => string | null;
  // prefill: whether the model takes an assistant prefill, as its connection says; never read from the id.
  // null when unknown, and model null when the chat has no model.
  model: { id: string; maxContext: number | null; prefill: boolean | null } | null;
  // The 보조 모델's id, as {{axmodel}} reads it; null when the chat resolves none.
  axModel: string | null;
  // The risu-id of the bot's element whose press runs the trigger this text is evaluated in; '' outside such a run, and
  // when the element has none. Risu reads `null`.
  triggerId: string;
  // The window's size, as Risu reads window.innerWidth: null in the prompt, and when the display does not know it.
  screen: { width: number; height: number } | null;
  // now in ms since the epoch; timeZone an IANA name, since the engine reads no zone of the device it runs on.
  clock: { now: number; timeZone: string };
  // The language a translation prompt translates into, as the English name the model reads; null outside one.
  language: string | null;
  // The pictures of the chat's packs, and the faces {{source}} shows: the character's and the persona's pictures as data:
  // URLs, each null when there is none.
  assets: readonly BotAsset[];
  // The namespaces of the modules on in the chat (design §6.5).
  modules: readonly string[];
  faces: { char: string | null; user: string | null };
  // pick and rollp keep Risu's seed: the character, the chat and its message count.
  pickSeed: string;
};

// Nested parses (inserted texts and calls) past this give Risu's error text, which {{iserror}} recognizes.
const DEPTH = 20;
const TOO_DEEP = 'ERROR: Call stack limit reached';

// What one evaluation may do: the tags and blocks it evaluates and the text it produces, counted at every level of
// nesting. A bot's commands that insert or double their own output grow it without end, on the thread that runs them.
const MOST_TAGS = 200_000;
const MOST_CHARS = 10_000_000;

// The evaluation went past what it may do and gave no text: not a part of one, which would read as whole.
export class Runaway extends Error {
  constructor() {
    super('CBS made too much text and was stopped');
  }
}

// Temp variables and functions live as long as it, and spent counts against its limits.
type Run = { context: CbsContext; seed: string; temp: Map<string, string>; functions: Map<string, Node[]>; spent: { tags: number; chars: number } };
// prefix sets the tags of an inserted text, a call or an #each item apart from those of the text around it,
// so each rolls its own.
type Frame = { run: Run; prefix: string; writes: boolean; depth: number; args: string[] | null; slots: Map<string, string> };

// Escaped punctuation stays escaped: the caller runs unescapeCbs once, at the very end. Throws Runaway.
export function evaluate(text: string, context: CbsContext): string {
  const { source } = context;
  const message = 'message' in source;
  const seed = message ? context.messages[source.message]!.seed : source.seed;
  const run: Run = { context, seed, temp: new Map(), functions: new Map(), spent: { tags: 0, chars: 0 } };
  return enter(parse(prestep(text)), { run, prefix: '', writes: message, depth: 0, args: null, slots: new Map() });
}

// Risu reads <user>, <char> and <bot>, in any case, as those tags.
const prestep = (text: string) => text.replace(/<(user|char|bot)>/gi, (_, name: string) => `{{${name.toLowerCase()}}}`);

function enter(nodes: Node[], frame: Frame): string {
  if (frame.depth > DEPTH) return TOO_DEEP;
  try {
    return evaluateNodes(nodes, frame);
  } catch (error) {
    if (error instanceof Return) return error.value;
    throw error;
  }
}

function evaluateNodes(nodes: Node[], frame: Frame): string {
  const { spent } = frame.run;
  let out = '';
  for (const node of nodes) {
    const piece = typeof node === 'string' ? node : node.kind === 'tag' ? evaluateTag(node, frame) : evaluateBlock(node, frame);
    if (typeof node !== 'string') spent.tags++;
    if (typeof piece === 'string') spent.chars += piece.length;
    if (spent.tags > MOST_TAGS || spent.chars > MOST_CHARS) throw new Runaway();
    out = typeof piece === 'string' ? out + piece : piece(out);
  }
  return out;
}

const asWritten = (content: string) => `{{${content}}}`;

// At `::`, or at `:` when the first colon is single, so {{getvar:x}} works.
export function separatorOf(content: string): string | null {
  const colon = content.indexOf(':');
  return colon === -1 ? null : content[colon + 1] === ':' ? '::' : ':';
}

function splitArgs(content: string): string[] {
  const sep = separatorOf(content);
  return sep === null ? [content] : content.split(sep);
}

export function blockHead(content: string): { name: string; rest: string } | null {
  const match = /^\s*#([^\s:]*)([\s\S]*)$/.exec(content);
  return match && { name: normalize(match[1]!), rest: match[2]! };
}

// The inner tags are evaluated first and the tag's name and arguments read from their output, which is how
// {{spread}} hands a tag its arguments.
function evaluateTag(tag: Tag, frame: Frame): string | Erase {
  const content = evaluateNodes(tag.parts, frame);
  if (content.startsWith('//')) return frame.run.context.stage === 'display' ? asWritten(content) : '';
  const [name, ...args] = content.startsWith('? ') ? ['calc', content.slice(2)] : content.trim() === ':' ? [':'] : splitArgs(content);
  const handler = handlerFor(name!);
  if (!handler || args.length < handler.min) return asWritten(content);
  try {
    return handler.run(args, env(frame, frame.prefix + tag.at)) ?? asWritten(content);
  } catch (error) {
    // An argument out of range: a timestamp, a digit count, a code point, a repeat count.
    if (error instanceof RangeError) return asWritten(content);
    throw error;
  }
}

function env(frame: Frame, place: string): Env {
  const { run } = frame;
  let rolls: (() => number) | null = null;
  const nested = (args: string[] | null, writes: boolean): Frame => ({ run, prefix: `${place}>`, writes, depth: frame.depth + 1, args, slots: new Map() });
  return {
    context: run.context,
    writes: frame.writes,
    temp: run.temp,
    random: () => (rolls ??= seeded(`${run.seed}:${place}`))(),
    // An inserted text is not a chat message, so it writes no variables.
    insert: (text) => enter(parse(prestep(text)), nested(null, false)),
    call: (name, args) => {
      const body = run.functions.get(name);
      return body ? enter(body, nested([name, ...args], frame.writes)) : null;
    },
    arg: (index) => frame.args?.[index] ?? null,
    slot: (name) => frame.slots.get(name) ?? null,
  };
}

// The blocks whose body is taken as its source and never evaluated, so a tag written in one is text.
const RAW = new Map<string, (raw: string, rest: string) => string>([
  ['escape', (raw, rest) => escapeCbs(rest === '::keep' ? raw : trimBlank(raw), '{}()')],
  ['pure', (raw) => raw],
  // Risu backslash-escapes the braces for its markdown; escaped braces survive the later passes and show as braces.
  ['puredisplay', (raw) => escapeCbs(raw, '{}')],
]);
export const isRawBlock = (name: string) => RAW.has(name);

function evaluateBlock(block: Block, frame: Frame): string {
  const head = evaluateNodes(block.head.parts, frame);
  const { name, rest } = blockHead(head)!;
  const unknown = () => asWritten(head) + evaluateNodes(block.body, frame) + asWritten(evaluateNodes(block.close.parts, frame));
  const raw = RAW.get(name);
  if (raw) return raw(block.raw, rest);
  switch (name) {
    case 'when':
      return when(block, rest, frame);
    case 'if':
      return truthy(rest.trim()) ? evaluateNodes(trimLines(block.body), frame) : '';
    case 'ifpure':
      return truthy(rest.trim()) ? evaluateNodes(block.body, frame) : '';
    case 'each':
      return each(block, rest, frame) ?? unknown();
    case 'code':
      return unbackslash(evaluateNodes(block.body, frame).replace(/[\n\r\t]/g, ''));
    case 'func': {
      // Names after the function's are not read: a body reads its arguments as {{arg::1}} on.
      const name = rest.trim().split(/\s+/)[0];
      if (!name) return unknown();
      frame.run.functions.set(name, blankEnds(block.body));
      return '';
    }
    default:
      return unknown();
  }
}

// Only the branch taken is evaluated. Risu evaluates both and keeps one, so a setvar in the other ran too.
function when(block: Block, rest: string, frame: Frame): string {
  const { modes, condition } = whenArgs(rest);
  const holds = condition.length > 0 && fold(condition, frame.run.context);
  if (modes.includes('legacy')) return holds ? evaluateNodes(trimLines(block.body), frame) : '';
  const split = block.body.findIndex(isElse);
  const branch = holds ? (split === -1 ? block.body : block.body.slice(0, split)) : split === -1 ? [] : block.body.slice(split + 1);
  return evaluateNodes(modes.includes('keep') ? branch : blankEnds(branch), frame);
}

// Anywhere on the block's own level; Risu wants it alone on a line in a body of several lines.
const isElse = (node: Node) => typeof node === 'object' && node.kind === 'tag' && node.parts.length === 1 && typeof node.parts[0] === 'string' && node.parts[0].trim() === ':else';

const UNARY = new Map<string, (value: string, context: CbsContext) => boolean>([
  ['not', (value) => !truthy(value)],
  ['var', (name, context) => truthy(readVar(context, name))],
  ['toggle', (key, context) => truthy(readToggle(context, key))],
]);
const BINARY = new Map<string, (left: string, right: string, context: CbsContext) => boolean>([
  ['and', (a, b) => truthy(a) && truthy(b)],
  ['or', (a, b) => truthy(a) || truthy(b)],
  ['is', (a, b) => a === b],
  ['isnot', (a, b) => a !== b],
  ['>', (a, b) => Number(a) > Number(b)],
  ['<', (a, b) => Number(a) < Number(b)],
  ['>=', (a, b) => Number(a) >= Number(b)],
  ['<=', (a, b) => Number(a) <= Number(b)],
  ['vis', (name, value, context) => readVar(context, name) === value],
  ['visnot', (name, value, context) => readVar(context, name) !== value],
  ['tis', (key, value, context) => readToggle(context, key) === value],
  ['tisnot', (key, value, context) => readToggle(context, key) !== value],
]);

export function whenArgs(rest: string): { modes: string[]; condition: string[] } {
  const trimmed = rest.trim();
  const args = rest.startsWith(':') ? splitArgs(rest).slice(1) : trimmed ? [trimmed] : [];
  let first = 0;
  while (args[first] === 'keep' || args[first] === 'legacy') first += 1;
  return { modes: args.slice(0, first), condition: args.slice(first) };
}

// A condition's operators in the order they apply, each with the index of its left operand when it takes one; the
// first step's operand is the last argument as written. Operators apply right to left, each to everything on its
// right: not::a::and::b is not (a and b). A value where an operator belongs ends the steps, and the condition is false.
export function conditionSteps(condition: string[]): { steps: { op: string; left?: number }[]; valid: boolean } {
  const steps: { op: string; left?: number }[] = [];
  for (let i = condition.length - 2; i >= 0; i--) {
    const op = condition[i]!;
    if (UNARY.has(op)) steps.push({ op });
    else if (BINARY.has(op) && i > 0) steps.push({ op, left: --i });
    else return { steps, valid: false };
  }
  return { steps, valid: true };
}

function fold(condition: string[], context: CbsContext): boolean {
  const { steps, valid } = conditionSteps(condition);
  if (!valid) return false;
  let value = condition.at(-1)!;
  for (const { op, left } of steps) value = bool(left === undefined ? UNARY.get(op)!(value, context) : BINARY.get(op)!(condition[left]!, value, context));
  return truthy(value);
}

// #each ARRAY as NAME, or ARRAY NAME; `::keep` right after #each keeps the body's blank lines. null: no name.
function each(block: Block, rest: string, frame: Frame): string | null {
  const keep = rest.startsWith('::keep');
  // Split before trimming: an unset array leaves ` as x`, which is no items.
  const spec = (keep ? rest.slice('::keep'.length) : rest).trimEnd();
  const as = spec.lastIndexOf(' as ');
  const at = as === -1 ? spec.lastIndexOf(' ') : as;
  if (at === -1) return null;
  const name = spec.slice(at + (as === -1 ? 1 : ' as '.length)).trim();
  const body = keep ? block.body : blankEnds(block.body);
  const place = frame.prefix + block.at;
  return items(spec.slice(0, at).trim())
    .map((item, i) => evaluateNodes(body, { ...frame, prefix: `${place}.${i}>`, slots: new Map([...frame.slots, [name, item]]) }))
    .join('');
}

// Blocks trim the text at their body's two ends, which is the source's layout. What an inner tag outputs
// there, such as a {{br}}, is kept; Risu trims its output.
function trimEnds(nodes: Node[], start: (text: string) => string, end: (text: string) => string): Node[] {
  const out = [...nodes];
  const first = out[0];
  if (typeof first === 'string') out[0] = start(first);
  const last = out.at(-1);
  if (typeof last === 'string') out[out.length - 1] = end(last);
  return out;
}
const LEADING_BLANK = /^(?:[ \t]*\r?\n)+/;
const TRAILING_BLANK = /(?:\r?\n[ \t]*)+$/;
const trimBlank = (text: string) => text.replace(LEADING_BLANK, '').replace(TRAILING_BLANK, '');
const blankEnds = (nodes: Node[]) =>
  trimEnds(
    nodes,
    (text) => text.replace(LEADING_BLANK, ''),
    (text) => text.replace(TRAILING_BLANK, ''),
  );
// #if: each line's leading whitespace, then the whole body.
const trimLines = (nodes: Node[]) =>
  trimEnds(
    nodes.map((node) => (typeof node === 'string' ? node.replace(/\n[ \t]+/g, '\n') : node)),
    (text) => text.trimStart(),
    (text) => text.trimEnd(),
  );

const BACKSLASHED: Record<string, string> = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v', 0: '\0' };
const unbackslash = (text: string) =>
  text.replace(/\\(u[\da-fA-F]{4}|x[\da-fA-F]{2}|[\s\S])/g, (_, code: string) => (code.length > 1 ? String.fromCharCode(parseInt(code.slice(1), 16)) : (BACKSLASHED[code] ?? code)));
