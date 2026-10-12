import type { Assignment, ModelRef } from '../connectors/assignment';
import type { Cache } from '../connectors/settings';
import type { Cost, Usage } from '../connectors/types';
import type { Kind, Stored } from './kinds';
import type { Mark } from './library';
import type { MemorySettings } from './memory';

export type Chat = Mark & {
  // null until the user names the chat; until then it is called by its first message, or a branch after its
  // origin (chatTitle).
  title: string | null;
  // A chat with no character talks to the model as it is.
  character: string | null;
  models: Assignment;
  // Each absent follows the default.
  prompt?: string;
  persona?: string;
  note?: string;
  // Named as it was then so a renamed or deleted one still reads.
  origin?: { id: string; name: string; after: string };
  // A branch keeps its original's, so the history it copied reads the same.
  seed?: string;
  memory?: MemorySettings;
  // The variables it starts from, over the card's defaults: a chat brought from Risu keeps Risu's.
  variables?: [string, string][];
  // 등장인물 (design §6.9): characters whose description, lorebook and pictures join the chat's, in the order added, never
  // the chat's own. One gone or in 휴지통 reads as absent.
  cast?: string[];
  // 북마크, by message, in the order marked. One whose message is deleted or on no version's line stays stored and reads
  // as absent (app/chat/bookmarks bookmarkRows), so 되돌리기 of a deletion brings it back.
  bookmarks?: Bookmark[];
};

// name: only one the user gave.
export type Bookmark = { message: string; name?: string };

export const CAST_MAX = 5;

