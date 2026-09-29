import { describe, expect, it, vi } from 'vitest';
import { fold, shown } from '../model/chat';
import { appendUserMessage, startChat } from './chat-log';
import { answerable, inTurn, saying, stubRelay, testServer } from './testing';
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
});
