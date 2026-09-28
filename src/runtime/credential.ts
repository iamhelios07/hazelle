import type { Resolved } from '../connectors/registry';
import type { Token } from '../connectors/types';
import { relayJson, type RelayFailure } from './relay';

export type CredentialFailure = RelayFailure | { kind: 'no-token' };
export type CredentialResult = { ok: true; credential: string } | { ok: false; failure: CredentialFailure };

// A token is traded again a minute before it runs out, so a reply never starts on a dying one.
const MARGIN_MS = 60 * 1000;

// What a request carries: the stored key itself, or the short-lived token its connection type trades
// the key for, kept in page memory until it nears its end. The tokens are secrets, so close() drops
// them and stops every trade still under way (runtime/session).
export class Credentials {
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
    this.closing.abort();
    this.tokens.clear();
  }
}
