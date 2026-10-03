import type { HistoryMessage } from '../history';
import type { Card, LoreEntry } from '../import/types';
import { seeded } from '../random';
import { args, parseDecorators, type DecoratorLine } from './decorators';
import { compile, scan, type Matcher, type Scanned, type Source } from './keys';

type Role = 'system' | 'user' | 'assistant';

export type Operation = { kind: 'append' } | { kind: 'prepend' } | { kind: 'replace'; find: string };

export type Placement =
  | { kind: 'lorebook'; role: Role }
  | { kind: 'description'; side: 'before' | 'after' }
  // Counted from the end of the chat: 0 is after the last message.
  | { kind: 'depth'; depth: number; role: Role }
  | { kind: 'position'; name: string }
  | { kind: 'inject'; target: string; operation: Operation };

export type KeyMatch = { query: 'primary' | 'secondary' | 'additional'; key: string; source: Source };

export type Why = { kind: 'constant' } | { kind: 'decorator'; name: 'activate' | 'keep_activate_after_match' } | { kind: 'keys'; matched: KeyMatch[] };

// tokens: the cost of the entry's own body, before any merge.
export type Fate =
  | { kind: 'placed'; tokens: number }
  | { kind: 'merged'; into: string; tokens: number }
  | { kind: 'dropped'; cause: 'probability' }
  | { kind: 'dropped'; cause: 'budget' | 'no-target'; tokens: number };

export type Fired = { id: string; why: Why; fate: Fate };

// In lorebook order. The ids key the after-match state, so they must outlive the send.
export type LoreEntries = { id: string; value: Omit<LoreEntry, 'folder'> }[];

export type LoreTurn = {
  // Only the messages before turn are scanned: the after-match replay passes the whole chat for every earlier reply.
  history: HistoryMessage[];
  // Risu's chatLength, which @@activate_only_after and @@activate_only_every compare with: the messages
  // before the reply being written, the greeting counted.
  turn: number;
  // The chat's greeting as an index into Card.greetings, which @@is_greeting counts from 1.
  greeting: number | null;
  // Entries with an after-match decorator that went into an earlier prompt of this chat, as the previous
  // Activation.afterMatch left them.
  afterMatch: readonly string[];
  seed: string;
  // What an entry's own body costs as the request sends it; the id is the entry's, which places its random tags.
  cost: (id: string, body: string) => number;
};

export type Activation = {
  // Raw bodies, with the @@inject_lore entries merged in. Entries bound for one place are listed in the order
  // they go in there.
  placed: { id: string; body: string; placement: Placement }[];
  // Every entry that fired, in the order it fired, including those that did not go in.
  fired: Fired[];
  invalidKeys: { entry: string; key: string }[];
  afterMatch: string[];
};

// risu-alpha has no global lorebook settings yet, so a card's null settings take Risu's global defaults
// (risu-compat-spec §a character_book conversion, §b Scan settings).
const DEFAULTS = { scanDepth: 5, tokenBudget: 800, recursive: true, fullWordMatching: false };

type Where =
  | { kind: 'lorebook' }
  | { kind: 'description'; side: 'before' | 'after' }
  | { kind: 'depth'; depth: number; reverse: boolean }
  | { kind: 'position'; name: string }
  | { kind: 'inject'; target: string };

// What an entry's decorators leave it with. A later decorator of the same kind replaces an earlier one, and
// so does any later placement decorator (depth, position, inject_at).
type Rules = {
  trigger: 'keys' | 'activate' | 'never';
  afterMatch: 'keep' | 'dont' | null;
  onlyAfter: number;
  onlyEvery: number;
  greeting: number | null;
  probability: number;
  scanDepth: number | null;
  fullWord: boolean | null;
  priority: number;
  recursive: boolean | null;
  searchRecursion: boolean;
  additional: string[][];
  exclude: string[][];
  excludeAll: string[][];
  role: Role;
  where: Where;
  into: string | null;
  operation: Operation;
};

