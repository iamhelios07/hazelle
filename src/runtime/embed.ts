import type { EmbedPurpose } from '../connectors/types';
import type { Receipt } from '../model/chat';
import type { Route } from './assignment';
import type { Credentials } from './credential';

export type Embedded = { ok: true; model: string; vectors: number[][] } | { ok: false; reason: 'too-large' | 'flood' | 'failed' };

// One embedding call through the relay, counted in the chat's bot cap (bot: the chat). Consent and the model pick are
// the caller's (Scripts). receipt: null when nothing reached the network.
export function embedTexts(
  deps: { credentials: Credentials; count(texts: string[]): Promise<number[]> },
  route: Route,
  texts: string[],
  as: EmbedPurpose | null,
  bot: string,
  signal?: AbortSignal,
): Promise<{ answer: Embedded; receipt: Receipt | null }> {
  void deps; void route; void texts; void as; void bot; void signal;
  return Promise.resolve({ answer: { ok: false, reason: 'failed' }, receipt: null });
}
