import { describe, expect, it } from 'vitest';
import type { Lore } from '../model/library';
import { addCharacter } from './characters';
import { planRemoval } from './removal';
import { testCard, testServer } from './testing';

const server = testServer();

describe('planRemoval', () => {
  it('takes what a character owns first, its chats after their entries, and the character last', async () => {
    const { store } = await server.account();
    const character = (name: string) => ({ card: testCard(name), folder: null, loreFolders: [] });
    const avatar = { type: 'image/png', size: 8, thumb: 'data:thumb', file: { id: 'f'.repeat(64), key: 'k' } };
    const added = await addCharacter(store, character('루나'), { avatar, assets: [], lore: [{ name: '등대' } as Lore, { name: '항구' } as Lore] }, () => {});
    const other = await addCharacter(store, character('카엘'), { avatar: null, assets: [], lore: [] }, () => {});
    const id = added.ok ? added.data : '';
    const chat = async (owner: string | null, entries: number) => {
      const saved = await store.create('chat', { title: null, character: owner, models: {} });
      const chatId = saved.ok ? saved.data.id : '';
      await server.hold(store, chatId);
      for (let at = 0; at < entries; at++) await store.create('entry', { type: 'message', role: 'user', at, text: '안녕', receipt: null }, { parent: chatId });
      return chatId;
    };
    const chats = [await chat(id, 2), await chat(id, 1)];
    await chat(other.ok ? other.data : '', 1);
    await chat(null, 1);

    const owned = [...store.children('avatar', id), ...store.children('lore', id), ...chats.flatMap((chatId) => [...store.children('entry', chatId), ...store.children('summary', chatId)])].map((object) => object.id);
    const plan = await planRemoval(store, { kind: 'character', id });
    const rounds = plan.ok ? plan.data.map((round) => round.map((row) => row.id).toSorted()) : [];
    expect(rounds).toEqual([owned.toSorted(), chats.toSorted(), [id]]);
  });
});
