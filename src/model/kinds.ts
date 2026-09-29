import type { Connection } from '../connectors/types';
import type { Chat, Entry } from './chat';
import type { Avatar, Character, Folder, Lore } from './library';
import type { Persona } from './persona';
import type { Profile } from './profile';
import type { Prompt } from './prompt';
import { SETTINGS_ID, type Settings } from './settings';

// Every kind of stored object, with the value its sealed body holds.
export type Values = {
  character: Character;
  folder: Folder;
  lore: Lore;
  avatar: Avatar;
  chat: Chat;
  entry: Entry;
  connection: Connection;
  settings: Settings;
  prompt: Prompt;
  persona: Persona;
  profile: Profile;
};
export type Kind = keyof Values;

// parent: the kind an object's parent must be, or null for a top-level object. The server sees this
// link, and an update never changes it.
// id: the one id a singleton kind lives at. appendOnly: written once, never updated.
// file: the object's id is also the id of the sealed file it holds.
// owner: a body field naming the object that owns this one, for a link the server must not see. The
// parent cannot carry it: it is bound into each object's sealing (vault/objects) and sent in the clear.
export type Rule = { parent: Kind | null; id?: string; appendOnly?: true; file?: true; owner?: { field: string; kind: Kind } };

// The body fields of a kind that can hold another object's id.
type Link<K extends Kind> = { [F in keyof Values[K]]-?: Values[K][F] extends string | null ? F : never }[keyof Values[K]];

// The rules runtime/store checks before a write leaves the browser, and the links runtime/removal follows.
export const KINDS = {
  character: { parent: null },
  folder: { parent: null },
  lore: { parent: 'character' },
  avatar: { parent: 'character', file: true },
  chat: { parent: null, owner: { field: 'character', kind: 'character' } },
  entry: { parent: 'chat', appendOnly: true },
  connection: { parent: null },
  settings: { parent: null, id: SETTINGS_ID },
  prompt: { parent: null },
  persona: { parent: null },
  profile: { parent: null },
} as const satisfies Record<Kind, Rule> & { [K in Kind]: { owner?: { field: Link<K> } } };

export type Singleton = { [K in Kind]: (typeof KINDS)[K] extends { id: string } ? K : never }[Kind];
export type AppendOnly = { [K in Kind]: (typeof KINDS)[K] extends { appendOnly: true } ? K : never }[Kind];

export type Stored<K extends Kind> = { id: string; kind: K; parent: string | null; rev: number; value: Values[K] };
