import { describe, expect, it } from 'vitest';
import type { Card, RisuCharacter } from '../engine/import/types';
import { fold, shown } from '../model/chat';
import { randomBytes } from '../vault/aead';
import { importCharacter } from './characters';
import { MEMORY_DEFAULTS } from './memory';
import { broughtFromRisu, fillPictures, moveFromRisu, risuMatch, type MovePick } from './move';
import { testCard, testServer } from './testing';

const server = testServer();

const png = () => new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, ...randomBytes(16)]);

const luna: RisuCharacter = {
  id: 'risu-luna',
  card: { ...testCard('루나'), greetings: ['', '첫 인사', '둘째 인사'] },
  lore: [],
  loreFolders: [],
  assets: [],
  report: { format: 'json', spec: 'v3', unsupported: [] },
  avatar: async () => null,
  folder: '모험',
  chats: [
    {
      title: '등대',
      note: '비가 온다',
      persona: 'risu-jin',
      greeting: 2,
      variables: [['hp', '7']],
      messages: [
        { role: 'user', text: '안녕', at: 1 },
        { role: 'assistant', text: '반가워 [HP 7]', at: 2 },
      ],
    },
  ],
  missed: [],
};

describe('moveFromRisu', () => {
  it('brings a character whole, its chat on the greeting Risu showed with its messages staged and its persona, and a second run skips it', async () => {
    const { store, files } = await server.account();
    const pick: MovePick = { characters: [luna], personas: [{ id: 'risu-jin', name: '진', description: '여행자', picture: async () => null }], presets: [] };
    const moved = await moveFromRisu(store, files, pick, () => {});
    expect(moved).toMatchObject({ ok: true, data: { personas: 1, prompts: 0, characters: [{ risu: 'risu-luna', name: '루나', chats: 1 }] } });
    const id = moved.ok ? moved.data.characters[0]!.id : '';
    const [folder] = store.list('folder');
    expect(store.get('character', id)!.value).toMatchObject({ risu: 'risu-luna', folder: folder!.id });
    expect(folder!.value).toEqual({ name: '모험' });

    const [chat] = store.list('chat');
    const jin = store.list('persona').find(({ value }) => value.name === '진')!.id;
    expect(chat!.value).toEqual({ title: '등대', character: id, models: {}, memory: { ...MEMORY_DEFAULTS, on: false }, note: '비가 온다', persona: jin, variables: [['hp', '7']] });
    await server.hold(store, chat!.id);
    const messages = fold(store.children('entry', chat!.id));
    expect(messages.map((message) => [message.role, shown(message).text, shown(message).staged])).toEqual([
      ['assistant', '둘째 인사', undefined],
      ['user', '안녕', true],
      ['assistant', '반가워 [HP 7]', true],
    ]);
    expect(messages[0]!.versions).toHaveLength(2);
    expect(risuMatch(store, '루나')).toBe(id);

    expect(await moveFromRisu(store, files, { ...pick, personas: [] }, () => {})).toEqual({ ok: true, data: { characters: [], personas: 0, prompts: 0 } });
    expect(store.list('character')).toHaveLength(1);
    expect(broughtFromRisu(store)).toEqual(new Set(['risu-luna']));
  });
});

describe('fillPictures', () => {
  it('adds the pictures of names the character does not have, and counts the ones that are not pictures', async () => {
    const { store, files } = await server.account();
    const added = await importCharacter(store, files, { card: { name: '루나' } as Card, lore: [], loreFolders: [], assets: [{ name: 'smile', read: async () => png() }] }, null, () => {});
    const id = added.ok ? added.data.id : '';
    const [smile] = store.children('asset', id);
    const assets = [
      { name: 'smile', read: async () => png() },
      { name: 'wave', read: async () => png() },
      { name: 'notes', read: async () => randomBytes(8) },
    ];
    expect(await fillPictures(store, files, id, assets)).toEqual({ ok: true, data: { kept: 1, skipped: 1 } });
    expect(store.children('asset', id).map(({ value }) => value.name).sort()).toEqual(['smile', 'wave']);
    expect(store.children('asset', id).find(({ value }) => value.name === 'smile')).toEqual(smile);
  });
});
