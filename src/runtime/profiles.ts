import type { ModelSettings } from '../connectors/settings';
import type { Starred } from '../connectors/types';
import type { Stored } from '../model/kinds';
import type { Profile } from '../model/profile';
import { SETTINGS_ID } from '../model/settings';
import type { ApiResult } from './api';
import type { ObjectStore } from './store';

// Every write of `profile` objects, of the default 묶음, and of the 묶음 a starred model uses (design §4.4).

// Fixed, so two devices adding the first 묶음 at once meet in a version conflict instead of making two.
export const FIRST_PROFILE_ID = '00000000-0000-4000-8000-000000000003';

// The 묶음 a starred model uses: its own, else the default. A deleted one, or a default not added yet, reads as
// missing and never as another 묶음; a turn stops on it, as it does on a missing prompt.
export type ProfileChoice = { kind: 'profile'; profile: Stored<'profile'>; own: boolean } | { kind: 'missing'; own: boolean };

export function modelProfile(store: ObjectStore, model: Starred): ProfileChoice {
  const own = model.profile !== undefined;
  const id = model.profile ?? store.get('settings', SETTINGS_ID)?.value.profile;
  const profile = id === undefined ? null : store.get('profile', id);
  return profile ? { kind: 'profile', profile, own } : { kind: 'missing', own };
}

// The starred models that use a 묶음, its own or as the default, in connection order.
export type ProfileUser = { connection: Stored<'connection'>; model: Starred };
export function profileUsers(connections: readonly Stored<'connection'>[], defaultProfile: string | undefined, id: string): ProfileUser[] {
  return connections.flatMap((connection) => connection.value.starred.filter((model) => (model.profile ?? defaultProfile) === id).map((model) => ({ connection, model })));
}

// An account that has never had a default 묶음 gets an empty one, once. The session awaits it when it opens
// (runtime/session); a failure is tried again next time.
export async function addFirstProfile(store: ObjectStore): Promise<void> {
  if (store.get('settings', SETTINGS_ID)?.value.profile !== undefined) return;
  if (!store.get('profile', FIRST_PROFILE_ID)) {
    const saved = await store.create('profile', { name: '기본', settings: {} }, { id: FIRST_PROFILE_ID });
    if (!saved.ok) return;
  }
  await store.upsert('settings', (current) => (current?.profile === undefined ? { models: {}, ...current, profile: FIRST_PROFILE_ID } : current));
}

// Settings kept on a starred model itself, before 설정 묶음 (2026-09-29), become a 묶음 each, named after the model,
// which that model then uses. The session runs it on every open.
// Delete once the live account has opened with this version: nothing writes the old field any more.
type Kept = Starred & { settings?: ModelSettings };
export async function adoptModelSettings(store: ObjectStore): Promise<void> {
  for (const connection of store.list('connection')) {
    for (const model of connection.value.starred as Kept[]) {
      if (!model.settings) continue;
      const created = await store.create('profile', { name: model.name, settings: model.settings });
      if (!created.ok) return;
      const moved = await store.update('connection', connection.id, (current) => ({
        ...current,
        starred: current.starred.map((entry) => (entry.id === model.id ? without({ ...entry, profile: created.data.id } as Kept, 'settings') : entry)),
      }));
      if (!moved.ok) return;
    }
  }
}

export const addProfile = (store: ObjectStore, profile: Profile) => store.create('profile', profile);

export const renameProfile = (store: ObjectStore, id: string, name: string) => store.update('profile', id, (current) => ({ ...current, name }));

// Each change is merged into the current copy on every try, so a field changed meanwhile on another device survives.
const updateSettings = (store: ObjectStore, id: string, change: (settings: ModelSettings) => ModelSettings) =>
  store.update('profile', id, (current) => ({ ...current, settings: change(current.settings) }));

// A setting given as undefined is cleared: nothing is sent for it (design §4.4).
export const setProfileSettings = (store: ObjectStore, id: string, values: ModelSettings) =>
  updateSettings(store, id, (settings) => {
    const next = { ...settings, ...values };
    for (const key of Object.keys(next) as (keyof ModelSettings)[]) if (next[key] === undefined) delete next[key];
    return next;
  });

export const clearProfileSettings = (store: ObjectStore, id: string) => updateSettings(store, id, () => ({}));

// As with prompts (design §4.2), the default goes only once another 묶음 is the default. A model that used a deleted
// 묶음 reads as missing until it is given another, or the 묶음 comes back with 되돌리기.
export async function removeProfile(store: ObjectStore, id: string): Promise<ApiResult<Stored<'profile'>> | { ok: false; error: 'default' }> {
  if (store.get('settings', SETTINGS_ID)?.value.profile === id) return { ok: false, error: 'default' };
  const profile = store.get('profile', id);
  if (!profile) return { ok: false, error: 'gone' };
  const removed = await store.remove(id);
  return removed.ok ? { ok: true, data: profile } : removed;
}

export const restoreProfile = (store: ObjectStore, removed: Stored<'profile'>) => store.restore(removed);

export const setDefaultProfile = (store: ObjectStore, id: string) => store.upsert('settings', (current) => ({ models: {}, ...current, profile: id }));

// null leaves the model to the default 묶음.
export function setModelProfile(store: ObjectStore, connection: string, model: string, profile: string | null): Promise<ApiResult<Stored<'connection'>>> {
  return store.update('connection', connection, (current) => ({
    ...current,
    starred: current.starred.map((entry) => (entry.id !== model ? entry : profile === null ? without(entry, 'profile') : { ...entry, profile })),
  }));
}

function without<T extends object>(from: T, key: keyof T): T {
  const rest = { ...from };
  delete rest[key];
  return rest;
}
