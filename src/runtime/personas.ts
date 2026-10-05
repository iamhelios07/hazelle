import type { Chat } from '../model/chat';
import type { Stored } from '../model/kinds';
import { live } from '../model/library';
import type { Persona } from '../model/persona';
import { SETTINGS_ID } from '../model/settings';
import type { ApiResult } from './api';
import { markDeleted } from './characters';
import { without, type ObjectStore } from './store';

// Fixed, so two devices adding the first persona at once meet in a version conflict instead of making two.
export const FIRST_ID = '00000000-0000-4000-8000-000000000002';

// from: the chat's own pick, the one 고정 on its character, or the default.
export type PersonaSource = 'chat' | 'character' | 'default';

// There is no chat without a persona; a deleted one, or a default not added yet, reads as missing and never as
// another persona, and a turn stops on it.
export type PersonaChoice = { kind: 'persona'; persona: Stored<'persona'>; from: PersonaSource } | { kind: 'missing'; from: PersonaSource };

export function chatPersona(store: ObjectStore, chat: Chat): PersonaChoice {
  const pinned = chat.character === null ? undefined : store.get('character', chat.character)?.value.persona;
  const [from, id]: [PersonaSource, string | undefined] =
    chat.persona !== undefined ? ['chat', chat.persona] : pinned !== undefined ? ['character', pinned] : ['default', store.get('settings', SETTINGS_ID)?.value.persona];
  const persona = id === undefined ? null : live(store.get('persona', id));
  return persona ? { kind: 'persona', persona, from } : { kind: 'missing', from };
}

// null takes the 고정 off.
export const pinPersona = (store: ObjectStore, character: string, persona: string | null) =>
  store.update('character', character, (current) => (persona === null ? without(current, 'persona') : { ...current, persona }));

// An account that has never had a default persona gets one named after its username, once. The session
// awaits it when it opens; a failure is tried again next time.
export async function addFirstPersona(store: ObjectStore, username: string): Promise<void> {
  if (store.get('settings', SETTINGS_ID)?.value.persona !== undefined) return;
  if (!store.get('persona', FIRST_ID)) {
    const saved = await store.create('persona', { name: username, description: '', picture: null }, { id: FIRST_ID });
    if (!saved.ok) return;
  }
  await store.upsert('settings', (current) => (current?.persona === undefined ? { models: {}, ...current, persona: FIRST_ID } : current));
}

export const addPersona = (store: ObjectStore, persona: Persona, id?: string) => store.create('persona', persona, { id });

export const editPersona = (store: ObjectStore, id: string, patch: Partial<Persona>) => store.update('persona', id, (current) => ({ ...current, ...patch }));

// To 휴지통 (model/library Mark). As with prompts, the default goes only once another persona is the default.
export async function removePersona(store: ObjectStore, id: string): Promise<ApiResult<Stored<'persona'>> | { ok: false; error: 'default' }> {
  if (store.get('settings', SETTINGS_ID)?.value.persona === id) return { ok: false, error: 'default' };
  return markDeleted(store, 'persona', id, Date.now());
}

export const restorePersona = (store: ObjectStore, id: string) => markDeleted(store, 'persona', id, null);

export const setDefaultPersona = (store: ObjectStore, id: string) => store.upsert('settings', (current) => ({ models: {}, ...current, persona: id }));
