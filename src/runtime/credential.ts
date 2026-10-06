import type { Resolved } from '../connectors/registry';
import type { Token } from '../connectors/types';
import { Pool } from './pool';
import { relayJson, type RelayFailure } from './relay';

export type CredentialFailure = RelayFailure | { kind: 'no-token' };
export type CredentialResult = { ok: true; credential: string } | { ok: false; failure: CredentialFailure };

// A token is traded again a minute before it runs out, so a reply never starts on a dying one.
const MARGIN_MS = 60 * 1000;

// The tokens are secrets, so close() drops them and stops every trade still under way. pool picks the account whose
// secret is traded.
export class Credentials {
  readonly pool = new Pool();
  private readonly tokens = new Map<string, Token>();
  private readonly closing = new AbortController();

  async get({ type }: Resolved, secret: string, signal?: AbortSignal): Promise<CredentialResult> {
    if (!type?.exchange) return { ok: true, credential: secret };
    const key = JSON.stringify([type.id, secret]);
    const kept = this.tokens.get(key);
    if (kept && kept.expiresAt - MARGIN_MS > Date.now()) return { ok: true, credential: kept.value };
    const answer = await relayJson(type.exchange.request(secret), signal ? AbortSignal.any([signal, this.closing.signal]) : this.closing.signal);
    if (!answer.ok) return answer;
    // A trade answered after close() is never kept: it would outlive the vault it came from.
    if (this.closing.signal.aborted) return { ok: false, failure: { kind: 'stopped' } };
    const token = type.exchange.parse(answer.data);
    if (!token) return { ok: false, failure: { kind: 'no-token' } };
    this.tokens.set(key, token);
    return { ok: true, credential: token.value };
  }

  close() {
    this.pool.close();
    this.closing.abort();
    this.tokens.clear();
  }
}