// The raw request is never stored.
export type Receipt = {
  // The call's own id (runtime/streams newCall, pageCall), the same in every copy of the receipt: an edit, a branch's
  // copy and a continued reply keep the receipt whole, so usage counts the call once wherever it is held.
  id: string;
  connection: string;
  // The id of the connection's account that served it; absent on a receipt older than accounts, and on a call picked
  // up after a reload.
  account?: string;
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
  | { kind: 'no-token' }
  | { kind: 'pool'; group: string };

// A version as the reader reads it, beside its text, which is what the model is sent and never this.
// A reply's is translated from its displayed text; a message sent translated keeps here what the user typed, and its
// text is the translation sent. receipt: the call that translated, null when the user wrote it in an edit. sentIn: the
// language a message sent translated went out in, as the English name its prompt read; a reply's translation has none.
export type Translation = { text: string; receipt: Receipt | null; at: number; sentIn?: string };

// Shared by every chat, or a character's own (Character.ownTranslate): replies translates each chat's latest reply, reverse (반전 모드) sends the
// model each version's translation in place of its text. replyLanguage and inputLanguage are what replies and the
// user's messages are translated into, each as the English name the prompt reads. Absent fields are read through
// runtime/characters translateSwitches, the one place that knows their defaults.
export type TranslateSwitches = { replies: boolean; input: boolean; reverse?: boolean; replyLanguage?: string; inputLanguage?: string; prompt?: string };

// Chat entries are created and never changed: an edit, a swipe or a deletion is a new
// entry. at is the writer's clock, for showing times only; order is the server's rev.
// seed: the id a version's random tags roll from in place of its own. A branch's copy keeps its original's, and
// an edit or a continued cut keeps the seed of the version it replaces, so text already shown never rolls again.
// staged: text already past the bot's input or output scripts (a message brought from Risu, one the bot's Lua
// wrote), which never run on it again; an edit of it is the same.
// before: the variables the bot's Lua wrote on the way to this version (when the message was sent, before its reply
// was made), which the chat's replay sets before the version's own text is read. An edit keeps those of the version
// it changes and adds its own.
// reasoning: what the model thought before it wrote the version, as its provider sent it or as Risu kept it. It is
// never part of text, so it is neither drawn in the story nor sent again; 응답 정보 is its one reader.
// greeting: the original card index, not a version's position or a text match. Edits and branches keep it.
export type Entry =
  // A new message with its first version, which has the entry's id. follows: the version of the message it continues,
  // by any id that version stood under, so each version of a message has its own continuation (ChatFold); null for
  // the first message of its line. Absent on a message saved before 2026-10-11, which continues the message before it in
  // rev order, through every version of that message saved before it.
  | { type: 'message'; role: 'user' | 'assistant'; at: number; text: string; receipt: Receipt | null; follows?: string | null; seed?: string; translation?: Translation; staged?: true; before?: Writes; reasoning?: string; greeting?: number }
  // replaces: the version this one takes the place of, for an edit, a retried failure or a continued cut
  // (이어 쓰기), so the count of versions does not grow; null for a new version, which goes last. An edit keeps
  // the receipt of the reply it changes.
  | { type: 'version'; message: string; replaces: string | null; edit: boolean; at: number; text: string; receipt: Receipt | null; seed?: string; translation?: Translation; staged?: true; before?: Writes; reasoning?: string; greeting?: number }
  | { type: 'select'; message: string; version: string; at: number }
  | { type: 'delete'; message: string; at: number }
  | { type: 'restore'; message: string; at: number }
  // A cost the provider booked after the reply, for every receipt with this replyId, those a continued reply
  // carries and translations' included.
  | { type: 'cost'; replyId: string; cost: Cost | null; at: number }
  // A translation made after the version was saved; the latest one for a version is its translation.
  | ({ type: 'translation'; version: string } & Translation)
  // The variables the bot's Lua wrote once the version stood, which the replay sets after the version's own text is
  // read. What the reply's end wrote follows the version into its edits and no further: a retried, continued or new
  // reply runs the bot's Lua again. stays: what a button wrote is the user's own act at that place in the story, so
  // it stays with the message whichever version is shown, and moves to the message before when its own is deleted.
  | { type: 'vars'; version: string; set: Writes; at: number; stays?: true }
  // A model call the bot's Lua made (LLM, axLLM) while version was the last one shown, kept so usage and cost count
  // it. It follows the version as vars does.
  | { type: 'call'; version: string; receipt: Receipt; at: number };

// Variable writes in the order made; a later one of a name wins.
export type Writes = [string, string][];

export type Version = { id: string; seed: string; text: string; receipt: Receipt | null; edited: boolean; at: number; translation?: Translation; staged?: true; before?: Writes; after?: Writes; calls?: BotCall[]; reasoning?: string; greeting?: number };
export type BotCall = { receipt: Receipt; at: number };
// after: the writes that stay with the message (Entry vars), set after its shown version's own.
export type Message = { id: string; role: 'user' | 'assistant'; at: number; versions: Version[]; selected: number; after?: Writes };

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
  ...(entry.reasoning && { reasoning: entry.reasoning }),
  ...(entry.greeting !== undefined && { greeting: entry.greeting }),
});

type Order = { rev: number; pending?: number };

