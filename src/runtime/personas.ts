import type { Chat } from '../model/chat';
import type { Stored } from '../model/kinds';
import { live } from '../model/library';
import type { Persona } from '../model/persona';
import { EMPTY_SETTINGS, SETTINGS_ID } from '../model/settings';
import type { ApiResult } from './api';
import { markDeleted } from './removal';
import { without } from '../model/fields';
import type { ObjectStore, Write } from './store';

// Fixed, so two devices adding the first persona at once meet in a version conflict instead of making two.
export const FIRST_ID = '00000000-0000-4000-8000-000000000002';

// A saved chat holds the persona it was saved with (startChat, the move, recordChatPersonas), and a pick in it changes
// that and the current persona. The 고정 on its character, then the current persona, serve a chat not saved yet.
export type PersonaSource = 'chat' | 'character' | 'current';

// There is no chat without a persona; a deleted one, or a current one not added yet, reads as missing and never as
// another persona, and a turn stops on it.
export type PersonaChoice = { kind: 'persona'; persona: Stored<'persona'>; from: PersonaSource } | { kind: 'missing'; from: PersonaSource };

function followed(store: Pick<ObjectStore, 'get'>, chat: Chat): [PersonaSource, string | undefined] {
  const pinned = chat.character === null ? undefined : store.get('character', chat.character)?.value.persona;
  return chat.persona !== undefined ? ['chat', chat.persona] : pinned !== undefined ? ['character', pinned] : ['current', store.get('settings', SETTINGS_ID)?.value.persona];
}

export function chatPersona(store: Pick<ObjectStore, 'get'>, chat: Chat): PersonaChoice {
  const [from, id] = followed(store, chat);
  const persona = id === undefined ? null : live(store.get('persona', id));
  return persona ? { kind: 'persona', persona, from } : { kind: 'missing', from };
}

// The chat as saved: with the persona it reads now, a missing 고정 included, so it reads the same after a pick elsewhere.
export function withPersona(store: Pick<ObjectStore, 'get'>, chat: Chat): Chat {
  const [, id] = followed(store, chat);
  return id === undefined ? chat : { ...chat, persona: id };
}

// Chats saved before every saved chat held its persona, binned ones too, get the one they read now, once, before a pick
// can change what they read. Written unheld: a chat's rev moving only stales its summary, which its next opening rewrites.
export async function recordChatPersonas(store: ObjectStore): Promise<void> {
  const writes: Write[] = store.list('chat').flatMap(({ id, value }) => {
    if (value.persona !== undefined) return [];
    const recorded = withPersona(store, value);
    return recorded.persona === undefined ? [] : [{ type: 'restore' as const, kind: 'chat' as const, id, parent: null, value: recorded }];
  });
  if (writes.length) await store.batch(writes, undefined, { unheld: true });
}

// null takes the 고정 off.
export const pinPersona = (store: ObjectStore, character: string, persona: string | null) =>
  store.update('character', character, (current) => (persona === null ? without(current, 'persona') : { ...current, persona }));

// An account that has never had a current persona gets one named after its username, once. The session
// awaits it when it opens; a failure is tried again next time.
export async function addFirstPersona(store: ObjectStore, username: string): Promise<void> {
  if (store.get('settings', SETTINGS_ID)?.value.persona !== undefined) return;
  if (!store.get('persona', FIRST_ID)) {
    const saved = await store.create('persona', { name: username, description: '', picture: null }, { id: FIRST_ID });
    if (!saved.ok) return;
  }
  await store.upsert('settings', (current = EMPTY_SETTINGS) => (current.persona === undefined ? { ...current, persona: FIRST_ID } : current));
}

export const addPersona = (store: ObjectStore, persona: Persona, id?: string) => store.create('persona', persona, { id });

export const editPersona = (store: ObjectStore, id: string, patch: Partial<Persona>) => store.update('persona', id, (current) => ({ ...current, ...patch }));

// To 휴지통 (model/library Mark). The current persona goes only once another is picked.
export async function removePersona(store: ObjectStore, id: string): Promise<ApiResult<Stored<'persona'>> | { ok: false; error: 'current' }> {
  if (store.get('settings', SETTINGS_ID)?.value.persona === id) return { ok: false, error: 'current' };
  return markDeleted(store, 'persona', id, Date.now());
}

export const restorePersona = (store: ObjectStore, id: string) => markDeleted(store, 'persona', id, null);

export const setCurrentPersona = (store: ObjectStore, id: string) => store.upsert('settings', (current = EMPTY_SETTINGS) => ({ ...current, persona: id }));
