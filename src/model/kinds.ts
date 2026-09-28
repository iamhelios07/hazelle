import type { Connection } from '../connectors/types';
import type { Chat, Entry } from './chat';
import type { Avatar, Character, Folder, Lore } from './library';
import { SETTINGS_ID, type Settings } from './settings';

// Every kind of stored object, with the value its sealed body holds (tech-spec §5, Object kinds).
export type Values = {
  character: Character;
  folder: Folder;
  lore: Lore;
  avatar: Avatar;
  chat: Chat;
  entry: Entry;
  connection: Connection;
  settings: Settings;
};
export type Kind = keyof Values;

// parent: the kind an object's parent must be, or null for a top-level object. The server sees this
// link, and an update never changes it (runtime/store, server/objects).
// id: the one id a singleton kind lives at. appendOnly: written once, never updated.
type Rule = { parent: Kind | null; id?: string; appendOnly?: true };

// The rules runtime/store checks before a write leaves the browser.
export const KINDS = {
  character: { parent: null },
  folder: { parent: null },
  lore: { parent: 'character' },
  // Its id is also the id of the sealed blob that holds the original picture (vault/blobs).
  avatar: { parent: 'character' },
  chat: { parent: null },
  entry: { parent: 'chat', appendOnly: true },
  connection: { parent: null },
  settings: { parent: null, id: SETTINGS_ID },
} as const satisfies Record<Kind, Rule>;

export type Singleton = { [K in Kind]: (typeof KINDS)[K] extends { id: string } ? K : never }[Kind];
export type AppendOnly = { [K in Kind]: (typeof KINDS)[K] extends { appendOnly: true } ? K : never }[Kind];

export type Stored<K extends Kind> = { id: string; kind: K; parent: string | null; rev: number; value: Values[K] };
