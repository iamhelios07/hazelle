import { describe, expect, it } from 'vitest';
import { fold, type Chat } from '../model/chat';
import { blankCard } from '../engine/import/card';
import { evaluateChat, scopeOf, setLoreBudget } from './chat-context';
import { appendUserMessage, startChat } from './chat-log';
import { addLore, setCharacterLoreBudget } from './lore';
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

describe('scopeOf', () => {
  it("holds the character's lorebook, then a saved chat's own, then the modules'", async () => {
    const { store } = await server.account();
    const module = await store.create('module', { name: '종', description: '', namespace: null, regex: [], triggers: [], toggles: '', loreFolders: [] });
    if (!module.ok) throw new Error(module.error);
    const character = await store.create('character', { card: blankCard('루나'), folder: null, loreFolders: [], modules: [module.data.id] });
    if (!character.ok) throw new Error(character.error);
    const id = crypto.randomUUID();
    const chat: Chat = { title: null, character: character.data.id, models: {}, loreFolders: [{ id: 'f', name: '장소' }] };
    await store.create('chat', chat, { id });
    for (const owner of [module.data.id, id, character.data.id]) await addLore(store, owner, null, crypto.randomUUID());
    const scope = scopeOf({ store }, id, chat, []);
    expect(scope.lore.map(({ parent }) => parent)).toEqual([character.data.id, id, module.data.id]);
    expect(scope.loreFolders).toEqual({ [id]: ['장소'] });
    expect(scopeOf({ store }, null, chat, []).lore.map(({ parent }) => parent)).toEqual([character.data.id, module.data.id]);
  });

  it("takes the character's own 로어북 최대 분량 over the account's", async () => {
    const { store } = await server.account();
    const card = blankCard('루나');
    const character = await store.create('character', { card: { ...card, loreSettings: { ...card.loreSettings, tokenBudget: 1500 } }, folder: null, loreFolders: [], modules: [] });
    if (!character.ok) throw new Error(character.error);
    await setLoreBudget(store, 70_000);
    const chat: Chat = { title: null, character: character.data.id, models: {} };
    expect(scopeOf({ store }, null, chat, []).loreBudget).toBe(1500);
    await setCharacterLoreBudget(store, character.data.id, null);
    expect(scopeOf({ store }, null, chat, []).loreBudget).toBe(70_000);
  });
});