// Entries naming a message or version that is not there yet are skipped, even if it appears later in the replay.
// places: every id a version stood under, by its slot. founded: by message, the order of the entry that made each slot,
// never of an edit or retry that replaced it.
function replay(entries: Stored<'entry'>[]): { messages: Message[]; deleted: Set<string>; places: Map<string, number>; founded: Map<string, Order[]> } {
  const messages = new Map<string, Message>();
  const deleted = new Set<string>();
  // By a version's own id only: a translation of a replaced version is not its replacement's.
  const own = new Map<string, Version>();
  // A place never moves, so a replaced version's id keeps leading to whichever version stands there now, however many
  // times it was replaced since.
  const places = new Map<string, number>();
  const edits = new Map<string, Version>();
  const ids = new Map<Version, string[]>();
  const home = new Map<Version, Message>();
  const stand = (id: string, version: Version, earlier: string[] = []) => {
    ids.set(version, [...earlier, id]);
    for (const each of ids.get(version)!) edits.set(each, version);
  };
  const costs = new Map<string, Cost | null>();
  const founded = new Map<string, Order[]>();
  const locate = (message: Message, id: string) => {
    const version = own.get(id);
    return version && home.get(version) === message ? places.get(id)! : -1;
  };

  for (const { id, value: entry, rev, pending } of [...entries].sort(entryOrder)) {
    if (entry.type === 'message') {
      const version = versionOf(id, entry, false, entry.staged === true);
      own.set(id, version);
      places.set(id, 0);
      founded.set(id, [{ rev, pending }]);
      stand(id, version);
      const message: Message = { id, role: entry.role, at: entry.at, versions: [version], selected: 0 };
      messages.set(id, message);
      home.set(version, message);
      continue;
    }
    if (entry.type === 'vars') {
      const version = edits.get(entry.version);
      const holder = entry.stays ? version && home.get(version) : version;
      if (holder) holder.after = [...(holder.after ?? []), ...entry.set];
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
        if (edited.reasoning) version.reasoning = edited.reasoning;
      }
      own.set(id, version);
      home.set(version, message);
      stand(id, version, edited && ids.get(edited));
      if (slot === -1) {
        message.versions.push(version);
        founded.get(message.id)!.push({ rev, pending });
      } else message.versions[slot] = version;
      message.selected = slot === -1 ? message.versions.length - 1 : slot;
      places.set(id, message.selected);
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
  return { deleted, places, founded, messages: [...messages.values()]
    .map((message) => ({
      ...message,
      versions: message.versions.map((version) => {
        const receipt = version.receipt && settled(version.receipt);
        const translated = version.translation?.receipt && settled(version.translation.receipt);
        const made = version.calls?.map((call) => ({ ...call, receipt: settled(call.receipt) }));
        if (receipt === version.receipt && translated === version.translation?.receipt && !made?.some((call, index) => call.receipt !== version.calls![index]!.receipt)) return version;
        return { ...version, receipt, ...(version.translation && { translation: { ...version.translation, receipt: translated ?? null } }), ...(made && { calls: made }) };
      }),
    })) };
}

type EntryIndex = { group: string | null; reference?: string; cost?: string; rev: number; pending?: number; at: number };
type FoldedMessage = { entries: Set<string>; costs: Set<string>; message: Message | null; deleted: boolean; places: Map<string, number>; founded: Order[]; follows: string | null | undefined };
// slot: the one of from's versions it continues; null for a message saved before follows (Entry).
type Edge = { group: FoldedMessage; slot: number | null };
export const entryOrder = (a: { rev: number; pending?: number }, b: { rev: number; pending?: number }) => (a.pending ?? 0) - (b.pending ?? 0) || a.rev - b.rev;

// Only indexes and the projection live here. Values, including pending writes, are always read from the store.
export class ChatFold {
  private readonly dirty = new Set<string>();
  private readonly entries = new Map<string, EntryIndex>();
  private readonly references = new Map<string, Set<string>>();
  private readonly costs = new Map<string, Set<string>>();
  private readonly costUsers = new Map<string, Set<string>>();
  private readonly groups = new Map<string, FoldedMessage>();
  private result: { messages: Message[]; at: number | null } = { messages: [], at: null };

  constructor(private readonly read: (id: string) => Stored<'entry'> | null) {}

  changed(id: string) { this.dirty.add(id); }

  snapshot(): { messages: Message[]; at: number | null } {
    if (!this.dirty.size) return this.result;
    const touched = new Set<string>();
    const costs = new Set<string>();
    const ids = new Set(this.dirty);
    this.dirty.clear();
    for (const id of ids) for (const reference of this.references.get(id) ?? []) ids.add(reference);
    for (const id of ids) {
      const old = this.entries.get(id);
      if (old && old.group !== null) {
        this.groups.get(old.group)!.entries.delete(id);
        touched.add(old.group);
      }
      if (old?.reference) this.remove(this.references, old.reference, id);
      if (old?.cost) { this.remove(this.costs, old.cost, id); costs.add(old.cost); }
      const stored = this.read(id);
      if (!stored) { this.entries.delete(id); continue; }
      const { value, rev, pending } = stored;
      const reference = 'version' in value && !('message' in value) ? value.version : undefined;
      const target = reference ? this.read(reference)?.value : undefined;
      const group = value.type === 'message' ? id : 'message' in value ? value.message
        : target?.type === 'message' ? reference! : target?.type === 'version' ? target.message : null;
      const cost = value.type === 'cost' ? value.replyId : undefined;
      this.entries.set(id, { group, reference, cost, rev, pending, at: value.at });
      if (reference) this.add(this.references, reference, id);
      if (cost) { this.add(this.costs, cost, id); costs.add(cost); }
      if (group !== null) {
        let held = this.groups.get(group);
        if (!held) this.groups.set(group, (held = { entries: new Set(), costs: new Set(), message: null, deleted: false, places: new Map(), founded: [], follows: undefined }));
        held.entries.add(id);
        touched.add(group);
      }
    }
    for (const cost of costs) for (const group of this.costUsers.get(cost) ?? []) touched.add(group);
    for (const id of touched) {
      const group = this.groups.get(id)!;
      for (const cost of group.costs) this.remove(this.costUsers, cost, id);
      group.costs.clear();
      const entries = [...group.entries].map((entry) => this.read(entry)!);
      const receipt = (value: Receipt | null) => {
        for (let current = value; current; current = current.continues ?? null) {
          if (current.replyId) group.costs.add(current.replyId);
        }
      };
      for (const { value } of entries) {
        if ('receipt' in value) receipt(value.receipt);
        if ('translation' in value && value.translation) receipt(value.translation.receipt);
      }
      for (const cost of group.costs) {
        this.add(this.costUsers, cost, id);
        for (const entry of this.costs.get(cost) ?? []) entries.push(this.read(entry)!);
      }
      const folded = replay(entries);
      group.message = folded.messages[0] ?? null;
      group.deleted = folded.deleted.has(id);
      group.places = folded.places;
      group.founded = folded.founded.get(id) ?? [];
      const head = entries.find((entry) => entry.id === id)?.value;
      group.follows = head?.type === 'message' ? head.follows : undefined;
      if (!group.entries.size) this.groups.delete(id);
    }
    const messages: Message[] = [];
    for (const { group } of this.walk(false)) {
      const message = group.message!;
      if (!group.deleted) messages.push(message);
      else if (messages.length && message.after) {
        const last = messages.at(-1)!;
        messages[messages.length - 1] = { ...last, after: [...(last.after ?? []), ...message.after] };
      }
    }
    let latest: EntryIndex | null = null;
    for (const entry of this.entries.values()) if (!latest || entry.rev >= latest.rev) latest = entry;
    this.result = { messages, at: latest?.at ?? null };
    return this.result;
  }

  // Every message a version switch can show, not only those shown, each with the version it continues: the nearest
  // one shown above it, past deleted messages. A deleted message is passed through its selected version only, as the
  // story shows it.
  tree(): { message: Message; follows: string | null }[] {
    this.snapshot();
    const out: { message: Message; follows: string | null }[] = [];
    const held = new Map<string, number>();
    for (const { group, follows } of this.walk(true)) {
      const message = group.message!;
      if (!group.deleted) {
        for (const { id } of message.versions) held.set(id, out.length);
        out.push({ message, follows });
        continue;
      }
      const at = follows === null ? undefined : held.get(follows);
      if (at === undefined || !message.after) continue;
      const kept = out[at]!;
      out[at] = { ...kept, message: { ...kept.message, after: [...(kept.message.after ?? []), ...message.after] } };
    }
    return out;
  }

  // The story in the order it reads: from each first message, down the version each message shows (every: down all
  // of them), a message's continuations in rev order one after another, so two saved after the same version both show.
  // Iterative, since a chat may run to thousands of messages.
  private walk(every: boolean): { group: FoldedMessage; follows: string | null }[] {
    const ordered = [...this.groups.values()].filter((group) => group.message !== null)
      .sort((a, b) => entryOrder(this.entries.get(a.message!.id)!, this.entries.get(b.message!.id)!));
    // A message continues only one saved before it, so a follows naming a later or unknown version starts a line of its
    // own and no line loops.
    const owner = new Map<string, FoldedMessage>();
    const edges = new Map<FoldedMessage, Edge[]>();
    const roots: FoldedMessage[] = [];
    let previous: FoldedMessage | undefined;
    for (const group of ordered) {
      const parent = group.follows === undefined ? previous : group.follows === null ? undefined : owner.get(group.follows);
      if (!parent) roots.push(group);
      else {
        const edge = { group, slot: group.follows ? parent.places.get(group.follows)! : null };
        const held = edges.get(parent);
        if (held) held.push(edge);
        else edges.set(parent, [edge]);
      }
      for (const id of group.places.keys()) owner.set(id, group);
      previous = group;
    }
    const out: { group: FoldedMessage; follows: string | null }[] = [];
    const stack: { group: FoldedMessage; follows: string | null }[] = roots.map((group) => ({ group, follows: null })).reverse();
    while (stack.length) {
      const next = stack.pop()!;
      out.push(next);
      const { group } = next;
      const { versions, selected } = group.message!;
      const kids = (edges.get(group) ?? []).flatMap(({ group: kid, slot }) => {
        const order = this.entries.get(kid.message!.id)!;
        const before = (index: number) => entryOrder(group.founded[index]!, order) < 0;
        const continued = slot ?? (before(selected) ? selected : group.founded.findLastIndex((_, index) => before(index)));
        if (continued !== selected && (!every || group.deleted)) return [];
        return [{ group: kid, follows: group.deleted ? next.follows : versions[continued]!.id }];
      });
      stack.push(...kids.reverse());
    }
    return out;
  }

  private add(index: Map<string, Set<string>>, key: string, id: string) {
    const ids = index.get(key);
    if (ids) ids.add(id);
    else index.set(key, new Set([id]));
  }

  private remove(index: Map<string, Set<string>>, key: string, id: string) {
    const ids = index.get(key)!;
    ids.delete(id);
    if (!ids.size) index.delete(key);
  }
}

function folded(entries: Stored<'entry'>[]): ChatFold {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const projection = new ChatFold((id) => byId.get(id) ?? null);
  for (const id of byId.keys()) projection.changed(id);
  return projection;
}

export const fold = (entries: Stored<'entry'>[]): Message[] => folded(entries).snapshot().messages;

export const foldTree = (entries: Stored<'entry'>[]) => folded(entries).tree();

export const shown = (message: Message): Version => message.versions[message.selected]!;

export const calls = (receipt: Receipt): Receipt[] => [...(receipt.continues ? calls(receipt.continues) : []), receipt];

const lines = (text: string) =>
  text
    .replace(/<[^>]*>/g, ' ')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');

export const firstLine = (text: string) => lines(text)[0] ?? '';

const prose = (line: string) => !line.startsWith('#') && /\p{L}{2}/u.test(line.replace(/\[[^\]]*\]|\([^)]*\)|【[^】]*】/g, ''));

