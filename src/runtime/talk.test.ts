import { describe, expect, it, vi } from 'vitest';
import { fold, shown } from '../model/chat';
import { appendUserMessage, startChat } from './chat-log';
import { answerable, inTurn, saying, stubRelay, testServer } from './testing';
import { withTurn } from './talk';
import { takeTurn } from './turn';

const server = testServer();

describe('withTurn', () => {
  it('shows a message sent translated with its translation before it is saved', () => {
    const translation = { text: '안녕', receipt: null, at: 0 };
    const said = { id: 'said', text: 'Hello', translation };
    const [message] = withTurn([], { chat: 'c', said, reply: { id: 'r', message: null, replaces: null, continues: null }, text: '', reasoning: '' }, 'c');
    expect(message!.versions[0]).toMatchObject({ text: 'Hello', translation });
  });

  it('marks the message shown before it is saved, and not the saved one', () => {
    const turn = { chat: 'c', said: { id: 'said', text: 'Hello' }, reply: { id: 'r', message: null, replaces: null, continues: null }, text: '', reasoning: '' };
    expect(withTurn([], turn, 'c')[0]!.unstored).toBe(true);
    const stored = { id: 'said', role: 'user' as const, at: 0, versions: [{ id: 'said', seed: 'said', text: 'Hello', receipt: null, edited: false, at: 0 }], selected: 0 };
    expect(withTurn([stored], turn, 'c')[0]!.unstored).toBeUndefined();
  });

  it('marks a reply asked for whole, so the chat shows it when it lands', () => {
    const turn = { chat: 'c', said: null, reply: { id: 'r', message: null, replaces: null, continues: null }, text: '', reasoning: '' };
    expect(withTurn([], { ...turn, whole: true }, 'c')[0]).toMatchObject({ live: 'r', whole: true });
    expect(withTurn([], turn, 'c')[0]!.whole).toBeUndefined();
  });
});

