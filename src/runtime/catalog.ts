import { parseCatalog, resolveConnection, withCredential } from '../connectors/registry';
import type { Connection, Model } from '../connectors/types';
import type { CredentialFailure, Credentials } from './credential';
import { relayJson } from './relay';

export type CatalogFailure = CredentialFailure | { kind: 'refused'; code: string } | { kind: 'not-a-catalog' };
export type CatalogResult = { ok: true; models: Model[] } | { ok: false; failure: CatalogFailure };

export const catalogKey = (connection: Connection): string => JSON.stringify([connection.type, connection.baseUrl, connection.protocol, connection.secret]);

// A model list stays in memory for five minutes per connection and key, so moving between screens
// does not ask the provider again. A new key is a new entry.
const TTL_MS = 5 * 60 * 1000;

// The model lists of one open vault. Cache keys hold API keys, so close() drops them.
export class Catalogs {
  private readonly cache = new Map<string, { at: number; result: Promise<CatalogResult> }>();

  constructor(private readonly credentials: Credentials) {}

  load(connection: Connection, { fresh = false } = {}): Promise<CatalogResult> {
    const key = catalogKey(connection);
    const hit = this.cache.get(key);
    if (hit && !fresh && performance.now() - hit.at < TTL_MS) return hit.result;
    const result = this.fetch(connection);
    this.cache.set(key, { at: performance.now(), result });
    // A failure is not kept, so the next visit asks again.
    void result.then((outcome) => outcome.ok || this.cache.delete(key));
    return result;
  }

  close() {
    this.cache.clear();
  }

  private async fetch(connection: Connection): Promise<CatalogResult> {
    const resolved = resolveConnection(connection);
    if (!resolved) return { ok: false, failure: { kind: 'refused', code: 'unknown-connection-type' } };
    const credential = await this.credentials.get(resolved, connection.secret);
    if (!credential.ok) return credential;
    const response = await relayJson(withCredential(resolved, resolved.codec.listModels(resolved.endpoint), credential.credential));
    if (!response.ok) return response;
    const models = parseCatalog(resolved, response.data);
    return models ? { ok: true, models } : { ok: false, failure: { kind: 'not-a-catalog' } };
  }
}
