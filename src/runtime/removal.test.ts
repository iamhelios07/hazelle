import { describe, expect, it } from 'vitest';
import type { Card } from '../engine/import/types';
import type { Lore } from '../model/library';
import { randomBytes } from '../vault/aead';
import { addCharacter } from './characters';
import { planRemoval } from './removal';
import { testServer } from './testing';

const server = testServer();

describe('planRemoval', () => {
  it('takes a character’s picture file first, then what it owns, its chats after their entries, and the character last', async () => {
    const { store, files } = await server.account();
    const character = (name: string) => ({ card: { name } as Card, folder: null, loreFolders: [] });
    const added = await addCharacter(store, files, character('루나'), [{ name: '등대' } as Lore, { name: '항구' } as Lore], { bytes: randomBytes(8), type: 'image/png', thumb: 'data:thumb' }, () => {});
    const other = await addCharacter(store, files, character('카엘'), [], null, () => {});
    const id = added.ok ? added.data : '';
    const chat = async (owner: string | null, entries: number) => {
      const saved = await store.create('chat', { title: null, character: owner, models: {} });
      const chatId = saved.ok ? saved.data.id : '';
      for (let at = 0; at < entries; at++) await store.create('entry', { type: 'message', role: 'user', at, text: '안녕', receipt: null }, { parent: chatId });
      return chatId;
    };
    const chats = [await chat(id, 2), await chat(id, 1)];
    await chat(other.ok ? other.data : '', 1);
    await chat(null, 1);

    const avatar = store.children('avatar', id)[0]!.id;
    const owned = [...store.children('lore', id), ...chats.flatMap((chatId) => store.children('entry', chatId))].map((object) => object.id);
    const rounds = planRemoval(store, { kind: 'character', id }).map((round) => round.map(({ from, id }) => `${from}:${id}`).sort());
    const inStore = (ids: string[]) => ids.map((object) => `store:${object}`).sort();
    expect(rounds).toEqual([[`files:${avatar}`], inStore([...owned, avatar]), inStore(chats), inStore([id])]);
  });
});
