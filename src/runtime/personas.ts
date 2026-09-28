import type { Chat } from '../model/chat';
import type { Stored } from '../model/kinds';
import type { Persona } from '../model/persona';
import { SETTINGS_ID } from '../model/settings';
import type { ApiResult } from './api';
import type { ObjectStore } from './store';

// Who the user plays in a chat: its own persona, else the default, else none, and then {{user}} is the
// account's username (design §4.3). A deleted one reads as missing, never as another persona or none.
export type PersonaChoice = { kind: 'persona'; persona: Stored<'persona'>; own: boolean } | { kind: 'none' } | { kind: 'missing'; own: boolean };

export function chatPersona(store: ObjectStore, chat: Chat): PersonaChoice {
  const own = chat.persona !== undefined;
  const id = chat.persona ?? store.get('settings', SETTINGS_ID)?.value.persona;
  if (id === undefined) return { kind: 'none' };
  const persona = store.get('persona', id);
  return persona ? { kind: 'persona', persona, own } : { kind: 'missing', own };
}

export const addPersona = (store: ObjectStore, persona: Persona) => store.create('persona', persona);

export const editPersona = (store: ObjectStore, id: string, patch: Partial<Persona>) => store.update('persona', id, (current) => ({ ...current, ...patch }));

// As with prompts (design §4.2), the default goes only once another persona, or none, is the default.
export async function removePersona(store: ObjectStore, id: string): Promise<ApiResult<Stored<'persona'>> | { ok: false; error: 'default' }> {
  if (store.get('settings', SETTINGS_ID)?.value.persona === id) return { ok: false, error: 'default' };
  const persona = store.get('persona', id);
  if (!persona) return { ok: false, error: 'gone' };
  const removed = await store.remove(id);
  return removed.ok ? { ok: true, data: persona } : removed;
}

export const restorePersona = (store: ObjectStore, removed: Stored<'persona'>) => store.restore(removed);

// null: no default persona.
export function setDefaultPersona(store: ObjectStore, id: string | null): Promise<ApiResult<Stored<'settings'>>> {
  return store.upsert('settings', (current) => {
    const next = { models: {}, ...current };
    if (id === null) delete next.persona;
    else next.persona = id;
    return next;
  });
}
