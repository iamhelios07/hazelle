import { describe, expect, it, vi } from 'vitest';
import { fold, shown } from '../model/chat';
import { appendUserMessage, editMessage, selectVersion, startChat } from './chat-log';
import { RELAY_HEADER } from '../contracts/http';
import { chatPrint, forecast, prior } from './cache';
import { FIRST_PROFILE_ID } from './profiles';
import { answerable, inTurn, saying, stubRelay, testServer, upstream } from './testing';
import { withTurn } from './talk';
import { takeTurn } from './turn';
import { cacheSend, wouldSend } from './turn-context';

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

  it('shows a new version of an earlier reply without what continues the others, and one in its place with it', () => {
    const message = (id: string, role: 'user' | 'assistant') => ({ id, role, at: 0, versions: [{ id, seed: id, text: id, receipt: null, edited: false, at: 0 }], selected: 0 });
    const story = [message('u1', 'user'), message('b1', 'assistant'), message('u2', 'user')];
    const turn = { chat: 'c', said: null, reply: { id: 'r', message: 'b1', replaces: null, continues: null }, text: '', reasoning: '' };
    expect(withTurn(story, turn, 'c').map(({ id }) => id)).toEqual(['u1', 'b1']);
    expect(withTurn(story, { ...turn, reply: { ...turn.reply, replaces: 'b1' } }, 'c').map(({ id }) => id)).toEqual(['u1', 'b1', 'u2']);
  });

  it('marks a reply asked for whole, so the chat shows it when it lands', () => {
    const turn = { chat: 'c', said: null, reply: { id: 'r', message: null, replaces: null, continues: null }, text: '', reasoning: '' };
    expect(withTurn([], { ...turn, whole: true }, 'c')[0]).toMatchObject({ live: 'r', whole: true });
    expect(withTurn([], turn, 'c')[0]!.whole).toBeUndefined();
  });
});

