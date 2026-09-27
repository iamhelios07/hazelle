import { catalogRequest, parseCatalog, resolveConnection } from '../connectors/registry';
import type { Connection, Model } from '../connectors/types';
import { relayJson, type RelayFailure } from './relay';

export type CatalogFailure = RelayFailure | { kind: 'refused'; code: string } | { kind: 'not-a-catalog' };
export type CatalogResult = { ok: true; models: Model[] } | { ok: false; failure: CatalogFailure };

// A model list stays in memory for five minutes per connection and key, so moving between screens
// does not ask the provider again. A new key is a new entry.
const TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { at: number; result: Promise<CatalogResult> }>();

export function loadCatalog(connection: Connection, { fresh = false } = {}): Promise<CatalogResult> {
  const key = JSON.stringify([connection.type, connection.baseUrl, connection.protocol, connection.secret]);
  const hit = cache.get(key);
  if (hit && !fresh && performance.now() - hit.at < TTL_MS) return hit.result;
  const result = fetchCatalog(connection);
  cache.set(key, { at: performance.now(), result });
  // A failure is not kept, so the next visit asks again.
  void result.then((outcome) => outcome.ok || cache.delete(key));
  return result;
}

async function fetchCatalog(connection: Connection): Promise<CatalogResult> {
  const resolved = resolveConnection(connection);
  if (!resolved) return { ok: false, failure: { kind: 'refused', code: 'unknown-connection-type' } };
  const response = await relayJson(catalogRequest(resolved, connection.secret));
  if (!response.ok) return response;
  const models = parseCatalog(resolved, response.data);
  return models ? { ok: true, models } : { ok: false, failure: { kind: 'not-a-catalog' } };
}
