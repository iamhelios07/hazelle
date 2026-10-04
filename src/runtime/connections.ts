import { fitsRole } from '../connectors/assignment';
import type { Connection, ConnectionType, Model } from '../connectors/types';
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

// models: the model list did not load. key: the provider refused the key every meters request asked with.
// stopped: the caller gave up (signal) before the save.
export type AddFailure =
  | { kind: 'models'; failure: CatalogFailure }
  | { kind: 'key'; failure: MetersFailure }
  | { kind: 'save'; failure: ApiFailure }
  | { kind: 'stopped' };

// The model list must load before the connection is saved. A model list
// may be public (OpenRouter's is), so a key every meters request refuses (401) stops the save too. Never one refusal
// alone: what NanoGPT's subscription usage answers a working key without a subscription is undocumented. Any other
// trouble with the meters leaves them to their own block on the next screen.
// Leaving the screen (signal) while these load saves nothing.
export async function addConnection({ store, catalogs }: Session, connection: Connection, signal?: AbortSignal): Promise<{ ok: true; id: string } | { ok: false; failure: AddFailure }> {
  const [catalog, meters] = await Promise.all([catalogs.load(connection, { fresh: true }), loadMeters(connection, signal)]);
  if (signal?.aborted) return { ok: false, failure: { kind: 'stopped' } };
  if (!catalog.ok) return { ok: false, failure: { kind: 'models', failure: catalog.failure } };
  const refused = meters && !meters.meters.length && meters.failures.every((failure) => failure.kind === 'provider' && failure.status === 401) ? meters.failures[0] : undefined;
  if (refused) return { ok: false, failure: { kind: 'key', failure: refused } };
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

export const removeConnection = (store: ObjectStore, id: string) => store.take('connection', id);

export const restoreConnection = (store: ObjectStore, removed: Stored<'connection'>) => store.restore(removed);
