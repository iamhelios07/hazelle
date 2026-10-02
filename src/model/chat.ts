import type { Assignment, ModelRef } from '../connectors/assignment';
import type { Cache } from '../connectors/settings';
import type { Cost, Usage } from '../connectors/types';
import type { Kind, Stored } from './kinds';
import type { MemorySettings } from './memory';

// Its messages are `entry` objects whose parent is the chat.
export type Chat = {
  // null until the user names the chat; until then it is called by its first message, or a branch after its
  // origin (chatTitle).
  title: string | null;
  // A chat with no character talks to the model as it is.
  character: string | null;
  // The 채팅 layer of the model assignment.
  models: Assignment;
  // The chat's own prompt, persona and 작가의 노트; each absent follows the default.
  prompt?: string;
  persona?: string;
  note?: string;
  // A branch's original chat, named as it was then so a renamed or deleted one still reads; after is the message
  // of this chat that the split comes after, where its divider stands.
  origin?: { id: string; name: string; after: string };
  // The id pick and rollp roll from in place of this chat's own: a branch keeps its original's, so the history
  // it copied reads the same.
  seed?: string;
  // 이 채팅만 따로: the chat's own memory settings in place of the account's.
  memory?: MemorySettings;
  // The variables it starts from, over the card's defaults: a chat brought from Risu keeps Risu's.
  variables?: [string, string][];
};

// What a reply's generation left behind. The raw request is never stored.
export type Receipt = {
  connection: string;
  // The connection's and the model's names when the reply was made; either may be renamed or deleted later.
  source: string;
  model: string;
  modelName: string;
  state: 'done' | 'cut' | 'failed';
  cut: 'length' | 'no-terminal' | 'stopped' | null;
  error: ReceiptError | null;
  finishReason: string | null;
  usage: Usage | null;
  // pending until a `cost` entry for replyId arrives.
  cost: Cost | 'pending' | null;
  replyId: string | null;
  firstTextMs: number | null;
  totalMs: number;
  // How long the call's cache points keep what they cache, measured from its start; null when it sent none, or its
  // request was not this page's.
  cache: Cache | null;
  // 이어 쓰기: the receipt of the reply this one continued, as it read then, so every call and its cost stays
  // visible after the continued version replaces the cut one. It nests when a continuation is continued again.
  continues?: Receipt;
};

// A receipt's own copy of runtime/generate ReplyError, converted where the receipt is written, so a
// change to the network's failure types never changes what saved chats hold. A stop is a cut, never
// an error. status is there when the provider refused the request, and absent when its stream failed.
export type ReceiptError =
  | { kind: 'refused'; code: string }
  | { kind: 'relay'; code: string }
  | { kind: 'app'; code: string }
  | { kind: 'provider'; status: number; detail: string }
  | { kind: 'provider'; detail: string }
  | { kind: 'bad-event'; detail: string }
  | { kind: 'network'; detail: string }
  | { kind: 'offline' }
  | { kind: 'no-token' };

// A version as the reader reads it, beside its text, which is what the model is sent and never this.
// A reply's is translated from its displayed text; a message sent translated keeps here what the user typed, and its
// text is the translation sent. receipt: the call that translated, null when the user wrote it in an edit.
export type Translation = { text: string; receipt: Receipt | null; at: number };

// Per character, or for every 캐릭터 없이 chat: replies translates each chat's latest reply, input
// sends the user's messages translated, reverse (반전 모드) sends the model each version's translation in place of
// its text. replyLanguage and inputLanguage are what replies and the user's messages are translated
// into, each as the English name the prompt reads. prompt is the translation prompt. Absent fields are read through
// runtime/characters translateSwitches, the one place that knows their defaults.
export type TranslateSwitches = { replies: boolean; input: boolean; reverse?: boolean; replyLanguage?: string; inputLanguage?: string; prompt?: string };

