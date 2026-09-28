import { describe, expect, it } from 'vitest';
import { fold, shown, type Chat } from '../model/chat';
import { startChat } from './chat-log';
import { testServer } from './testing';
import { displayChat } from './turn';

const server = testServer();

describe('startChat', () => {
  it('opens the chat on the greeting that was shown, first and last included, under the ids it was shown with, so its tags roll the same', async () => {
    const { store } = await server.account();
    const reader = { store, username: 'jin' };
    const texts = ['하나 {{pick}} {{random}}', '둘', '셋'];
    const opened = async (selected: number) => {
      const id = crypto.randomUUID();
      const chat: Chat = { title: null, character: null, models: {} };
      const versions = texts.map((text) => ({ id: crypto.randomUUID(), text, receipt: null, edited: false, at: 0 }));
      const before = displayChat(reader, id, chat, [{ id: 'opening', role: 'assistant', at: 0, versions, selected }]);
      expect(await startChat(store, id, chat, { ids: versions.map((version) => version.id), texts, selected })).toEqual({ ok: true });
      const messages = fold(store.children('entry', id));
      expect(messages[0]!.versions.map((version) => version.id)).toEqual(versions.map((version) => version.id));
      expect(displayChat(reader, id, chat, messages)).toEqual(before);
      return [shown(messages[0]!).text, messages[0]!.versions.length];
    };
    expect(await opened(0)).toEqual(['하나 {{pick}} {{random}}', 3]);
    expect(await opened(2)).toEqual(['셋', 3]);
  });
});