// Many bots open every reply with the same status line, which tells one chat from the next no better than a blank.
export function previewLine(text: string): string {
  const all = lines(text);
  return all.find(prose) ?? all[0] ?? '';
}

// texts: each message's text as it is displayed (engine/render, which the model cannot call).
export function chatTitle(chat: Chat, messages: Message[], texts: string[]): string {
  if (chat.title) return chat.title;
  if (chat.origin) return `${chat.origin.name} · 분기`;
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
  // The chat's bot judged stuck (runtime ChatProjections.verdict), on the reads that stand for it; absent when never.
  stuck?: { dependencies: SummaryRead[] };
};
export type RecentModel = { at: number; ref: ModelRef };

// Each branch right under the chat it came from, in the order given at each level.
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
// costs: one per unit, never summed together; estimated once any part came from a price list.
export type ModelUsage = { calls: number; last: number | null; input: Tally; output: Tally; costs: { unit: Cost['unit']; amount: number; estimated: boolean }[]; costUnknown: number };

// modelName and source: the names when the call was made, for a model or connection renamed or deleted since.
export type UsageCall = { at: number; call: Pick<Receipt, 'id' | 'connection' | 'model' | 'modelName' | 'source' | 'usage' | 'cost'> };

export const usageCall = ({ id, connection, model, modelName, source, usage, cost }: Receipt, at: number): UsageCall => ({ at, call: { id, connection, model, modelName, source, usage, cost } });

