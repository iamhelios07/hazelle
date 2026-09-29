import type { Chat } from '../model/chat';
import type { Stored } from '../model/kinds';
import type { Persona } from '../model/persona';
import { SETTINGS_ID } from '../model/settings';
import type { ApiResult } from './api';
import type { ObjectStore } from './store';

// Fixed, so two devices adding the first persona at once meet in a version conflict instead of making two.
export const FIRST_ID = '00000000-0000-4000-8000-000000000002';

// Who the user plays in a chat: its own persona, else the default (design §4.3). There is no chat without a
// persona ("페르소나가 없을 순 없지"); a deleted one, or a default not added yet, reads as missing and never as
// another persona, and a turn stops on it.
export type PersonaChoice = { kind: 'persona'; persona: Stored<'persona'>; own: boolean } | { kind: 'missing'; own: boolean };

export function chatPersona(store: ObjectStore, chat: Chat): PersonaChoice {
  const own = chat.persona !== undefined;
  const id = chat.persona ?? store.get('settings', SETTINGS_ID)?.value.persona;
  const persona = id === undefined ? null : store.get('persona', id);
  return persona ? { kind: 'persona', persona, own } : { kind: 'missing', own };
}

// design §4.3: an account that has never had a default persona gets one named after its username, once. The
// session awaits it when it opens (runtime/session); a failure is tried again next time.
export async function addFirstPersona(store: ObjectStore, username: string): Promise<void> {
  if (store.get('settings', SETTINGS_ID)?.value.persona !== undefined) return;
  if (!store.get('persona', FIRST_ID)) {
    const saved = await store.create('persona', { name: username, description: '', picture: null }, { id: FIRST_ID });
    if (!saved.ok) return;
  }
  await store.upsert('settings', (current) => (current?.persona === undefined ? { models: {}, ...current, persona: FIRST_ID } : current));
}

export const addPersona = (store: ObjectStore, persona: Persona) => store.create('persona', persona);

export const editPersona = (store: ObjectStore, id: string, patch: Partial<Persona>) => store.update('persona', id, (current) => ({ ...current, ...patch }));

// As with prompts (design §4.2), the default goes only once another persona is the default.
export async function removePersona(store: ObjectStore, id: string): Promise<ApiResult<Stored<'persona'>> | { ok: false; error: 'default' }> {
  if (store.get('settings', SETTINGS_ID)?.value.persona === id) return { ok: false, error: 'default' };
  const persona = store.get('persona', id);
  if (!persona) return { ok: false, error: 'gone' };
  const removed = await store.remove(id);
  return removed.ok ? { ok: true, data: persona } : removed;
}

export const restorePersona = (store: ObjectStore, removed: Stored<'persona'>) => store.restore(removed);

export const setDefaultPersona = (store: ObjectStore, id: string) => store.upsert('settings', (current) => ({ models: {}, ...current, persona: id }));
