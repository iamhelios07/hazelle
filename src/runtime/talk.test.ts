import { describe, expect, it, vi } from 'vitest';
import { fold, shown } from '../model/chat';
import { appendUserMessage, startChat } from './chat-log';
import { answerable, saying, stubRelay, testServer } from './testing';
import { takeTurn } from './turn';

const server = testServer();

describe('Talk', () => {
  it('keeps a reply whose save failed, and saveAgain saves it', () =>
    server.withSession(async (session) => {
      await answerable(session);
      const chat = crypto.randomUUID();
      await startChat(session.store, chat, { title: null, character: null, models: {} }, null);
      await appendUserMessage(session.store, chat, { id: crypto.randomUUID(), text: '안녕' });

      let offline = false;
      stubRelay(() => {
        offline = true;
        return saying('반가워요');
      });
      const through = globalThis.fetch;
      vi.stubGlobal('fetch', (url: string, init?: RequestInit) => (offline && url.startsWith('/api/objects/') ? Promise.reject(new TypeError('Failed to fetch')) : through(url, init)));

      expect(await takeTurn(session, chat, { kind: 'answer' })).toEqual({ kind: 'unsaved', failure: { ok: false, error: 'offline' } });
      expect(fold(session.store.children('entry', chat))).toHaveLength(1);
      offline = false;
      expect(await session.talk.saveAgain()).toBeNull();
      expect(fold(session.store.children('entry', chat)).map((message) => shown(message).text)).toEqual(['안녕', '반가워요']);
    }));

  it('keeps what each reply sent, its address and body and never its headers, until it closes', () =>
    server.withSession(async (session) => {
      await answerable(session);
      const chat = crypto.randomUUID();
      await startChat(session.store, chat, { title: null, character: null, models: {} }, null);
      await appendUserMessage(session.store, chat, { id: crypto.randomUUID(), text: '안녕' });
      stubRelay(() => saying('반가워요'));

      await takeTurn(session, chat, { kind: 'answer' });
      const reply = shown(fold(session.store.children('entry', chat))[1]!);
      expect(session.talk.sent(reply.id)?.request).toEqual({ url: 'https://openrouter.ai/api/v1/chat/completions', body: expect.stringContaining('"content":"안녕"') });
      session.talk.close();
      expect(session.talk.sent(reply.id)).toBeNull();
    }));
});
