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
      const started = await startChat(session.store, { title: null, character: null, models: {} }, null);
      const chat = started.ok ? started.id : '';
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
});