export function* usageCalls(messages: Iterable<Message>): Generator<UsageCall> {
  for (const message of messages) {
    for (const { at, receipt, translation, calls: bot = [] } of message.versions) {
      if (receipt) for (const call of calls(receipt)) yield usageCall(call, at);
      if (translation?.receipt) yield usageCall(translation.receipt, translation.at);
      for (const { receipt, at } of bot) yield usageCall(receipt, at);
    }
  }
}

// The calls one place holds: a chat, with its character and whether it is a branch, or a pack's 삽화 profile, which no
// chat holds.
export type UsageHeld = { calls: Iterable<UsageCall>; chat?: string; character?: string | null; branch?: boolean };

type Once<H> = { one: UsageCall; from: H };

// Every call once, by its id, however many places hold it, since a branch copies the replies it holds with their
// receipts. The cost is read from whichever copy has settled it, as the original settles later than a copy made after,
// and the call is the first holder's that is not a branch, where it was made.
function callsOnce<H extends UsageHeld>(held: Iterable<H>): Once<H>[] {
  const once = new Map<string, Once<H>>();
  const settled = ({ call }: UsageCall) => (call.cost === 'pending' ? null : call.cost);
  for (const from of held) {
    for (const one of from.calls) {
      const seen = once.get(one.call.id);
      if (!seen) {
        once.set(one.call.id, { one, from });
        continue;
      }
      const cost = settled(one);
      const previous = settled(seen.one);
      if (cost && (!previous || (previous.source === 'price-list' && cost.source === 'reported'))) seen.one = { at: seen.one.at, call: { ...seen.one.call, cost } };
      if (seen.from.branch && !from.branch) seen.from = from;
    }
  }
  return [...once.values()];
}

