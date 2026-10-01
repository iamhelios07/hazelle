import { describe, expect, it, vi } from 'vitest';
import { fold, shown, type Message } from '../model/chat';
import { greetingTranslation } from '../model/library';
import { appendUserMessage, startChat } from './chat-log';
import { answerable, inTurn, saying, stubRelay, testServer, upstream } from './testing';
import { setTranslate } from './characters';
import { SETTINGS_ID } from '../model/settings';
import { setDefaultModel, setTaskModel } from './assignment';
import { translate, translatorOf } from './translate';
import { takeTurn, translateLatest, translationInput } from './turn';

const server = testServer();

describe('Translator', () => {
  it('translates a reply after its screen leaves while it is streaming', () =>
    server.withSession(async (session) => {
      await answerable(session);
      await setTranslate(session.store, null, { replies: true });
      const chat = crypto.randomUUID();
      await server.hold(session.store, chat);
      await startChat(session.store, chat, { title: null, character: null, models: {} }, null);
      await appendUserMessage(session.store, chat, { id: crypto.randomUUID(), text: 'Hi' });
      const stream = new TransformStream<Uint8Array, Uint8Array>();
      const writer = stream.writable.getWriter();
      const log = stubRelay(inTurn([new Response(stream.readable, { headers: { 'x-relay': 'upstream' } }), saying('안녕, 여행자.')]));
      const screen = vi.fn();
      const leave = session.talk.subscribe(screen);
      const turn = takeTurn(session, chat, { kind: 'answer' });
      await writer.write(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"Hello, traveler."}}]}\n\n'));
      await vi.waitFor(() => expect(session.talk.snapshot()?.text).toBe('Hello, traveler.'));
      translateLatest(session, chat);
      expect(log).toHaveLength(1);
      expect(await takeTurn(session, chat, { kind: 'answer' })).toBeNull();
      leave();
      screen.mockClear();
      await writer.write(new TextEncoder().encode('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'));
      expect(await turn).toBeNull();

      const reply = () => shown(fold(session.store.children('entry', chat))[1]!);
      await vi.waitFor(() => expect(reply().translation?.text).toBe('안녕, 여행자.'));
      await vi.waitFor(() => expect(session.translator.snapshot().live.size).toBe(0));
      expect(screen).not.toHaveBeenCalled();
      translateLatest(session, chat);
      expect(log).toHaveLength(2);
    }));

  it('checks the switch on reopening and leaves a failed translation for an explicit retry', () =>
    server.withSession(async (session) => {
      await answerable(session);
      const chat = crypto.randomUUID();
      await server.hold(session.store, chat);
      const opened = { title: null, character: null, models: {} };
      await startChat(session.store, chat, opened, null);
      const log = stubRelay(inTurn([saying('Hello'), upstream(500, { error: { message: 'overloaded' } }), saying('안녕')]));
      await takeTurn(session, chat, { kind: 'answer' });
      translateLatest(session, chat);
      expect(log).toHaveLength(1);
      await setTranslate(session.store, null, { replies: true });
      translateLatest(session, chat);
      translateLatest(session, chat);
      const messages = () => fold(session.store.children('entry', chat));
      const reply = shown(messages()[0]!);
      await vi.waitFor(() => expect(session.translator.snapshot().failed.has(reply.id)).toBe(true));
      translateLatest(session, chat);
      expect(log).toHaveLength(2);
      session.translator.translate(chat, reply, translationInput(session, chat, opened, messages(), { kind: 'message', index: 0 }));
      await vi.waitFor(() => expect(shown(messages()[0]!).translation?.text).toBe('안녕'));
      expect(log).toHaveLength(3);
    }));

  it('keeps an unsaved greeting’s automatic translation on its character, which a new chat opens with', () =>
    server.withSession(async (session) => {
      await answerable(session);
      const card = { name: 'Luna', nickname: null, description: '', personality: '', scenario: '', greetings: ['Hello'], exampleDialogue: '', systemPrompt: '', postHistoryInstructions: '', creatorNotes: '', creator: '', version: '', tags: [], variables: [], toggles: '', utility: false, bias: [], regex: [], triggers: [], lowLevelAccess: false, loreSettings: { scanDepth: null, tokenBudget: null, recursive: null, fullWordMatching: null } };
      const created = await session.store.create('character', { card, folder: null, loreFolders: [] });
      const character = created.ok ? created.data.id : '';
      await setTranslate(session.store, character, { replies: true });
      const chat = crypto.randomUUID();
      await server.hold(session.store, chat);
      const opened = { title: null, character, models: {} };
      const version = crypto.randomUUID();
      const messages: Message[] = [{ id: version, role: 'assistant', at: 0, selected: 0, versions: [{ id: version, seed: version, text: 'Hello', receipt: null, edited: false, at: 0 }] }];
      const log = stubRelay(() => saying('안녕'));
      // The chat screen shows it, as it does before the first send.
      const leave = session.read.screen(chat, session.talk, { chat: opened, messages }).subscribe(() => {});
      translateLatest(session, chat);
      const kept = () => greetingTranslation(session.store.get('character', character)!.value, 'Hello', 'Korean');
      await vi.waitFor(() => expect(kept()?.text).toBe('안녕'));
      expect(session.store.get('chat', chat)).toBeNull();
      leave();
      expect(log).toHaveLength(1);
    }));

  it('shows a reply’s translation as it comes, then saves it with the call’s receipt', () =>
    server.withSession(async (session) => {
      await answerable(session);
      const chat = crypto.randomUUID();
      await server.hold(session.store, chat);
      const opened = { title: null, character: null, models: {} };
      await startChat(session.store, chat, opened, null);
      await appendUserMessage(session.store, chat, { id: crypto.randomUUID(), text: 'Hi' });
      const log = stubRelay(inTurn([saying('Hello, traveler.'), saying('안녕, 여행자.')]));
      await takeTurn(session, chat, { kind: 'answer' });
      const messages = () => fold(session.store.children('entry', chat));
      const reply = shown(messages()[1]!);

      const savedWhenLiveClears: boolean[] = [];
      const unsubscribe = session.translator.subscribe(() => {
        if (!session.translator.snapshot().live.has(reply.id)) savedWhenLiveClears.push(shown(messages()[1]!).translation !== undefined);
      });
      session.translator.translate(chat, reply, translationInput(session, chat, opened, messages(), { kind: 'message', index: 1 }));
      expect(session.translator.snapshot().live.get(reply.id)).toBe('');
      await vi.waitFor(() => expect(shown(messages()[1]!).translation).toMatchObject({ text: '안녕, 여행자.', receipt: { state: 'done' } }));
      await vi.waitFor(() => expect(session.translator.snapshot().live.size).toBe(0));
      expect(savedWhenLiveClears).toEqual([true]);
      unsubscribe();
      expect(JSON.parse(log[1]!.sent.body!).messages.at(-1)).toEqual({ role: 'user', content: 'Hello, traveler.' });
    }));

  it('lets a version be translated again after a translation that threw', () =>
    server.withSession(async (session) => {
      await answerable(session);
      const chat = crypto.randomUUID();
      await server.hold(session.store, chat);
      const opened = { title: null, character: null, models: {} };
      await startChat(session.store, chat, opened, null);
      vi.spyOn(session.credentials, 'get').mockRejectedValueOnce(new TypeError('lost'));
      const thrown = new Promise((resolve) => process.once('unhandledRejection', resolve));
      const input = translationInput(session, chat, opened, [], { kind: 'input', text: 'Hi' });

      session.translator.translate(chat, { id: 'v', seed: 'v', text: 'Hi', receipt: null, edited: false, at: 0 }, input);
      expect(await thrown).toBeInstanceOf(TypeError);
      expect(session.translator.snapshot().live.has('v')).toBe(false);
      session.translator.translate(chat, { id: 'v', seed: 'v', text: 'Hi', receipt: null, edited: false, at: 0 }, input);
      expect(session.translator.snapshot().live.get('v')).toBe('');
    }));

  it('stops before any call when the character’s translation prompt is gone', () =>
    server.withSession(async (session) => {
      await answerable(session);
      const chat = crypto.randomUUID();
      await server.hold(session.store, chat);
      const opened = { title: null, character: null, models: {} };
      await startChat(session.store, chat, opened, null);
      await setTranslate(session.store, null, { prompt: crypto.randomUUID() });
      const log = stubRelay(inTurn([saying('안녕')]));

      const target = { id: crypto.randomUUID(), chat, result: crypto.randomUUID(), for: { kind: 'input', typed: 'Hi' } } as const;
      const made = await translate(session, translationInput(session, chat, opened, [], { kind: 'input', text: 'Hi' }), target, new AbortController().signal, () => {});
      expect(made).toEqual({ ok: false, failure: { kind: 'prompt-missing', own: true } });
      expect(log).toHaveLength(0);
    }));

  it('translates with the translation prompt’s own model, and without one with the chat’s 보조 모델', () =>
    server.withSession(async (session) => {
      await answerable(session);
      const [connection] = session.store.list('connection');
      const starred = (id: string) => ({ ...connection!.value.starred[0]!, id, name: id });
      await session.store.update('connection', connection!.id, (current) => ({ ...current, starred: [...current.starred, starred('aux'), starred('tr')] }));
      const chat = { title: null, character: null, models: {} };
      const model = () => {
        const translator = translatorOf(session.store, chat);
        return translator.ok ? translator.route.model.id : translator.failure.kind;
      };
      expect(model()).toBe('m');
      await setDefaultModel(session.store, 'aux', { connection: connection!.id, model: 'aux' });
      expect(model()).toBe('aux');
      await setTaskModel(session.store, session.store.get('settings', SETTINGS_ID)!.value.translatePrompt!, { connection: connection!.id, model: 'tr' });
      expect(model()).toBe('tr');
    }));
});
