import { useEffect, useMemo, useState } from 'react';
import type { Chat } from '../../model/chat';
import { forecast, lastCache, type Forecast } from '../../runtime/cache';
import type { Shown } from '../../runtime/talk';
import { tokenizer } from '../../runtime/tokenizer';
import { nextSend } from '../../runtime/turn';
import { useSession } from '../session';

// Typing waits this long before the next send's prompt is built again.
const SETTLE_MS = 400;

// The prompt cache beside the send button: until when the chat's last call keeps it, and what sending the draft would
// read of it. The forecast needs the last call's request, which only the page that sent it holds (Talk.sent).
export function useCache(id: string | null, chat: Chat, messages: Shown[], text: string, busy: boolean) {
  const session = useSession();
  const last = useMemo(() => lastCache(messages), [messages]);
  const sent = last && session.talk.sent(last.version);
  const [read, setRead] = useState<Forecast | null>(null);

  useEffect(() => {
    if (id === null || busy || !last || last.until <= Date.now() || !sent?.cache) return setRead(null);
    let live = true;
    const timer = window.setTimeout(() => {
      void tokenizer().then((countTokens) => {
        const next = live && nextSend(session, id, text, countTokens);
        if (next) setRead(forecast({ connection: last.connection, view: sent.cache!, parts: sent.prompt.parts }, next));
      }, () => setRead(null));
    }, SETTLE_MS);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [id, chat, text, busy, last, sent]);

  return last && { until: last.until, forecast: read };
}
