import { describe, expect, it, vi } from 'vitest';
import { fold, shown } from '../model/chat';
import { appendUserMessage, startChat } from './chat-log';
import { answerable, inTurn, saying, stubRelay, testServer } from './testing';
import { setTranslate } from './characters';
import { translate } from './translate';
import { takeTurn, translationInput } from './turn';

const server = testServer();

describe('Translator', () => {
  it('shows a reply’s translation as it comes, then saves it with the call’s receipt', () =>
    server.withSession(async (session) => {
      await answerable(session);
      const chat = crypto.randomUUID();
      const opened = { title: null, character: null, models: {} };
      await startChat(session.store, chat, opened, null);
      await appendUserMessage(session.store, chat, { id: crypto.randomUUID(), text: 'Hi' });
      const log = stubRelay(inTurn([saying('Hello, traveler.'), saying('안녕, 여행자.')]));
      await takeTurn(session, chat, { kind: 'answer' });
      const messages = () => fold(session.store.children('entry', chat));
      const reply = shown(messages()[1]!);

      session.translator.translate(chat, reply.id, translationInput(session, chat, opened, messages(), { kind: 'message', index: 1 }));
      expect(session.translator.snapshot().live.get(reply.id)).toBe('');
      await vi.waitFor(() => expect(shown(messages()[1]!).translation).toMatchObject({ text: '안녕, 여행자.', receipt: { state: 'done' } }));
      expect(session.translator.snapshot().live.size).toBe(0);
      expect(JSON.parse(log[1]!.sent.body!).messages.at(-1)).toEqual({ role: 'user', content: 'Hello, traveler.' });
    }));

  it('lets a version be translated again after a translation that threw', () =>
    server.withSession(async (session) => {
      await answerable(session);
      const chat = crypto.randomUUID();
      const opened = { title: null, character: null, models: {} };
      await startChat(session.store, chat, opened, null);
      vi.spyOn(session.credentials, 'get').mockRejectedValueOnce(new TypeError('lost'));
      const thrown = new Promise((resolve) => process.once('unhandledRejection', resolve));
      const input = translationInput(session, chat, opened, [], { kind: 'input', text: 'Hi' });

      session.translator.translate(chat, 'v', input);
      expect(await thrown).toBeInstanceOf(TypeError);
      expect(session.translator.snapshot().live.has('v')).toBe(false);
      session.translator.translate(chat, 'v', input);
      expect(session.translator.snapshot().live.get('v')).toBe('');
    }));

  it('stops before any call when the character’s translation prompt is gone', () =>
    server.withSession(async (session) => {
      await answerable(session);
      const chat = crypto.randomUUID();
      const opened = { title: null, character: null, models: {} };
      await startChat(session.store, chat, opened, null);
      await setTranslate(session.store, null, { prompt: crypto.randomUUID() });
      const log = stubRelay(inTurn([saying('안녕')]));

      const made = await translate(session, translationInput(session, chat, opened, [], { kind: 'input', text: 'Hi' }), new AbortController().signal, () => {});
      expect(made).toEqual({ ok: false, failure: { kind: 'prompt-missing', own: true } });
      expect(log).toHaveLength(0);
    }));
});