type Query = { key: string; match: Matcher }[];
type Evidence = Map<Matcher, Source>;

type Book = {
  id: string;
  value: Omit<LoreEntry, 'folder'>;
  body: string;
  scanned: Scanned;
  matchers: Matcher[];
  rules: Rules;
  queries: { primary: Query; secondary: Query; additional: Query[]; exclude: Query[]; excludeAll: Query[] };
};

const ROLES: readonly string[] = ['system', 'user', 'assistant'];
const SIDES = new Map<string, 'before' | 'after'>([
  ['before_desc', 'before'],
  ['after_desc', 'after'],
  ['personality', 'after'],
  ['scenario', 'after'],
]);
const NEVER: Matcher = () => false;

export type LoreBook = { sticky: boolean; activate: (input: LoreTurn) => Activation };

export function prepareLore(entries: LoreEntries, settings: Card['loreSettings']): LoreBook {
  const invalidKeys: Activation['invalidKeys'] = [];
  const books = entries.filter(({ value }) => value.enabled).map((entry) => prepare(entry, settings.fullWordMatching ?? DEFAULTS.fullWordMatching, invalidKeys));
  // A prepared book belongs to one replay; edits/settings changes start another and cannot reuse stale text.
  const scanned = new WeakMap<HistoryMessage, Scanned>();
  const window = (history: HistoryMessage[], end: number, depth: number) => {
    const messages: Scanned[] = [];
    for (let at = Math.max(end - depth, 0); at < end; at++) {
      const message = history[at]!;
      let text = scanned.get(message);
      if (!text) {
        text = scan({ kind: 'message', id: message.id }, message.text);
        scanned.set(message, text);
      }
      messages.push(text);
    }
    return messages;
  };
  return {
    sticky: books.some(({ rules }) => rules.trigger !== 'never' && rules.afterMatch !== null),
    activate: (input) => activate(books, settings, invalidKeys, window, input),
  };
}

