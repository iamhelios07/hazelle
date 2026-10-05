import { describe, expect, it } from 'vitest';
import { setChatPersona } from './chat-log';
import { addFirstPersona, addPersona, chatPersona, pinPersona, removePersona, restorePersona, setDefaultPersona } from './personas';
import { testCard, testServer } from './testing';

const server = testServer();

describe('personas', () => {
  it('gives a chat the first persona, named after the username, then the default, refuses to delete the default, and reads a deleted persona of its own as missing', async () => {
    const { store } = await server.account();
    const [first, second] = await Promise.all([addPersona(store, { name: '진', description: '여행자', picture: null }), addPersona(store, { name: '린', description: '학자', picture: null })]);
    const [jin, rin] = [first, second].map((added) => (added.ok ? added.data.id : ''));
    const created = await store.create('chat', { title: null, character: null, models: {} });
    const chat = created.ok ? created.data.id : '';
    const read = () => store.get('chat', chat)!.value;

    expect(chatPersona(store, read())).toEqual({ kind: 'missing', from: 'default' });
    await addFirstPersona(store, 'jin');
    expect(chatPersona(store, read())).toMatchObject({ kind: 'persona', from: 'default', persona: { value: { name: 'jin', description: '' } } });
    await setDefaultPersona(store, jin!);
    expect(chatPersona(store, read())).toMatchObject({ kind: 'persona', from: 'default', persona: { id: jin } });
    expect(await removePersona(store, jin!)).toEqual({ ok: false, error: 'default' });

    await setChatPersona(store, chat, rin!);
    const removed = await removePersona(store, rin!);
    expect(chatPersona(store, read())).toEqual({ kind: 'missing', from: 'chat' });
    expect(removed.ok && store.get('persona', rin!)?.value.deleted).toEqual(expect.any(Number));
    await restorePersona(store, rin!);
    expect(chatPersona(store, read())).toMatchObject({ kind: 'persona', from: 'chat', persona: { id: rin } });
  });

  it('gives a chat its character’s 고정 over the default, under the chat’s own pick, and reads a deleted 고정 as missing', async () => {
    const { store } = await server.account();
    const [first, second] = await Promise.all([addPersona(store, { name: '진', description: '', picture: null }), addPersona(store, { name: '린', description: '', picture: null })]);
    const [jin, rin] = [first, second].map((added) => (added.ok ? added.data.id : ''));
    await setDefaultPersona(store, jin!);
    const character = await store.create('character', { card: testCard('루나'), folder: null, loreFolders: [] });
    const luna = character.ok ? character.data.id : '';
    const created = await store.create('chat', { title: null, character: luna, models: {} });
    const chat = created.ok ? created.data.id : '';
    const read = () => store.get('chat', chat)!.value;

    await pinPersona(store, luna, rin!);
    expect(chatPersona(store, read())).toMatchObject({ kind: 'persona', from: 'character', persona: { id: rin } });
    await setChatPersona(store, chat, jin!);
    expect(chatPersona(store, read())).toMatchObject({ kind: 'persona', from: 'chat', persona: { id: jin } });
    await setChatPersona(store, chat, null);
    await removePersona(store, rin!);
    expect(chatPersona(store, read())).toEqual({ kind: 'missing', from: 'character' });
    await pinPersona(store, luna, null);
    expect(chatPersona(store, read())).toMatchObject({ kind: 'persona', from: 'default', persona: { id: jin } });
  });
});
