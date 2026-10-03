import type { CacheView } from '../connectors/registry';
import type { Cache } from '../connectors/settings';
import type { Assembled, From } from '../engine/pipeline';
import type { Message } from '../model/chat';
import type { Role } from '../model/prompt';

const TTL: Record<Cache, number> = { '5m': 5 * 60_000, '1h': 60 * 60_000 };

export type LastCache = { version: string; connection: string; until: number };

// A provider keeps a cache for the call's TTL from the call's start, and a read renews it as a write does. null when the
// chat's latest call that reported its counts sent no cache point, or reported reading and writing none (a prompt
// shorter than the model caches, or a provider that ignores points).
export function lastCache(messages: Message[]): LastCache | null {
  let latest: { id: string; at: number; receipt: NonNullable<Message['versions'][number]['receipt']> } | null = null;
  for (const message of messages) {
    for (const { id, at, receipt } of message.versions) if (receipt?.usage && (!latest || at > latest.at)) latest = { id, at, receipt };
  }
  if (!latest) return null;
  const { cache, usage, totalMs, connection } = latest.receipt;
  if (!cache || !((usage!.cachedInputTokens ?? 0) > 0 || (usage!.cacheWriteInputTokens ?? 0) > 0)) return null;
  return { version: latest.id, connection, until: latest.at - totalMs + TTL[cache] };
}

export type CacheSend = { connection: string; view: CacheView; parts: Assembled['parts'] };

// differs: the last call's message is not sent as it was (an edit, a change, or a message the budget or a delete
// dropped); added: a message the last call did not send comes before it.
export type Break = { kind: 'model' | 'reasoning' | 'off' } | { kind: 'differs' | 'added'; from: From; role: Role };

// read: the tokens the next send would read from the cache, of all the last call cached up to its last point.
export type Forecast = { read: number; of: number; broken: Break | null };

// A provider reads its cache only where the last call put a point, and only as far as the two requests match from
// their start. null when the last call put none.
export function forecast(last: CacheSend, next: CacheSend): Forecast | null {
  const before = last.view.messages;
  const points = before.flatMap((message, index) => (message.cache ? [index] : []));
  if (!points.length) return null;
  const upTo = (send: CacheSend, end: number) => send.view.messages.slice(0, end + 1).reduce((sum, { index }) => sum + send.parts[index]!.tokens, 0);
  const of = upTo(last, points.at(-1)!);
  const none = (broken: Break): Forecast => ({ read: 0, of, broken });
  if (next.connection !== last.connection || next.view.model !== last.view.model) return none({ kind: 'model' });
  if (JSON.stringify(next.view.reasoning) !== JSON.stringify(last.view.reasoning)) return none({ kind: 'reasoning' });
  const after = next.view.messages;
  if (!after.some((message) => message.cache)) return none({ kind: 'off' });

  let same = 0;
  while (same < before.length && same < after.length && before[same]!.role === after[same]!.role && before[same]!.content === after[same]!.content) same++;
  const at = points.findLast((point) => point < same);
  const read = at === undefined ? 0 : upTo(next, at);
  if (at === points.at(-1)) return { read, of, broken: null };
  const gone = before[same]!;
  const broken: Break =
    same < after.length && after.some((message) => message.content === gone.content)
      ? { kind: 'added', from: next.parts[after[same]!.index]!.from, role: after[same]!.role }
      : { kind: 'differs', from: last.parts[gone.index]!.from, role: gone.role };
  return { read, of, broken };
}
