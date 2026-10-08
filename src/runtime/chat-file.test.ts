import { describe, expect, it } from 'vitest';
import { fold, type Chat, type Receipt } from '../model/chat';
import { memoryId } from '../model/memory';
import { chatFile, readChatFile } from './chat-file';
import { appendReply, appendTranslation, appendUserMessage, selectVersion, startChat } from './chat-log';
import { testServer } from './testing';

const server = testServer();
const receipt: Receipt = { id: 'call', connection: 'c1', source: 'OpenRouter', model: 'm1', modelName: 'Model One', state: 'done', cut: null, error: null, finishReason: 'stop', usage: null, cost: null, replyId: null, firstTextMs: 100, totalMs: 900, cache: null };

async function savedChat() {
  const { store } = await server.account();
  const id = crypto.randomUUID();
  await server.hold(store, id);
  const chat: Chat = { title: '밤', character: null, models: {} };
  await startChat(store, id, chat, null);
  await appendUserMessage(store, id, { id: crypto.randomUUID(), text: '안녕' });
  const reply = crypto.randomUUID();
  await appendReply(store, id, { id: reply, message: null, replaces: null, at: 1, text: '첫 답', receipt });
  const swipe = crypto.randomUUID();
  await appendReply(store, id, { id: swipe, message: reply, replaces: null, at: 2, text: '둘째 답', receipt });
  await selectVersion(store, id, reply, reply);
  await appendTranslation(store, id, reply, { text: 'First reply', receipt: null, at: 3 }, crypto.randomUUID());
  await store.create('memory', { records: [], state: [{ about: 'Luna', field: 'mood', value: 'calm', record: null }], threads: [] }, { id: memoryId(id), parent: id });
  return { store, id };
}

describe('chat file', () => {
  it('reads back as the chat folds here, its memory with it', async () => {
    const { store, id } = await savedChat();
    const read = readChatFile(JSON.parse(chatFile(store, id)));
    if (!read.ok) throw new Error(read.error);
    expect(read.file.chat.id).toBe(id);
    expect(fold(read.file.entries)).toEqual(fold(store.children('entry', id)));
    expect(read.file.memory?.value.state).toEqual([{ about: 'Luna', field: 'mood', value: 'calm', record: null }]);
  });

  it('refuses another format or version, a row that is not stored, a second chat, and a row of another chat', async () => {
    const { store, id } = await savedChat();
    const file = JSON.parse(chatFile(store, id)) as { rows: { id: string; parent: string | null }[] };
    const [chat, entry] = file.rows;
    expect(readChatFile({ ...file, format: 'risu-alpha-backup' })).toEqual({ ok: false, error: 'not-chat-file' });
    expect(readChatFile({ ...file, version: 2 })).toEqual({ ok: false, error: 'other-version' });
    expect(readChatFile({ ...file, rows: [...file.rows, { ...entry, rev: 'one' }] })).toEqual({ ok: false, error: 'not-chat-file' });
    expect(readChatFile({ ...file, rows: [...file.rows, { ...chat, id: crypto.randomUUID() }] })).toEqual({ ok: false, error: 'not-chat-file' });
    expect(readChatFile({ ...file, rows: [...file.rows, { ...entry, id: crypto.randomUUID(), parent: crypto.randomUUID() }] })).toEqual({ ok: false, error: 'not-chat-file' });
  });
});
