import type { Resolved } from '../connectors/registry';
import type { Token } from '../connectors/types';
import { relayJson, type RelayFailure } from './relay';

export type CredentialFailure = RelayFailure | { kind: 'no-token' };
export type CredentialResult = { ok: true; credential: string } | { ok: false; failure: CredentialFailure };

// A token is traded again a minute before it runs out, so a reply never starts on a dying one.
const MARGIN_MS = 60 * 1000;
const tokens = new Map<string, Token>();

// What a request carries: the stored key itself, or the short-lived token its connection type trades
// the key for, kept in page memory until it nears its end.
export async function credentialFor({ type }: Resolved, secret: string, signal?: AbortSignal): Promise<CredentialResult> {
  if (!type?.exchange) return { ok: true, credential: secret };
  const key = JSON.stringify([type.id, secret]);
  const kept = tokens.get(key);
  if (kept && kept.expiresAt - MARGIN_MS > Date.now()) return { ok: true, credential: kept.value };
  const answer = await relayJson(type.exchange.request(secret), signal);
  if (!answer.ok) return answer;
  const token = type.exchange.parse(answer.data);
  if (!token) return { ok: false, failure: { kind: 'no-token' } };
  tokens.set(key, token);
  return { ok: true, credential: token.value };
}

// The keys and tokens are secrets, so nothing is left behind once the vault closes.
export function forgetCredentials() {
  tokens.clear();
}
