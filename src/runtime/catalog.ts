import { PRICE_LISTS, type PriceList } from '../connectors/price-list';
import { joinPrices } from '../connectors/pricing';
import { parseCatalog, resolveConnection, withCredential } from '../connectors/registry';
import type { Account, Connection, Model } from '../connectors/types';
import { onTurn } from '../model/turns';
import { api } from './api';
import type { CredentialFailure, Credentials } from './credential';
import { relayJson } from './relay';

export type CatalogFailure = CredentialFailure | { kind: 'refused'; code: string } | { kind: 'not-a-catalog' };
export type CatalogResult = { ok: true; models: Model[] } | { ok: false; failure: CatalogFailure };

export const catalogKey = (connection: Connection): string => JSON.stringify([connection.type, connection.baseUrl, connection.protocol, connection.accounts.map((account) => account.secret)]);

const TTL_MS = 5 * 60 * 1000;

// Cache keys hold API keys, so close() drops them.
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

  // The account a reply would be sent with now. Where none would, the list still loads with the current group's first
  // account, or the connection's: it is the models that are wanted, not the allowance.
  private async serving(connection: Connection): Promise<Account> {
    const picked = await this.credentials.pool.pick(connection);
    return picked.ok ? picked.account : (onTurn(connection, Date.now())[0] ?? connection.accounts[0]!);
  }

  private async fetch(connection: Connection): Promise<CatalogResult> {
    const resolved = resolveConnection(connection);
    if (!resolved) return { ok: false, failure: { kind: 'refused', code: 'unknown-connection-type' } };
    // Prices that do not load leave the models unpriced, and their costs 알 수 없음; the list itself still loads.
    const list = resolved.type && PRICE_LISTS[resolved.type.id]?.list;
    const prices = list ? api<PriceList>('GET', `prices?provider=${encodeURIComponent(list)}`) : null;
    const credential = await this.credentials.get(resolved, (await this.serving(connection)).secret);
    if (!credential.ok) return credential;
    const response = await relayJson(withCredential(resolved, resolved.codec.listModels(resolved.endpoint), credential.credential));
    if (!response.ok) return response;
    const models = parseCatalog(resolved, response.data);
    if (!models) return { ok: false, failure: { kind: 'not-a-catalog' } };
    const priced = await prices;
    return { ok: true, models: joinPrices(models, priced?.ok ? priced.data : null) };
  }
}
