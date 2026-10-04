import { fitsRole } from '../connectors/assignment';
import type { Connection, ConnectionType, Model, Starred } from '../connectors/types';
import type { Stored } from '../model/kinds';
import { SETTINGS_ID } from '../model/settings';
import type { ApiFailure, ApiResult } from './api';
import { setDefaultModel } from './assignment';
import type { CatalogFailure } from './catalog';
import { loadMeters, type MetersFailure } from './meters';
import type { Session } from './session';
import type { ObjectStore } from './store';

export function providerConnection(type: ConnectionType, secret: string, account?: string): Connection {
  return { type: type.id, label: type.label, baseUrl: null, protocol: null, secret, starred: [], ...(account === undefined ? {} : { account }) };
}

// models: the model list did not load. key: the provider refused the key the meters asked with.
// stopped: the caller gave up (signal) before the save.
export type AddFailure =
  | { kind: 'models'; failure: CatalogFailure }
  | { kind: 'key'; failure: MetersFailure }
  | { kind: 'save'; failure: ApiFailure }
  | { kind: 'stopped' };

// The model list must load before the connection is saved. A model list
// may be public (OpenRouter's is), so a key the meters' request is refused with (401) stops the save
// too; any other trouble with the meters leaves them to their own block on the next screen.
// Leaving the screen (signal) while these load saves nothing.
export async function addConnection({ store, catalogs }: Session, connection: Connection, signal?: AbortSignal): Promise<{ ok: true; id: string } | { ok: false; failure: AddFailure }> {
  const [catalog, meters] = await Promise.all([catalogs.load(connection, { fresh: true }), loadMeters(connection, signal)]);
  if (signal?.aborted) return { ok: false, failure: { kind: 'stopped' } };
  if (!catalog.ok) return { ok: false, failure: { kind: 'models', failure: catalog.failure } };
  if (meters && !meters.ok && meters.failure.kind === 'provider' && meters.failure.status === 401) return { ok: false, failure: { kind: 'key', failure: meters.failure } };
  const saved = await store.create('connection', connection);
  return saved.ok ? { ok: true, id: saved.data.id } : { ok: false, failure: { kind: 'save', failure: saved } };
}

// The others are kept apart first, so a star the model got meanwhile on another device is not doubled.
// The first model starred that can talk becomes the 대화 모델: until one is set no chat can send, and with one there is nothing to
// choose between.
export async function setStarred(store: ObjectStore, id: string, model: Model, starred: boolean): Promise<ApiResult<Stored<'connection'>>> {
  const saved = await store.update('connection', id, (current) => {
    const others = current.starred.filter((entry) => entry.id !== model.id);
    return { ...current, starred: starred ? [...others, model] : others };
  });
  if (saved.ok && starred && fitsRole(model, 'main') && !store.get('settings', SETTINGS_ID)?.value.models.main) await setDefaultModel(store, 'main', { connection: id, model: model.id });
  return saved;
}

// A loaded model list brings the starred models' prices up to date. A model it leaves unpriced keeps the price it had:
// a price list that did not load reads the same.
export async function refreshPrices(store: ObjectStore, id: string, models: Model[]): Promise<void> {
  const loaded = new Map(models.flatMap((model) => (model.price ? [[model.id, model.price] as const] : [])));
  const changed = (model: Starred) => loaded.has(model.id) && JSON.stringify(loaded.get(model.id)) !== JSON.stringify(model.price);
  if (!store.get('connection', id)?.value.starred.some(changed)) return;
  await store.update('connection', id, (current) => ({ ...current, starred: current.starred.map((model) => (changed(model) ? { ...model, price: loaded.get(model.id)! } : model)) }));
}

export const removeConnection = (store: ObjectStore, id: string) => store.take('connection', id);

export const restoreConnection = (store: ObjectStore, removed: Stored<'connection'>) => store.restore(removed);