// Chat entries are created and never changed: an edit, a swipe or a deletion is a new
// entry. at is the writer's clock, for showing times only; order is the server's rev.
// seed: the id a version's random tags roll from in place of its own. A branch's copy keeps its original's, and
// an edit or a continued cut keeps the seed of the version it replaces, so text already shown never rolls again.
// translation: the version's own from the start, for a message sent translated, an edit and a branch's copy.
// staged: text already past the bot's input or output scripts (a message brought from Risu, one the bot's Lua
// wrote), which never run on it again; an edit of it is the same.
// before: the variables the bot's Lua wrote on the way to this version (when the message was sent, before its reply
// was made), which the chat's replay sets before the version's own text is read. An edit keeps those of the version
// it changes and adds its own.
export type Entry =
  // A new message with its first version, which has the entry's id.
  | { type: 'message'; role: 'user' | 'assistant'; at: number; text: string; receipt: Receipt | null; seed?: string; translation?: Translation; staged?: true; before?: Writes }
  // replaces: the version this one takes the place of, for an edit, a retried failure or a continued cut
  // (이어 쓰기), so the count of versions does not grow; null for a new version, which goes last. An edit keeps
  // the receipt of the reply it changes.
  | { type: 'version'; message: string; replaces: string | null; edit: boolean; at: number; text: string; receipt: Receipt | null; seed?: string; translation?: Translation; staged?: true; before?: Writes }
  | { type: 'select'; message: string; version: string; at: number }
  | { type: 'delete'; message: string; at: number }
  | { type: 'restore'; message: string; at: number }
  // A cost the provider booked after the reply, for every receipt with this replyId, those a continued reply
  // carries and translations' included.
  | { type: 'cost'; replyId: string; cost: Cost | null; at: number }
  // A translation made after the version was saved; the latest one for a version is its translation.
  | ({ type: 'translation'; version: string } & Translation)
  // The variables the bot's Lua wrote once the version stood (after its reply ended, on a button), which the replay
  // sets after the version's own text is read. They follow the version into its edits and no further: a retried or
  // continued reply runs the bot's Lua again.
  | { type: 'vars'; version: string; set: Writes; at: number }
  // A model call the bot's Lua made (LLM, axLLM) while version was the last one shown, kept so usage and cost count
  // it. It follows the version as vars does.
  | { type: 'call'; version: string; receipt: Receipt; at: number };

// Variable writes in the order made; a later one of a name wins.
export type Writes = [string, string][];

export type Version = { id: string; seed: string; text: string; receipt: Receipt | null; edited: boolean; at: number; translation?: Translation; staged?: true; before?: Writes; after?: Writes; calls?: BotCall[] };
export type BotCall = { receipt: Receipt; at: number };
export type Message = { id: string; role: 'user' | 'assistant'; at: number; versions: Version[]; selected: number };

const versionOf = (id: string, entry: Extract<Entry, { type: 'message' | 'version' }>, edited: boolean, staged: boolean): Version => ({
  id,
  seed: entry.seed ?? id,
  text: entry.text,
  receipt: entry.receipt,
  edited,
  at: entry.at,
  ...(entry.translation && { translation: entry.translation }),
  ...(staged && { staged: true }),
  ...(entry.before && { before: entry.before }),
});