function sum(made: Iterable<UsageCall>): ModelUsage {
  const usage: ModelUsage = { calls: 0, last: null, input: { total: 0, unknown: 0 }, output: { total: 0, unknown: 0 }, costs: [], costUnknown: 0 };
  const add = (tally: Tally, value: number | null) => (value === null ? tally.unknown++ : (tally.total += value));
  for (const { at, call } of made) {
    usage.calls++;
    usage.last = Math.max(usage.last ?? 0, at);
    add(usage.input, call.usage?.inputTokens ?? null);
    add(usage.output, call.usage?.outputTokens ?? null);
    const cost = call.cost === 'pending' ? null : call.cost;
    if (!cost) {
      usage.costUnknown++;
      continue;
    }
    const kept = usage.costs.find((entry) => entry.unit === cost.unit);
    if (kept) {
      kept.amount += cost.amount;
      kept.estimated ||= cost.source === 'price-list';
    } else usage.costs.push({ unit: cost.unit, amount: cost.amount, estimated: cost.source === 'price-list' });
  }
  return usage;
}

export const modelUsage = (held: Iterable<UsageHeld>, { connection, model }: ModelRef) =>
  sum(callsOnce(held).flatMap(({ one }) => (one.call.connection === connection && one.call.model === model ? [one] : [])));

export type UsageWindow = 'hour' | 'today' | 'week' | 'month';

