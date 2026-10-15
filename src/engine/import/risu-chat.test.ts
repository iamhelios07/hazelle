import { expect, it } from 'vitest';
import { risuChatFile } from './risu-character';
import { RISU_ALL_CHATS, risuChat, risuChatJson, type RisuChatSource } from './risu-chat';
import type { LoreEntry } from './types';

const entry = (name: string, over: Partial<LoreEntry> = {}): LoreEntry => ({
  name, keys: [name], secondaryKeys: [], content: `${name}의 이야기`, enabled: true, constant: false, selective: false, useRegex: false,
  caseSensitive: false, insertionOrder: 100, priority: null, position: null, folder: null, ...over,
});

const source: RisuChatSource = {
  id: 'chat',
  title: '기숙사의 밤',
  note: '작가의 노트',
  greeting: 2,
  messages: [
    { id: 'm1', role: 'user', text: '안녕', at: 10 },
    { id: 'm2', role: 'assistant', text: '어서 와', at: 20, reasoning: '반갑게 맞는다.' },
    { id: 'm3', role: 'user', text: '또 봐', at: 30 },
  ],
  variables: [['mood', '기쁨'], ['hp', '{"max":10}']],
  bookmarks: [{ message: 'm2', name: '첫 인사' }, { message: 'm3' }, { message: 'gone' }],
  lore: [entry('바다', { folder: 0 }), entry('꺼 둔 것', { enabled: false }), entry('순서', { priority: 3 })],
  loreFolders: ['장소'],
};

it("reads back through this app's Risu reader as the same line, greeting, variables and bookmarks, under Risu's ver-2 check", () => {
  const { chat, unheld } = risuChat(source);
  const file = JSON.parse(risuChatJson(chat));
  expect([file.type, file.ver]).toEqual(['risuChat', 2]);
  const read = risuChatFile(file)!;
  const [back] = read.chats;
  expect(back).toMatchObject({ title: '기숙사의 밤', note: '작가의 노트', greeting: 2, variables: source.variables, loreFolders: ['장소'] });
  expect(back!.messages).toEqual([
    { role: 'user', text: '안녕', at: 10 },
    { role: 'assistant', text: '어서 와', at: 20, reasoning: '반갑게 맞는다.', bookmark: { name: '첫 인사' } },
    { role: 'user', text: '또 봐', at: 30, bookmark: {} },
  ]);
  expect(back!.lore.map(({ name, folder }) => [name, folder])).toEqual([['바다', 0]]);
  expect(unheld).toBe(2);
  expect(chat.message).toMatchObject([{ role: 'user', chatId: 'm1' }, { role: 'char', data: '<Thoughts>\n\n반갑게 맞는다.\n\n</Thoughts>\n어서 와' }, { role: 'user' }]);

  const none = risuChat({ ...source, greeting: null }).chat;
  expect(none.fmIndex).toBe(-1);
  const all = JSON.parse(`${RISU_ALL_CHATS.head}${JSON.stringify(chat)},${JSON.stringify(none)}${RISU_ALL_CHATS.tail}`);
  expect([all.type, all.ver]).toEqual(['risuAllChats', 2]);
  expect(risuChatFile(all)!.chats.map(({ greeting }) => greeting)).toEqual([2, 0]);
});