function activate(books: Book[], settings: Card['loreSettings'], invalidKeys: Activation['invalidKeys'], window: (history: HistoryMessage[], end: number, depth: number) => Scanned[], { history, turn, greeting, afterMatch: before, seed, cost }: LoreTurn): Activation {
  const afterMatch = new Set(before);
  const scanDepth = settings.scanDepth ?? DEFAULTS.scanDepth;
  const recursive = settings.recursive ?? DEFAULTS.recursive;

  const open = ({ id, rules }: Book) =>
    rules.trigger !== 'never' &&
    !(rules.afterMatch === 'dont' && afterMatch.has(id)) &&
    turn >= rules.onlyAfter &&
    turn % rules.onlyEvery === 0 &&
    (rules.greeting === null || (greeting !== null && greeting + 1 === rules.greeting));
  const matched: { book: Book; why: Why }[] = [];
  const active: Book[] = [];
  const fates = new Map<string, Fate>();
  let waiting = books.filter(open).map((book) => ({ book, evidence: new Map<Matcher, Source>() }));
  let frontier: Scanned[] = [];
  let first = true;
  // Each pass scans what the passes before it activated; an entry fires once, and its roll is its own for the
  // whole send, whichever pass reaches it.
  for (;;) {
    const waited = waiting;
    const now: Book[] = [];
    waiting = [];
    for (const pending of waited) {
      const { book, evidence } = pending;
      const why = triggered(book, afterMatch, () => {
        if (first) consume(book.matchers, evidence, window(history, turn, book.rules.scanDepth ?? scanDepth));
        if (book.rules.searchRecursion) consume(book.matchers, evidence, frontier);
        return evidence;
      });
      if (!why) {
        waiting.push(pending);
        continue;
      }
      matched.push({ book, why });
      if (seeded(`${seed}:${book.id}`)() * 100 < book.rules.probability) now.push(book);
      else fates.set(book.id, { kind: 'dropped', cause: 'probability' });
    }
    active.push(...now);
    const bodies = now.filter(({ rules }) => rules.recursive ?? recursive).map(({ scanned }) => scanned);
    if (bodies.length === 0) break;
    frontier = bodies;
    first = false;
  }

  // Risu's budget and order (risu-compat-spec §b Budget, ordering, output), step by step: the stable sorts and
  // the final reverse decide where ties land.
  const tokens = new Map(active.map(({ id, body }) => [id, cost(id, body)]));
  let left = settings.tokenBudget ?? DEFAULTS.tokenBudget;
  const kept: Book[] = [];
  for (const book of [...active].sort((a, b) => b.rules.priority - a.rules.priority)) {
    const cost = tokens.get(book.id)!;
    if (cost > left) {
      fates.set(book.id, { kind: 'dropped', cause: 'budget', tokens: cost });
      continue;
    }
    left -= cost;
    kept.push(book);
  }
  kept.sort((a, b) => b.value.insertionOrder - a.value.insertionOrder);
  const bodies = new Map(kept.map(({ id, body }) => [id, body]));
  const stays = kept.filter(({ rules }) => rules.into === null);
  for (const book of kept) {
    if (book.rules.into === null) continue;
    const target = stays.find(({ value }) => value.name === book.rules.into);
    const body = target ? merge(bodies.get(target.id)!, book.body, book.rules.operation) : null;
    const cost = tokens.get(book.id)!;
    if (target && body !== null) {
      bodies.set(target.id, body);
      fates.set(book.id, { kind: 'merged', into: target.id, tokens: cost });
    } else fates.set(book.id, { kind: 'dropped', cause: 'no-target', tokens: cost });
  }
  const final = stays.reverse();
  for (const { id } of final) fates.set(id, { kind: 'placed', tokens: tokens.get(id)! });

  const ranked = final.map((book, index) => ({ book, rank: depthRank(book.rules, index) }));
  const placed = [...ranked.filter(({ rank }) => rank.length === 0), ...ranked.filter(({ rank }) => rank.length > 0).sort((a, b) => compare(a.rank, b.rank))];
  const went = kept.filter(({ id, rules }) => rules.afterMatch !== null && fates.get(id)!.kind !== 'dropped').map(({ id }) => id);
  return {
    placed: placed.map(({ book }) => ({ id: book.id, body: bodies.get(book.id)!, placement: placement(book.rules) })),
    fired: matched.map(({ book, why }) => ({ id: book.id, why, fate: fates.get(book.id)! })),
    invalidKeys,
    afterMatch: [...new Set([...before, ...went])],
  };
}

function prepare({ id, value }: LoreEntries[number], fullWordMatching: boolean, invalidKeys: Activation['invalidKeys']): Book {
  const { decorators, body } = parseDecorators(value.content);
  const rules: Rules = {
    trigger: 'keys',
    afterMatch: null,
    onlyAfter: 0,
    onlyEvery: 1,
    greeting: null,
    probability: 100,
    scanDepth: null,
    fullWord: null,
    // CCv3 defines priority and position, which Risu drops; CCv3 wins.
    priority: value.priority ?? value.insertionOrder,
    recursive: null,
    searchRecursion: true,
    additional: [],
    exclude: [],
    excludeAll: [],
    role: 'system',
    // before_char and after_char: the character's definitions are what the description slot holds.
    where: value.position === null ? { kind: 'lorebook' } : { kind: 'description', side: value.position === 'before_char' ? 'before' : 'after' },
    into: null,
    operation: { kind: 'append' },
  };
  for (const decorator of decorators) {
    if (!apply(rules, decorator)) decorator.fallbacks.some((fallback) => apply(rules, fallback));
  }
  const mode = { regex: value.useRegex, caseSensitive: value.caseSensitive, fullWord: rules.fullWord ?? fullWordMatching };
  const query = (keys: string[]): Query =>
    keys
      .map((key) => key.trim())
      .filter((key) => key !== '')
      .map((key) => {
        const match = compile(key, mode);
        if (!match) invalidKeys.push({ entry: id, key });
        // A key that does not compile never matches, so it cannot complete an @@exclude_keys_all either.
        return { key, match: match ?? NEVER };
      });
  const queries = {
    primary: query(value.keys),
    secondary: value.selective ? query(value.secondaryKeys) : [],
    additional: rules.additional.map(query),
    exclude: rules.exclude.map(query),
    excludeAll: rules.excludeAll.map(query),
  };
  return {
    id,
    value,
    body,
    scanned: scan({ kind: 'entry', id }, body),
    rules,
    queries,
    matchers: [queries.primary, queries.secondary, ...queries.additional, ...queries.exclude, ...queries.excludeAll].flat().map(({ match }) => match),
  };
}

