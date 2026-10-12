import type { Connection } from '../connectors/types';
import type { CachePrint } from './cache';
import type { Chat, Entry, Summary } from './chat';
import type { Asset, Avatar, Character, Folder, Lore, Module } from './library';
import type { Illustration } from './illustration';
import type { Likeness } from './likeness';
import type { Memory, Vectors } from './memory';
import type { Persona } from './persona';
import type { Profile } from './profile';
import type { Prompt } from './prompt';
import { SETTINGS_ID, type Settings } from './settings';
import type { Tool, ToolChatData, ToolData } from './tool';
import type { Stream } from './stream';

export type Values = {
  character: Character;
  module: Module;
  tool: Tool;
  tooldata: ToolData;
  toolchat: ToolChatData;
  folder: Folder;
  lore: Lore;
  avatar: Avatar;
  asset: Asset;
  likeness: Likeness;
  // A chat's own picture, brought from Risu's inlay store: an asset of the chat, never of its card.
  inlay: Asset;
  chat: Chat;
  entry: Entry;
  summary: Summary;
  stream: Stream;
  memory: Memory;
  vectors: Vectors;
  cacheprint: CachePrint;
  illustration: Illustration;
  connection: Connection;
  settings: Settings;
  prompt: Prompt;
  persona: Persona;
  profile: Profile;
};
export type Kind = keyof Values;

// parent: the kind an object's parent must be (one of them, where a list), or null for a top-level object. The
// server sees this link, and an update never changes it. Read it through parentKinds.
// id: the one id a singleton kind lives at. appendOnly: written once, never updated.
// file: the encrypted body names a stored file (`file`, vault/files); backup discovery follows this metadata.
// owner: a body field naming the object that owns this one, for a link the server must not see. The
// parent cannot carry it: it is bound into each object's sealing (vault/objects) and sent in the clear.
export type Rule = { parent: Kind | readonly Kind[] | null; id?: string; appendOnly?: true; file?: true; owner?: { field: string; kind: Kind } };

type Link<K extends Kind> = { [F in keyof Values[K]]-?: Values[K][F] extends string | null ? F : never }[keyof Values[K]];

// The rules runtime/store checks before a write leaves the browser, and the links runtime/removal follows.
export const KINDS = {
  character: { parent: null },
  module: { parent: null },
  tool: { parent: 'module', file: true },
  tooldata: { parent: 'module' },
  toolchat: { parent: 'chat', owner: { field: 'module', kind: 'module' } },
  folder: { parent: null },
  lore: { parent: ['character', 'module'] },
  avatar: { parent: 'character', file: true },
  asset: { parent: ['character', 'module'], file: true },
  likeness: { parent: ['character', 'module', 'persona'] },
  chat: { parent: null, owner: { field: 'character', kind: 'character' } },
  entry: { parent: 'chat', appendOnly: true },
  summary: { parent: 'chat' },
  stream: { parent: 'chat' },
  memory: { parent: 'chat' },
  vectors: { parent: 'chat' },
  cacheprint: { parent: 'chat' },
  illustration: { parent: 'chat', file: true },
  inlay: { parent: 'chat', file: true },
  connection: { parent: null },
  settings: { parent: null, id: SETTINGS_ID },
  prompt: { parent: null },
  persona: { parent: null },
  profile: { parent: null },
} as const satisfies Record<Kind, Rule> & { [K in Kind]: { owner?: { field: Link<K> } } };

export function parentKinds(kind: Kind): readonly Kind[] {
  const { parent }: Rule = KINDS[kind];
  return parent === null ? [] : typeof parent === 'string' ? [parent] : parent;
}

export type Singleton = { [K in Kind]: (typeof KINDS)[K] extends { id: string } ? K : never }[Kind];
export type AppendOnly = { [K in Kind]: (typeof KINDS)[K] extends { appendOnly: true } ? K : never }[Kind];

