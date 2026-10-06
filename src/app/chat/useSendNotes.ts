import { useEffect, useMemo, useState } from 'react';
import type { Chat } from '../../model/chat';
import type { Memory } from '../../model/memory';
import { forecast, lastCache, type Forecast } from '../../runtime/cache';
import { leaving } from '../../runtime/memory';
import type { Shown } from '../../runtime/talk';
import { cacheSend, wouldSend } from '../../runtime/turn';
import { useSession } from '../session';

const SETTLE_MS = 400;

// The forecast needs the last call's request, which only the page that sent it holds (Talk.sent).
export function useSendNotes(id: string | null, chat: Chat, messages: Shown[], memory: Memory | null, text: string, busy: boolean) {
  const session = useSession();
  const last = useMemo(() => lastCache(messages), [messages]);
  const sent = last && session.talk.sent(last.version);
  const [read, setRead] = useState<Forecast | null>(null);
  const [left, setLeft] = useState<number | null>(null);

  useEffect(() => {
    const cached = id !== null && !busy && last && last.until > Date.now() && sent?.cache ? { connection: last.connection, account: last.account, view: sent.cache, parts: sent.prompt.parts } : null;
    if (!cached) setRead(null);
    if (id === null || busy) return setLeft(null);
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      // A message sent translated goes out as its translation, which is not made yet, so it stands in as typed.
      void wouldSend(session, id, { kind: 'send', text }, controller.signal).then((next) => {
        if (controller.signal.aborted) return;
        setLeft(next && leaving(next.prompt));
        const send = cached && next && cacheSend(next, session.credentials.pool.peek(next.turn.route.connection.value)?.id ?? null);
        setRead(send ? forecast(cached, send) : null);
      }, () => {
        if (controller.signal.aborted) return;
        setRead(null);
        setLeft(null);
      });
    }, SETTLE_MS);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [id, chat, messages, memory, text, busy, last, sent]);

  return { cache: last && { until: last.until, forecast: read }, leaving: left };
}