const integer = (value: string, min: number) => {
  const number = Number(value);
  return value !== '' && Number.isInteger(number) && number >= min ? number : null;
};
const finite = (value: string) => {
  const number = Number(value);
  return value !== '' && Number.isFinite(number) ? number : null;
};

// false when the decorator is not handled, so its @@@ fallbacks are tried: unknown names, invalid arguments,
// and @@disable_ui_prompt, which risu-alpha does not implement.
function apply(rules: Rules, { name, value }: DecoratorLine): boolean {
  switch (name) {
    case 'depth':
    case 'reverse_depth': {
      const depth = integer(value, 0);
      if (depth === null) return false;
      rules.where = { kind: 'depth', depth, reverse: name === 'reverse_depth' };
      return true;
    }
    case 'end':
      rules.where = { kind: 'depth', depth: 0, reverse: false };
      return true;
    case 'role':
      if (!ROLES.includes(value)) return false;
      rules.role = value as Role;
      return true;
    case 'position': {
      const side = SIDES.get(value);
      if (side) rules.where = { kind: 'description', side };
      else if (value.startsWith('pt_')) rules.where = { kind: 'position', name: value.slice(3) };
      else return false;
      return true;
    }
    case 'inject_at':
      if (value === '') return false;
      rules.where = { kind: 'inject', target: value };
      return true;
    case 'inject_lore':
      if (value === '') return false;
      rules.into = value;
      return true;
    // Its argument is not read: the spec gives prepend's parameter no meaning.
    case 'inject_prepend':
      rules.operation = { kind: 'prepend' };
      return true;
    case 'inject_replace':
      if (value === '') return false;
      rules.operation = { kind: 'replace', find: value };
      return true;
    case 'scan_depth':
    case 'activate_only_after':
    case 'activate_only_every':
    case 'is_greeting': {
      const number = integer(value, name === 'scan_depth' || name === 'activate_only_after' ? 0 : 1);
      if (number === null) return false;
      if (name === 'scan_depth') rules.scanDepth = number;
      else if (name === 'activate_only_after') rules.onlyAfter = number;
      else if (name === 'activate_only_every') rules.onlyEvery = number;
      else rules.greeting = number;
      return true;
    }
    case 'probability':
    case 'priority': {
      const number = finite(value);
      if (number === null) return false;
      if (name === 'probability') rules.probability = number;
      else rules.priority = number;
      return true;
    }
    case 'ignore_on_max_context':
      rules.priority = -1000;
      return true;
    // Like constant: the keys are not searched, and the turn, greeting and probability conditions still apply.
    case 'activate':
      rules.trigger = 'activate';
      return true;
    case 'dont_activate':
      rules.trigger = 'never';
      return true;
    // Per entry: the flag lives in this entry's rules, and the state is keyed by its id.
    case 'keep_activate_after_match':
    case 'dont_activate_after_match':
      rules.afterMatch = name === 'keep_activate_after_match' ? 'keep' : 'dont';
      return true;
    case 'additional_keys':
    case 'exclude_keys':
    case 'exclude_keys_all': {
      const keys = args(value);
      if (keys.length === 0) return false;
      (name === 'additional_keys' ? rules.additional : name === 'exclude_keys' ? rules.exclude : rules.excludeAll).push(keys);
      return true;
    }
    case 'match_full_word':
    case 'match_partial_word':
      rules.fullWord = name === 'match_full_word';
      return true;
    case 'recursive':
    case 'unrecursive':
      rules.recursive = name === 'recursive';
      return true;
    case 'no_recursive_search':
      rules.searchRecursion = false;
      return true;
    default:
      return false;
  }
}

