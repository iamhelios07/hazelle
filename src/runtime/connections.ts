import type { Connection, Model } from '../connectors/types';
import type { Stored } from '../model/kinds';
import type { ApiFailure, ApiResult } from './api';
import type { CatalogFailure } from './catalog';
import { loadMeters, type MetersFailure } from './meters';
import type { Session } from './session';
import type { ObjectStore } from './store';

// models: the model list did not load. key: the provider refused the key the meters asked with.
// stopped: the caller gave up (signal) before the save.
export type AddFailure =
  | { kind: 'models'; failure: CatalogFailure }
  | { kind: 'key'; failure: MetersFailure }
  | { kind: 'save'; failure: ApiFailure }
  | { kind: 'stopped' };

// F5's last step on every path: the model list must load before the connection is saved. A model list
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
export function setStarred(store: ObjectStore, id: string, model: Model, starred: boolean): Promise<ApiResult<Stored<'connection'>>> {
  return store.update('connection', id, (current) => {
    const others = current.starred.filter((entry) => entry.id !== model.id);
    return { ...current, starred: starred ? [...others, model] : others };
  });
}