type Check = (value: unknown) => boolean;
const str: Check = (value) => typeof value === 'string';
const num: Check = (value) => typeof value === 'number';
const bool: Check = (value) => typeof value === 'boolean';
// connectors/values isRecord, which the model may not import (eslint/boundaries.js).
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const orNull = (check: Check): Check => (value) => value === null || check(value);
const listOf = (check: Check): Check => (value) => Array.isArray(value) && value.every(check);
const shape = (fields: Record<string, Check>): Check => (value) => isRecord(value) && Object.entries(fields).every(([key, check]) => check(value[key]));
const all = (check: Check, ...fields: string[]) => Object.fromEntries(fields.map((field) => [field, check]));

const text = { at: num, text: str, receipt: orNull(isRecord) };
const ENTRIES = {
  message: shape({ role: str, ...text }),
  version: shape({ message: str, replaces: orNull(str), edit: bool, ...text }),
  select: shape({ message: str, version: str, at: num }),
  delete: shape({ message: str, at: num }),
  restore: shape({ message: str, at: num }),
  cost: shape({ replyId: str, cost: orNull(isRecord), at: num }),
  translation: shape({ version: str, ...text }),
  vars: shape({ version: str, set: listOf(Array.isArray), at: num }),
  call: shape({ version: str, receipt: isRecord, at: num }),
} satisfies Record<Entry['type'], Check>;

const picture = shape({ name: str, type: str, size: num, file: shape({ id: str, key: str }) });
const toggle = shape({ key: str, label: str, kind: str });
const mark = shape({ label: str });
// A layout line has no key (model/prompt ToggleMark).
const toggleLine: Check = (value) => isRecord(value) && (value.kind === 'groupEnd' || (value.kind === 'divider' || value.kind === 'caption' || value.kind === 'group' ? mark : toggle)(value));
const prompt = shape({ name: str, blocks: listOf(shape({ id: str, kind: str })), toggles: listOf(toggleLine) });
const conversation = shape({ task: (value) => value === undefined, authorNote: str, models: isRecord });
const task = shape({ task: (value) => value === 'translate' || value === 'memory' || value === 'illustrate', model: (value) => value === undefined || isRecord(value) });