function triggered({ id, value, rules, queries }: Book, afterMatch: ReadonlySet<string>, readEvidence: () => Evidence): Why | null {
  if (value.constant) return { kind: 'constant' };
  if (rules.trigger === 'activate') return { kind: 'decorator', name: 'activate' };
  if (rules.afterMatch === 'keep' && afterMatch.has(id)) return { kind: 'decorator', name: 'keep_activate_after_match' };
  const evidence = readEvidence();
  const matched: KeyMatch[] = [];
  const needs = (query: Query, name: KeyMatch['query']) => {
    const hit = find(query, evidence);
    if (hit) matched.push({ query: name, ...hit });
    return hit !== null;
  };
  if (!needs(queries.primary, 'primary')) return null;
  if (queries.secondary.length > 0 && !needs(queries.secondary, 'secondary')) return null;
  if (!queries.additional.every((query) => needs(query, 'additional'))) return null;
  if (queries.exclude.some((query) => find(query, evidence))) return null;
  // Every key somewhere in the scanned text, not every key in every message.
  if (queries.excludeAll.some((query) => query.every(({ match }) => evidence.has(match)))) return null;
  return { kind: 'keys', matched };
}

function consume(matchers: Matcher[], evidence: Evidence, sources: Scanned[]) {
  for (const match of matchers) {
    if (evidence.has(match)) continue;
    const scanned = sources.find(match);
    if (scanned) evidence.set(match, scanned.source);
  }
}

function find(query: Query, evidence: Evidence): { key: string; source: Source } | null {
  // Key order outranks source age: a higher-priority key can first match in a later frontier.
  for (const { key, match } of query) {
    const source = evidence.get(match);
    if (source) return { key, source };
  }
  return null;
}

// null: the text a replace looks for is not in the target.
export function merge(target: string, body: string, operation: Operation): string | null {
  switch (operation.kind) {
    case 'append':
      return `${target} ${body}`;
    case 'prepend':
      return `${body} ${target}`;
    case 'replace':
      return target.includes(operation.find) ? target.replace(operation.find, () => body) : null;
  }
}

function placement({ where, role, operation }: Rules): Placement {
  switch (where.kind) {
    case 'lorebook':
      return { kind: 'lorebook', role };
    case 'depth':
      return { kind: 'depth', depth: where.depth, role };
    case 'inject':
      return { kind: 'inject', target: where.target, operation };
    default:
      return where;
  }
}

// Risu's order among the entries at one depth (risu-compat-spec §e steps 7 and 14), kept now that depth counts
// from the end: @@depth entries last-first, then @@reverse_depth ones in order. At 0, where Risu sent @@depth
// entries to postEverything, @@reverse_depth ones come first, then @@depth ones in order with assistant ones last.
// Empty for an entry bound elsewhere.
function depthRank({ where, role }: Rules, index: number): number[] {
  if (where.kind !== 'depth') return [];
  if (where.depth > 0) return where.reverse ? [where.depth, 1, index] : [where.depth, 0, -index];
  return [0, where.reverse ? 0 : role === 'assistant' ? 2 : 1, index];
}

const compare = (a: number[], b: number[]) => a.reduce((result, value, i) => result || value - b[i]!, 0);