describe('Talk', () => {
  it('makes an earlier reply again with nothing after it, and sends after the version shown', () =>
    server.withSession(async (session) => {
      await answerable(session);
      const chat = crypto.randomUUID();
      await server.hold(session.store, chat);
      await startChat(session.store, chat, { title: null, character: null, models: {} }, null);
      stubRelay(inTurn([saying('B1'), saying('B2'), saying('B1 다시'), saying('B3')]));
      const story = () => fold(session.store.children('entry', chat)).map((message) => shown(message).text);
      expect(await takeTurn(session, chat, { kind: 'send', text: 'A1' })).toBeNull();
      expect(await takeTurn(session, chat, { kind: 'send', text: 'A2' })).toBeNull();
      const reply = fold(session.store.children('entry', chat))[1]!;
      expect(await takeTurn(session, chat, { kind: 'regenerate', message: reply.id })).toBeNull();
      expect(story()).toEqual(['A1', 'B1 다시']);
      expect(await takeTurn(session, chat, { kind: 'send', text: 'A3' })).toBeNull();
      expect(story()).toEqual(['A1', 'B1 다시', 'A3', 'B3']);
      await selectVersion(session.store, chat, reply.id, reply.id);
      expect(story()).toEqual(['A1', 'B1', 'A2', 'B2']);
    }));

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
      vi.stubGlobal('fetch', (url: string, init?: RequestInit) => (failing && url.startsWith('/api/objects/') ? Promise.resolve(Response.json({ error: 'server-error' }, { status: 500 })) : through(url, init)));

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

  it('keeps what each call sent, its address and body and never its headers, through an edit and while its chat is held', () =>
    server.withSession(async (session) => {
      await answerable(session);
      const chat = crypto.randomUUID();
      const lease = session.store.retainChat(chat);
      await lease.ready;
      await startChat(session.store, chat, { title: null, character: null, models: {} }, null);
      await appendUserMessage(session.store, chat, { id: crypto.randomUUID(), text: '안녕' });
      stubRelay(() => saying('반가워요'));

      await takeTurn(session, chat, { kind: 'answer' });
      const message = () => fold(session.store.children('entry', chat))[1]!;
      const call = shown(message()).receipt!.id;
      expect(session.talk.sent(call)?.request).toEqual({ url: 'https://openrouter.ai/api/v1/chat/completions', body: expect.stringContaining('"content":"안녕"') });
      // An edit (a person's, or a bot's onOutput) is a version of its own that keeps the call's receipt.
      await editMessage(session.store, chat, message(), '반가워요!', null);
      expect(shown(message()).id).not.toBe(call);
      expect(shown(message()).receipt!.id).toBe(call);
      expect(session.talk.sent(call)).not.toBeNull();
      lease.release();
      await vi.waitFor(() => expect(session.store.scopeState(chat)).toBe('unloaded'));
      expect(session.talk.sent(call)).toBeNull();
    }));

  it('keeps on each receipt what its send expected from the cache, and stores the call so a forecast survives a reload', () =>
    server.withSession(async (session) => {
      await answerable(session);
      await session.store.update('profile', FIRST_PROFILE_ID, (current) => ({ ...current, settings: { cache: '5m' } }));
      const chat = crypto.randomUUID();
      const lease = session.store.retainChat(chat);
      await lease.ready;
      await startChat(session.store, chat, { title: null, character: null, models: {} }, null);
      const usage = { prompt_tokens: 100, completion_tokens: 5, prompt_tokens_details: { cached_tokens: 40, cache_write_tokens: 50 } };
      const cached = (text: string) => new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: text }, finish_reason: 'stop' }], usage })}\n\ndata: [DONE]\n\n`, { headers: { [RELAY_HEADER]: 'upstream' } });
      stubRelay(inTurn([cached('반가워요'), cached('또 반가워요'), upstream(500, { error: { message: 'down' } })]));
      const receipts = () => fold(session.store.children('entry', chat)).filter(({ role }) => role === 'assistant').map((message) => shown(message).receipt!);

      expect(await takeTurn(session, chat, { kind: 'send', text: '안녕' })).toBeNull();
      expect(receipts()[0]!.forecast).toBeUndefined();
      expect(chatPrint(session.store, chat)?.value).toMatchObject({ call: receipts()[0]!.id, model: 'm', messages: expect.arrayContaining([expect.objectContaining({ point: true })]) });
      expect(await takeTurn(session, chat, { kind: 'send', text: '또 안녕' })).toBeNull();
      expect(receipts()[1]!.forecast).toMatchObject({ broken: null });
      expect(receipts()[1]!.forecast!.read).toBeGreaterThan(0);
      expect(chatPrint(session.store, chat)?.value.call).toBe(receipts()[1]!.id);
      // A call that kept no cache leaves the print on the one lastCache still names.
      expect(await takeTurn(session, chat, { kind: 'answer' })).toBeNull();
      expect(receipts()[2]!.state).toBe('failed');
      expect(chatPrint(session.store, chat)?.value.call).toBe(receipts()[1]!.id);

      lease.release();
      await vi.waitFor(() => expect(session.store.scopeState(chat)).toBe('unloaded'));
      await server.hold(session.store, chat);
      const messages = session.read.chat(chat).snapshot()!.messages;
      const sending = (await wouldSend(session, chat, { kind: 'send', text: '셋' }))!;
      const against = forecast(prior(session.store, chat, messages, Date.now()), cacheSend(sending, null)!)!.against!;
      expect(against).toEqual({ read: against.of, of: against.of, broken: null });
      expect(against.of).toBeGreaterThan(receipts()[1]!.forecast!.of);
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
      expect(session.talk.snapshot(turn.chat)).toBeNull();
      expect(await session.talk.run(turn, async () => ({ kind: 'probe' }))).toEqual({ kind: 'probe' });
    }));

  it('runs one turn per chat at once and stops only the chat it is asked to', () =>
    server.withSession(async (session) => {
      const [a, b] = [crypto.randomUUID(), crypto.randomUUID()];
      const turn = (chat: string) => ({ chat, said: null, reply: { id: crypto.randomUUID(), message: null, replaces: null, continues: null } });
      const held = (signal: AbortSignal) => new Promise<{ kind: 'stopped' }>((done) => {
        if (signal.aborted) done({ kind: 'stopped' });
        signal.addEventListener('abort', () => done({ kind: 'stopped' }));
      });
      const first = session.talk.run(turn(a), held);
      const second = session.talk.run(turn(b), held);
      expect(session.talk.snapshot(a)?.chat).toBe(a);
      expect(session.talk.snapshot(b)?.chat).toBe(b);
      expect([...session.talk.writing()]).toEqual([a, b]);
      expect(await session.talk.run(turn(a), held)).toBeNull();
      session.talk.stop(a);
      expect(await first).toEqual({ kind: 'stopped' });
      expect(session.talk.snapshot(a)).toBeNull();
      expect(session.talk.snapshot(b)?.chat).toBe(b);
      expect([...session.talk.writing()]).toEqual([b]);
      session.talk.stop(b);
      expect(await second).toEqual({ kind: 'stopped' });
    }));
});
