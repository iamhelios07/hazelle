import { describe, expect, it } from 'vitest';
import type { Receipt } from '../model/chat';
import { chatModel } from './assignment';
import { appendUserMessage, startChat } from './chat-log';
import { redacted, REQUEST_LOG_LIMITS, RequestLog, type LogEntry } from './request-log';
import type { ObjectStore } from './store';
import { pageAnswer } from './talk';
import { answerable, saying, stubRelay, testConnection, testServer } from './testing';
import { takeTurn } from './turn';

const server = testServer();

const entry = (chat: string, id: string, body = ''): LogEntry => ({ chat, purpose: 'reply', at: 0, picked: false, receipt: { id } as Receipt, request: { url: 'https://x.test/v1', body }, response: null });

describe('the request log', () => {
  it('records every model call under its chat with its purpose, a reply with the prompt it was assembled from', () =>
    server.withSession(async (session) => {
      await answerable(session);
      const chat = crypto.randomUUID();
      const lease = session.store.retainChat(chat);
      await lease.ready;
      await startChat(session.store, chat, { title: null, character: null, models: {} }, null);
      await appendUserMessage(session.store, chat, { id: crypto.randomUUID(), text: '안녕' });
      stubRelay(() => saying('반가워요'));
      await takeTurn(session, chat, { kind: 'answer' });
      const route = chatModel(session.store, session.store.get('chat', chat)!.value, 'main');
      if ('kind' in route) throw new Error(route.kind);
      await pageAnswer(session, { route, settings: {} }, 'mascot', chat, [{ role: 'user', content: '한마디' }], new AbortController().signal);
      const { entries } = session.log.of(chat);
      expect(entries.map(({ purpose, receipt }) => [purpose, receipt.state])).toEqual([['reply', 'done'], ['mascot', 'done']]);
      expect(entries[0]!.prompt?.messages.at(-1)).toMatchObject({ content: '안녕' });
      expect(entries[1]!.prompt).toBeUndefined();
      lease.release();
    }));

  it('hides a credential in the address and an account secret anywhere in the request', () => {
    const connection = { ...testConnection, accounts: [{ id: 'a', secret: 'sk-or-x' }] };
    expect(redacted({ url: 'https://me:pw@x.test/v1?key=abc&alt=sse', body: '{"note":"sk-or-x"}' }, connection)).toEqual({ url: 'https://REDACTED@x.test/v1?key=REDACTED&alt=sse', body: '{"note":"REDACTED"}' });
  });

  it('drops a chat’s entries when its scope is released, and keeps the others', () => {
    let listener: Parameters<ObjectStore['subscribe']>[0] = () => {};
    const log = new RequestLog({ subscribe: (heard) => ((listener = heard), () => true), scopeState: (chat) => (chat === 'a' ? 'unloaded' : 'loaded') });
    log.record(entry('a', '1'));
    log.record(entry('b', '2'));
    listener([{ kind: 'scope', id: 'a', parent: null }]);
    expect(log.of('a').entries).toEqual([]);
    expect(log.entry('b', '2')).not.toBeNull();
  });

  it('keeps a bounded number of entries per chat, counting what it let go, and always the newest', () => {
    const log = new RequestLog({ subscribe: () => () => true, scopeState: () => 'loaded' });
    for (let index = 0; index <= REQUEST_LOG_LIMITS.entries; index++) log.record(entry('a', String(index)));
    expect(log.of('a')).toMatchObject({ entries: { length: REQUEST_LOG_LIMITS.entries }, omitted: 1 });
    log.record(entry('a', 'huge', 'x'.repeat(REQUEST_LOG_LIMITS.characters + 1)));
    expect(log.of('a').entries.map(({ receipt }) => receipt.id)).toEqual(['huge']);
  });
});