describe('Talk', () => {
  it('keeps two replies whose saves failed and retries the reply each failure names', () =>
    server.withSession(async (session) => {
      await answerable(session);
      const chats = [crypto.randomUUID(), crypto.randomUUID()];
      await server.hold(session.store, ...chats);
      for (const chat of chats) {
        await startChat(session.store, chat, { title: null, character: null, models: {} }, null);
        await appendUserMessage(session.store, chat, { id: crypto.randomUUID(), text: '안녕' });
      }

      let failing = false;
      const answers = inTurn([saying('첫 답장'), saying('다음 답장')]);
      stubRelay((sent) => {
        failing = true;
        return answers(sent);
      });
      const through = globalThis.fetch;
      vi.stubGlobal('fetch', (url: string, init?: RequestInit) => (failing && url.startsWith('/api/objects/') ? Promise.resolve(new Response(null, { status: 500 })) : through(url, init)));

      const first = await takeTurn(session, chats[0]!, { kind: 'answer' });
      const second = await takeTurn(session, chats[1]!, { kind: 'answer' });
      expect(first).toEqual({ kind: 'unsaved', reply: expect.any(String), failure: { ok: false, error: 'server-error' } });
      expect(second).toEqual({ kind: 'unsaved', reply: expect.any(String), failure: { ok: false, error: 'server-error' } });
      if (first?.kind !== 'unsaved' || second?.kind !== 'unsaved' || !first.reply || !second.reply) throw new Error('Expected kept replies');
      expect(first.reply).not.toBe(second.reply);
      expect(await session.talk.saveAgain(first.reply)).toEqual(first);
      for (const chat of chats) expect(fold(session.store.children('entry', chat))).toHaveLength(1);

      failing = false;
      expect(await session.talk.saveAgain(second.reply)).toBeNull();
      expect(fold(session.store.children('entry', chats[0]!))).toHaveLength(1);
      expect(await session.talk.saveAgain(first.reply)).toBeNull();
      expect(await session.talk.saveAgain(first.reply)).toBeNull();
      for (const [index, chat] of chats.entries()) {
        const messages = fold(session.store.children('entry', chat));
        expect(messages.map((message) => shown(message).text)).toEqual(['안녕', index === 0 ? '첫 답장' : '다음 답장']);
        expect(shown(messages[1]!).id).toBe(index === 0 ? first.reply : second.reply);
      }
    }));

  it('does not keep a reply whose turn a restore ended, nor write it onto the restored chat', () =>
    server.withSession(async (session) => {
      await answerable(session);
      const chat = crypto.randomUUID();
      await server.hold(session.store, chat);
      await startChat(session.store, chat, { title: null, character: null, models: {} }, null);
      await appendUserMessage(session.store, chat, { id: crypto.randomUUID(), text: '안녕' });

      let restored = false;
      stubRelay(() => {
        restored = true;
        return saying('답장');
      });
      const through = globalThis.fetch;
      const refused = vi.fn();
      vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
        if (!restored || url !== '/api/objects/batch') return through(url, init);
        refused();
        restored = false;
        return Promise.resolve(Response.json({ error: 'cache-reset' }, { status: 409 }));
      });

      expect(await takeTurn(session, chat, { kind: 'answer' })).toEqual({ kind: 'unsaved', reply: null, failure: { ok: false, error: 'timeline-changed' } });
      expect(refused).toHaveBeenCalledOnce();
      expect(await session.store.pull()).toBeNull();
      expect(fold(session.store.children('entry', chat)).map((message) => shown(message).text)).toEqual(['안녕']);
    }));

  it('keeps what each reply sent, its address and body and never its headers, while its chat is held', () =>
    server.withSession(async (session) => {
      await answerable(session);
      const chat = crypto.randomUUID();
      const lease = session.store.retainChat(chat);
      await lease.ready;
      await startChat(session.store, chat, { title: null, character: null, models: {} }, null);
      await appendUserMessage(session.store, chat, { id: crypto.randomUUID(), text: '안녕' });
      stubRelay(() => saying('반가워요'));

      await takeTurn(session, chat, { kind: 'answer' });
      const reply = shown(fold(session.store.children('entry', chat))[1]!);
      expect(session.talk.sent(reply.id)?.request).toEqual({ url: 'https://openrouter.ai/api/v1/chat/completions', body: expect.stringContaining('"content":"안녕"') });
      lease.release();
      await vi.waitFor(() => expect(session.store.scopeState(chat)).toBe('unloaded'));
      expect(session.talk.sent(reply.id)).toBeNull();
    }));

  it('saves what the model thought beside the reply, never inside its text', () =>
    server.withSession(async (session) => {
      await answerable(session);
      const chat = crypto.randomUUID();
      await server.hold(session.store, chat);
      await startChat(session.store, chat, { title: null, character: null, models: {} }, null);
      await appendUserMessage(session.store, chat, { id: crypto.randomUUID(), text: '안녕' });
      const events = [{ choices: [{ delta: { reasoning: '인사를 받았다.' } }] }, { choices: [{ delta: { content: '반가워요' }, finish_reason: 'stop' }] }];
      stubRelay(() => new Response(`${events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('')}data: [DONE]\n\n`, { headers: { 'x-relay': 'upstream' } }));

      await takeTurn(session, chat, { kind: 'answer' });
      expect(shown(fold(session.store.children('entry', chat))[1]!)).toMatchObject({ text: '반가워요', reasoning: '인사를 받았다.' });
    }));

  it('ends a turn whose prepare throws, so the next one runs', () =>
    server.withSession(async (session) => {
      const turn = { chat: crypto.randomUUID(), said: null, reply: { id: 'r', message: null, replaces: null, continues: null } };
      await expect(session.talk.run(turn, () => Promise.reject(new Error('prepare broke')))).rejects.toThrow('prepare broke');
      expect(session.talk.snapshot()).toBeNull();
      expect(await session.talk.run(turn, async () => ({ kind: 'probe' }))).toEqual({ kind: 'probe' });
    }));
});
