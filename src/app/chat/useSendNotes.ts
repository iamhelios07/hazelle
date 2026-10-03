import { useEffect, useMemo, useState } from 'react';
import type { Chat } from '../../model/chat';
import type { Memory } from '../../model/memory';
import { forecast, lastCache, type Forecast } from '../../runtime/cache';
import { leaving } from '../../runtime/memory';
import type { Shown } from '../../runtime/talk';
import { tokenizer } from '../../runtime/tokenizer';
import { cacheSend, wouldSend } from '../../runtime/turn';
import { useSession } from '../session';

// Typing waits this long before the next send's prompt is built again.
const SETTLE_MS = 400;

// What sending the draft now would do, beside the send button: until when the chat's last call keeps the prompt cache
// and what the draft would read of it, and how many messages would leave the prompt with no memory standing for them,
// both read from one request built for the draft.
// The forecast needs the last call's request, which only the page that sent it holds (Talk.sent).
export function useSendNotes(id: string | null, chat: Chat, messages: Shown[], memory: Memory | null, text: string, busy: boolean) {
  const session = useSession();
  const last = useMemo(() => lastCache(messages), [messages]);
  const sent = last && session.talk.sent(last.version);
  const [read, setRead] = useState<Forecast | null>(null);
  const [left, setLeft] = useState<number | null>(null);

  useEffect(() => {
    const cached = id !== null && !busy && last && last.until > Date.now() && sent?.cache ? { connection: last.connection, view: sent.cache, parts: sent.prompt.parts } : null;
    if (!cached) setRead(null);
    if (id === null || busy) return setLeft(null);
    let live = true;
    const timer = window.setTimeout(() => {
      void tokenizer().then(
        (countTokens) => {
          if (!live) return;
          // A message sent translated goes out as its translation, which is not made yet, so it stands in as typed.
          const next = wouldSend(session, id, { kind: 'send', text }, countTokens);
          setLeft(next && leaving(next.prompt));
          const send = cached && next && cacheSend(next);
          if (send) setRead(forecast(cached, send));
        },
        () => {
          setRead(null);
          setLeft(null);
        },
      );
    }, SETTLE_MS);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [id, chat, messages, memory, text, busy, last, sent]);

  return { cache: last && { until: last.until, forecast: read }, leaving: left };
}