// A chat's entries, read in rev order into the messages on screen. Entries naming a message or version
// that is not there (yet) are skipped.
export function fold(entries: Stored<'entry'>[]): Message[] {
  const messages = new Map<string, Message>();
  const deleted = new Set<string>();
  // A replaced version's id keeps leading to the version that took its place.
  const versions = new Map<string, Version>();
  // By a version's own id only: a translation of a replaced version is not its replacement's.
  const own = new Map<string, Version>();
  // By a version's own id and those of the versions it is an edit of, and those ids by the version.
  const edits = new Map<string, Version>();
  const ids = new Map<Version, string[]>();
  const stand = (id: string, version: Version, earlier: string[] = []) => {
    ids.set(version, [...earlier, id]);
    for (const each of ids.get(version)!) edits.set(each, version);
  };
  const costs = new Map<string, Cost | null>();
  const locate = (message: Message, id: string) => {
    const version = versions.get(id);
    return version ? message.versions.indexOf(version) : -1;
  };

  for (const { id, value: entry } of [...entries].sort((a, b) => a.rev - b.rev)) {
    if (entry.type === 'message') {
      const version = versionOf(id, entry, false, entry.staged === true);
      versions.set(id, version);
      own.set(id, version);
      stand(id, version);
      messages.set(id, { id, role: entry.role, at: entry.at, versions: [version], selected: 0 });
      continue;
    }
    if (entry.type === 'vars') {
      const version = edits.get(entry.version);
      if (version) version.after = [...(version.after ?? []), ...entry.set];
      continue;
    }
    if (entry.type === 'call') {
      const version = edits.get(entry.version);
      if (version) version.calls = [...(version.calls ?? []), { receipt: entry.receipt, at: entry.at }];
      continue;
    }
    if (entry.type === 'cost') {
      costs.set(entry.replyId, entry.cost);
      continue;
    }
    if (entry.type === 'translation') {
      const version = own.get(entry.version);
      if (version) version.translation = { text: entry.text, receipt: entry.receipt, at: entry.at };
      continue;
    }
    const message = messages.get(entry.message);
    if (!message) continue;
    if (entry.type === 'version') {
      const slot = entry.replaces === null ? -1 : locate(message, entry.replaces);
      const edited = entry.edit ? message.versions[slot] : undefined;
      const version = versionOf(id, entry, entry.edit, entry.staged === true || edited?.staged === true);
      if (edited) {
        if (edited.before) version.before = [...edited.before, ...(entry.before ?? [])];
        if (edited.after) version.after = edited.after;
        if (edited.calls) version.calls = edited.calls;
      }
      own.set(id, version);
      stand(id, version, edited && ids.get(edited));
      if (slot === -1) message.versions.push(version);
      else message.versions[slot] = version;
      versions.set(id, version);
      if (entry.replaces !== null && slot !== -1) versions.set(entry.replaces, version);
      message.selected = slot === -1 ? message.versions.length - 1 : slot;
    } else if (entry.type === 'select') {
      const slot = locate(message, entry.version);
      if (slot !== -1) message.selected = slot;
    } else if (entry.type === 'delete') {
      deleted.add(message.id);
    } else if (entry.type === 'restore') {
      deleted.delete(message.id);
    }
  }

  const settled = (receipt: Receipt): Receipt => {
    const earlier = receipt.continues && settled(receipt.continues);
    const own = receipt.cost === 'pending' && receipt.replyId && costs.has(receipt.replyId) ? { ...receipt, cost: costs.get(receipt.replyId)! } : receipt;
    return earlier === receipt.continues ? own : { ...own, continues: earlier };
  };
  return [...messages.values()]
    .filter((message) => !deleted.has(message.id))
    .map((message) => ({
      ...message,
      versions: message.versions.map((version) => {
        const receipt = version.receipt && settled(version.receipt);
        const translated = version.translation?.receipt && settled(version.translation.receipt);
        const made = version.calls?.map((call) => ({ ...call, receipt: settled(call.receipt) }));
        if (receipt === version.receipt && translated === version.translation?.receipt && !made?.some((call, index) => call.receipt !== version.calls![index]!.receipt)) return version;
        return { ...version, receipt, ...(version.translation && { translation: { ...version.translation, receipt: translated ?? null } }), ...(made && { calls: made }) };
      }),
    }));
}

export const shown = (message: Message): Version => message.versions[message.selected]!;

// The calls a reply took, the first one first: one, or more when it was continued (이어 쓰기).
export const calls = (receipt: Receipt): Receipt[] => [...(receipt.continues ? calls(receipt.continues) : []), receipt];

// A bot's HTML shows as the words in it.
export const firstLine = (text: string) =>
  text
    .replace(/<[^>]*>/g, ' ')
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line !== '') ?? '';

// texts: each message's text as it is displayed (engine/render, which the model cannot call).
export function chatTitle(chat: Chat, messages: Message[], texts: string[]): string {
  if (chat.title) return chat.title;
  if (chat.origin) return `${chat.origin.name} · 갈래`;
  const first = messages.findIndex((message) => message.role === 'user');
  return (first !== -1 && firstLine(texts[first]!)) || '새 채팅';
}

// count and preview are null while the chat has no saved summary.
export type ChatSummary = { id: string; chat: Chat; count: number | null; title: string; preview: string | null; at: number | null; order: number };
export type ChatItem = ChatSummary & { count: number; preview: string; messages: Message[] };
export type SummaryRead = ({ kind: Kind; id: string } | { kind: Kind; list: true } | { kind: Kind; parent: string }) & { rev: number };
export type Summary = {
  version: number;
  head: number;
  chatRev: number;
  dependencies: SummaryRead[];
  rendered: { now: number; timeZone: string };
  character: string | null;
  title: string;
  preview: string;
  count: number;
  at: number | null;
  order: number;
  recent: RecentModel[];
};
export type RecentModel = { at: number; ref: ModelRef };

// One shelf's chats with each branch right under the chat it came from, in the order given at each level.
// A branch whose origin is not among them stands at the top level.
export function branchTree(items: ChatSummary[]): { item: ChatSummary; nested: boolean }[] {
  const ids = new Set(items.map((item) => item.id));
  const parent = ({ chat }: ChatSummary) => (chat.origin && ids.has(chat.origin.id) ? chat.origin.id : null);
  const under = (origin: string | null): { item: ChatSummary; nested: boolean }[] =>
    items.filter((item) => parent(item) === origin).flatMap((item) => [{ item, nested: origin !== null }, ...under(item.id)]);
  return under(null);
}

