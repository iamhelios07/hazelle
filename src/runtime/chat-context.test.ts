import { describe, expect, it } from 'vitest';
import { fold, type Chat } from '../model/chat';
import { evaluateChat } from './chat-context';
import { appendUserMessage, startChat } from './chat-log';
import { testServer } from './testing';

const server = testServer();

describe('evaluateChat', () => {
  it("shows a message's inlays from the chat's own, by their exact ids", async () => {
    const { store, files } = await server.account();
    const id = crypto.randomUUID();
    await server.hold(store, id);
    const chat: Chat = { title: null, character: null, models: {} };
    await startChat(store, id, chat, null);
    await appendUserMessage(store, id, { id: crypto.randomUUID(), text: '봐 {{inlay::risu-id}}{{inlay::risu-i}}' });
    const saved = await files.save([new Uint8Array(2)]);
    if (!saved.ok) throw new Error(saved.error);
    const created = await store.create('inlay', { name: 'risu-id', type: 'image/png', size: 2, file: saved.data[0]! }, { parent: id });
    if (!created.ok) throw new Error(created.error);
    const { texts } = await evaluateChat({ store }, id, chat, fold(store.children('entry', id)));
    expect(texts).toEqual([`봐 <img src="inlay:${created.data.id}"><span data-inlay-missing></span>`]);
  });
});