// In local time: today from midnight, the week from Monday's midnight, the month from its first day's.
export function windowStart(window: UsageWindow, now: number): number {
  if (window === 'hour') return now - 3_600_000;
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  if (window === 'week') start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  if (window === 'month') start.setDate(1);
  return start.getTime();
}

export function connectionUsage(held: Iterable<UsageHeld>, connection: string, now: number): Record<'hour' | 'today' | 'week', ModelUsage> {
  const made = callsOnce(held).flatMap(({ one }) => (one.call.connection === connection ? [one] : []));
  const since = (window: UsageWindow) => sum(made.filter(({ at }) => at >= windowStart(window, now)));
  return { hour: since('hour'), today: since('today'), week: since('week') };
}

export type UsageGroup<K> = { key: K; usage: ModelUsage };
export type ModelGroup = UsageGroup<string> & Pick<UsageCall['call'], 'connection' | 'model' | 'modelName' | 'source'>;
export type ReportWindow = Exclude<UsageWindow, 'hour'> | 'all';

// periods: oldest first, every day of the window to its last, days to come too, or over all time every month from the
// first call's to this one, keyed by its local start, an empty one too. The other axes busiest first. A call no chat holds (a 삽화 profile's) counts under its
// character and in no chat.
export type UsageReport = { total: ModelUsage; periods: UsageGroup<number>[]; models: ModelGroup[]; characters: UsageGroup<string | null>[]; chats: UsageGroup<string>[] };

export function usageReport(held: Iterable<UsageHeld>, window: ReportWindow, now: number): UsageReport {
  const since = window === 'all' ? null : windowStart(window, now);
  const counted = callsOnce(held).filter(({ one }) => since === null || one.at >= since);
  const group = <K>(keyOf: (once: Once<UsageHeld>) => K | undefined): UsageGroup<K>[] => {
    const groups = new Map<K, UsageCall[]>();
    for (const once of counted) {
      const key = keyOf(once);
      if (key === undefined) continue;
      const calls = groups.get(key);
      if (calls) calls.push(once.one);
      else groups.set(key, [once.one]);
    }
    return [...groups].map(([key, calls]) => ({ key, usage: sum(calls) })).sort((a, b) => b.usage.calls - a.usage.calls);
  };
  const monthly = window === 'all';
  const startOf = (at: number) => {
    const start = new Date(at);
    start.setHours(0, 0, 0, 0);
    if (monthly) start.setDate(1);
    return start.getTime();
  };
  const made = new Map(group(({ one }) => startOf(one.at)).map(({ key, usage }) => [key, usage]));
  const periods: UsageGroup<number>[] = [];
  const first = since ?? Math.min(now, ...made.keys());
  const last = new Date(startOf(now));
  if (window === 'week') last.setDate(last.getDate() + 6 - ((last.getDay() + 6) % 7));
  if (window === 'month') last.setMonth(last.getMonth() + 1, 0);
  for (const day = new Date(startOf(first)); day <= last; monthly ? day.setMonth(day.getMonth() + 1) : day.setDate(day.getDate() + 1)) {
    periods.push({ key: day.getTime(), usage: made.get(day.getTime()) ?? sum([]) });
  }
  // The names a model's latest call was made under.
  const named = new Map<string, UsageCall>();
  const modelKey = ({ call }: UsageCall) => `${call.connection}\n${call.model}`;
  for (const { one } of counted) if ((named.get(modelKey(one))?.at ?? -Infinity) <= one.at) named.set(modelKey(one), one);
  return {
    total: sum(counted.map(({ one }) => one)),
    periods,
    models: group(({ one }) => modelKey(one)).map((entry) => {
      const { connection, model, modelName, source } = named.get(entry.key)!.call;
      return { ...entry, connection, model, modelName, source };
    }),
    characters: group(({ from }) => from.character ?? null),
    chats: group(({ from }) => from.chat),
  };
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
