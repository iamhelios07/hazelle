import { useEffect, useMemo, useState } from 'react';
import type { Chat } from '../../model/chat';
import type { Memory } from '../../model/memory';
import { breakCost, forecast, lastCache, prior, type Forecast } from '../../runtime/cache';
import { leaving } from '../../runtime/memory-view';
import type { Shown } from '../../runtime/talk';
import { cacheSend, wouldSend } from '../../runtime/turn-context';
import { useSession } from '../session';

const SETTLE_MS = 400;

// until: when the last call's cache runs out, null when it cached nothing. next: the draft's forecast against the
// chat's stored last call (runtime/cache), with what a break costs where the model is priced; undefined until it is
// worked out after the chat opens or a reply ends.
export type CacheNotes = { until: number | null; next: { forecast: Forecast; cost: ReturnType<typeof breakCost> } | null | undefined };

// The draft is read again after any store change settles, so an edit to the prompt, a lorebook or the model shows in
// the forecast while it is open.
export function useSendNotes(id: string | null, chat: Chat, messages: Shown[], memory: Memory | null, text: string, busy: boolean) {
  const session = useSession();
  const last = useMemo(() => lastCache(messages), [messages]);
  const [next, setNext] = useState<CacheNotes['next']>(undefined);
  const [left, setLeft] = useState<number | null>(null);
  const [changes, setChanges] = useState(0);

  useEffect(() => {
    const stop = session.store.subscribe(() => setChanges((count) => count + 1));
    return () => void stop();
  }, []);

  useEffect(() => {
    if (id === null || busy) {
      setNext(id === null ? null : undefined);
      return setLeft(null);
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      // A message sent translated goes out as its translation, which is not made yet, so it stands in as typed.
      void wouldSend(session, id, { kind: 'send', text }, controller.signal).then((sending) => {
        if (controller.signal.aborted) return;
        setLeft(sending && leaving(sending.prompt));
        const send = sending && cacheSend(sending, session.credentials.pool.peek(sending.turn.route.connection.value)?.id ?? null);
        const before = session.store.scopeState(id) === 'loaded' ? prior(session.store, id, messages, Date.now()) : null;
        const made = send && forecast(before, send);
        setNext(made ? { forecast: made, cost: breakCost(sending.turn.route.connection.value, sending.turn.route.model, made) } : null);
      }, () => {
        if (controller.signal.aborted) return;
        setNext(null);
        setLeft(null);
      });
    }, SETTLE_MS);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [id, chat, messages, memory, text, busy, changes]);

  const cache = useMemo((): CacheNotes => ({ until: last?.until ?? null, next }), [last, next]);
  return { cache, leaving: left };
}
