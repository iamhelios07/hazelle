import type { Connection } from '../connectors/types';
import type { Chat, Entry, Summary } from './chat';
import type { Asset, Avatar, Character, Folder, Lore, Module } from './library';
import type { Memory } from './memory';
import type { Persona } from './persona';
import type { Profile } from './profile';
import type { Prompt } from './prompt';
import { SETTINGS_ID, type Settings } from './settings';
import type { Stream } from './stream';

export type Values = {
  character: Character;
  module: Module;
  folder: Folder;
  lore: Lore;
  avatar: Avatar;
  asset: Asset;
  chat: Chat;
  entry: Entry;
  summary: Summary;
  stream: Stream;
  memory: Memory;
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
  folder: { parent: null },
  lore: { parent: ['character', 'module'] },
  avatar: { parent: 'character', file: true },
  asset: { parent: ['character', 'module'], file: true },
  chat: { parent: null, owner: { field: 'character', kind: 'character' } },
  entry: { parent: 'chat', appendOnly: true },
  summary: { parent: 'chat' },
  stream: { parent: 'chat' },
  memory: { parent: 'chat' },
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

const prompt = shape({ name: str, blocks: listOf(shape({ id: str, kind: str })), toggles: listOf(shape({ key: str, label: str, kind: str })) });
const conversation = shape({ task: (value) => value === undefined, authorNote: str, models: isRecord });
const task = shape({ task: (value) => value === 'translate' || value === 'memory', model: (value) => value === undefined || isRecord(value) });

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
  asset: shape({ name: str, type: str, size: num, file: shape({ id: str, key: str }) }),
  chat: shape({ title: orNull(str), character: orNull(str), models: isRecord }),
  entry: (value) => isRecord(value) && typeof value.type === 'string' && Object.hasOwn(ENTRIES, value.type) && ENTRIES[value.type as Entry['type']](value),
  summary: shape({ version: num, head: num, chatRev: num, dependencies: listOf(isRecord), rendered: shape({ now: num, timeZone: str }), character: orNull(str), title: str, preview: str, count: num, at: orNull(num), order: num, recent: listOf(isRecord) }),
  stream: shape({ key: isRecord, call: shape(all(str, 'connection', 'source', 'model', 'modelName')), at: num, result: str, for: shape({ kind: str }) }),
  memory: shape({ records: listOf(shape({ id: str, sources: listOf(isRecord), print: str, what: str, state: listOf(isRecord), opens: listOf(str), closes: listOf(str) })), state: listOf(shape(all(str, 'about', 'field', 'value'))), threads: listOf(shape({ id: str, text: str })) }),
  connection: shape({
    type: str,
    label: str,
    baseUrl: orNull(str),
    protocol: orNull(str),
    accounts: listOf(shape({ id: str, secret: str })),
    turns: orNull(shape({ day: num, groups: listOf(shape({ id: str, name: str, accounts: listOf(str) })), anchor: shape({ group: str, cycle: num }) })),
    starred: listOf(shape({ id: str, name: str })),
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