type Tally = { total: number; unknown: number };
// A count sums the calls that reported it, and unknown counts those that did not, so a gap never shrinks the total.
// costs: one per unit, never summed together; estimated once any part came from a price list. last: the newest reply's time.
export type ModelUsage = { calls: number; last: number | null; input: Tally; output: Tally; costs: { unit: Cost['unit']; amount: number; estimated: boolean }[]; costUnknown: number };

// Every call to one model in the chats kept, a continued reply counting each of its calls and a translation its own.
// A branch copies the replies it holds with their receipts, so a call is counted once however many chats hold it; the
// cost stays out of the key, as the original settles it later than a copy made after.
export class UsageCounter {
  private readonly usage: Omit<ModelUsage, 'costs' | 'costUnknown'> = { calls: 0, last: null, input: { total: 0, unknown: 0 }, output: { total: 0, unknown: 0 } };
  private readonly seen = new Map<string, Cost | null>();
  constructor(private readonly ref: ModelRef) {}

  get value(): ModelUsage {
    const costs: ModelUsage['costs'] = [];
    let costUnknown = 0;
    for (const cost of this.seen.values()) {
      if (!cost) { costUnknown++; continue; }
      const sum = costs.find((entry) => entry.unit === cost.unit);
      if (sum) {
        sum.amount += cost.amount;
        sum.estimated ||= cost.source === 'price-list';
      } else costs.push({ unit: cost.unit, amount: cost.amount, estimated: cost.source === 'price-list' });
    }
    return { ...this.usage, costs, costUnknown };
  }

  add(messages: Message[]) {
    const usage = this.usage;
    const add = (tally: Tally, value: number | null) => (value === null ? tally.unknown++ : (tally.total += value));
    const made = messages
      .flatMap((message) => message.versions)
      .flatMap(({ at, receipt, translation, calls: bot = [] }) => [
        ...(receipt ? calls(receipt).map((call) => ({ at, call })) : []),
        ...(translation?.receipt ? [{ at: translation.at, call: translation.receipt }] : []),
        ...bot.map((call) => ({ at: call.at, call: call.receipt })),
      ]);
    for (const { at, call } of made) {
      if (call.connection !== this.ref.connection || call.model !== this.ref.model) continue;
      const key = JSON.stringify([at, call.replyId, call.totalMs, call.firstTextMs, call.usage, call.state]);
      const cost = call.cost === 'pending' ? null : call.cost;
      if (this.seen.has(key)) {
        // A branch can be walked before the original that later settled the same call.
        const previous = this.seen.get(key);
        if (cost && (!previous || (previous.source === 'price-list' && cost.source === 'reported'))) this.seen.set(key, cost);
        continue;
      }
      this.seen.set(key, cost);
      usage.calls++;
      usage.last = Math.max(usage.last ?? 0, at);
      add(usage.input, call.usage?.inputTokens ?? null);
      add(usage.output, call.usage?.outputTokens ?? null);
    }
  }
}

export function modelUsage(chats: Message[][], ref: ModelRef): ModelUsage {
  const counter = new UsageCounter(ref);
  for (const messages of chats) counter.add(messages);
  return counter.value;
}

export function recentIn(messages: Message[]): RecentModel[] {
  const used = messages.flatMap((message) => message.versions)
    .flatMap((version) => (version.receipt ? [{ at: version.at, ref: { connection: version.receipt.connection, model: version.receipt.model } }] : []))
    .sort((a, b) => b.at - a.at);
  const latest: RecentModel[] = [];
  for (const model of used) {
    if (latest.some(({ ref }) => ref.connection === model.ref.connection && ref.model === model.ref.model)) continue;
    latest.push(model);
    if (latest.length === 3) break;
  }
  return latest;
}

// Models used lately across all chats, newest first, for the model picker's 최근.
export function recentModels(chats: RecentModel[][], limit: number): ModelRef[] {
  const used = chats.flat().sort((a, b) => b.at - a.at);
  const seen = new Set<string>();
  const refs: ModelRef[] = [];
  for (const { ref } of used) {
    const key = `${ref.connection}/${ref.model}`;
    if (seen.has(key)) continue;
    seen.add(key);
    refs.push(ref);
    if (refs.length === limit) break;
  }
  return refs;
}