const SHAPES = {
  character: shape({
    card: shape({
      ...all(str, 'name', 'description', 'personality', 'scenario', 'exampleDialogue', 'systemPrompt', 'postHistoryInstructions'),
      ...all(str, 'creatorNotes', 'creator', 'version', 'toggles'),
      nickname: orNull(str),
      greetings: listOf(str),
      tags: listOf(str),
      variables: listOf(Array.isArray),
      bias: listOf(Array.isArray),
      regex: listOf(shape({ id: str })),
      triggers: listOf(shape({ id: str, kind: str, name: str })),
      utility: bool,
      loreSettings: isRecord,
    }),
    folder: orNull(str),
    loreFolders: listOf(shape({ id: str, name: str })),
  }),
  module: shape({ name: str, description: str, namespace: orNull(str), regex: listOf(shape({ id: str })), triggers: listOf(shape({ id: str, kind: str, name: str })), toggles: str, loreFolders: listOf(shape({ id: str, name: str })) }),
  tool: shape({ manifest: shape({ api: (value) => value === 1, ...all(str, 'name', 'author', 'displayName', 'version', 'description'), uses: listOf((value) => value === 'model' || value === 'embed' || value === 'memory'), page: orNull(shape({ label: str })), menu: listOf(shape({ id: str, label: str })), settings: listOf(shape({ key: str, type: str, label: str })) }), file: shape({ id: str, key: str }), size: num, settings: isRecord }),
  tooldata: shape({ key: str, value: (value) => value !== undefined }),
  toolchat: shape({ module: str, key: orNull(str), value: (value) => value !== undefined }),
  folder: shape({ name: str }),
  lore: shape({
    ...all(bool, 'enabled', 'constant', 'selective', 'useRegex', 'caseSensitive'),
    name: str,
    keys: listOf(str),
    secondaryKeys: listOf(str),
    content: str,
    insertionOrder: num,
    priority: orNull(num),
    position: orNull(str),
    folder: orNull(str),
  }),
  avatar: shape({ type: str, size: num, thumb: str, file: shape({ id: str, key: str }) }),
  asset: picture,
  likeness: shape({ portraits: listOf(shape({ ...all(str, 'name', 'look', 'artist', 'source'), aliases: listOf(str), outfits: listOf(shape(all(str, 'name', 'tags'))) })), at: num, receipt: orNull(isRecord) }),
  inlay: picture,
  chat: shape({ title: orNull(str), character: orNull(str), models: isRecord, bookmarks: (value) => value === undefined || listOf(shape({ message: str }))(value) }),
  entry: (value) => isRecord(value) && typeof value.type === 'string' && Object.hasOwn(ENTRIES, value.type) && ENTRIES[value.type as Entry['type']](value),
  summary: shape({ version: num, head: num, chatRev: num, dependencies: listOf(isRecord), rendered: shape({ now: num, timeZone: str }), character: orNull(str), title: str, preview: str, count: num, at: orNull(num), order: num, recent: listOf(isRecord) , stuck: (value) => value === undefined || shape({ dependencies: listOf(isRecord) })(value) }),
  // A batch's marker holds no key: no server object holds its call.
  stream: (value) => shape({ call: shape(all(str, 'connection', 'source', 'model', 'modelName')), at: num, result: str, for: shape({ kind: str }) })(value) && (shape({ key: isRecord })(value) || shape({ batch: str })(value)),
  vectors: shape({ model: str, items: isRecord }),
  cacheprint: shape({ ...all(str, 'call', 'connection', 'model'), account: orNull(str), messages: listOf(shape({ role: str, hash: str, tokens: num, from: isRecord })) }),
  memory: shape({ records: listOf(shape({ id: str, sources: listOf(isRecord), print: str, what: str, state: listOf(isRecord), opens: listOf(str), closes: listOf(str) })), chapters: listOf(shape({ id: str, sources: listOf(isRecord), print: str, what: str, records: listOf(shape({ id: str, at: num })) })), state: listOf(shape(all(str, 'about', 'field', 'value'))), threads: listOf(shape({ id: str, text: str })) }),
  illustration: shape({
    ...all(str, 'message', 'version', 'type'),
    scene: shape({ paragraph: num, shape: str, setting: str, framing: str, characters: listOf(shape({ ...all(str, 'name', 'look', 'outfit', 'action'), x: num, y: num })) }),
    receipt: orNull(isRecord),
    model: shape(all(str, 'connection', 'model')),
    sent: shape({ prompt: str, negative: str, characters: listOf(shape({ prompt: str, negative: str, center: shape(all(num, 'x', 'y')) })), ...all(num, 'width', 'height', 'seed') }),
    file: shape({ id: str, key: str }),
    size: num,
    at: num,
  }),
  connection: shape({
    type: str,
    label: str,
    baseUrl: orNull(str),
    protocol: orNull(str),
    accounts: listOf(shape({ id: str, secret: str })),
    turns: orNull(shape({ day: num, groups: listOf(shape({ id: str, name: str, accounts: listOf(str) })), anchor: shape({ group: str, cycle: num }) })),
    starred: listOf(shape({ id: str, name: str })),
    retries: (value) => value === undefined || num(value),
  }),
  settings: shape({ models: isRecord }),
  prompt: (value) => prompt(value) && (conversation(value) || task(value)),
  persona: shape({ name: str, description: str, picture: orNull(str) }),
  profile: shape({ name: str, settings: isRecord }),
} satisfies Record<Kind, Check>;

export const isValue = <K extends Kind>(kind: K, value: unknown): value is Values[K] => SHAPES[kind](value);

// pending: a write this tab sent and the server has not answered, numbered in the order sent (ObjectStore overlays);
// its rev is then the confirmed one it replaces, 0 for a create, never a rev of its own.
export type Stored<K extends Kind> = { id: string; kind: K; parent: string | null; rev: number; value: Values[K]; pending?: number };
