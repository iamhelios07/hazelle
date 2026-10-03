import { describe, expect, it, vi } from 'vitest';
import type { Card, ImportedModule, RisuBackup, RisuCharacter, RisuPersona, RisuPreset } from '../engine/import/types';
import { fold, shown } from '../model/chat';
import { randomBytes } from '../vault/aead';
import { importCharacter } from './characters';
import { MEMORY_DEFAULTS } from './memory';
import { broughtFromRisu, fillPictures, moveFromRisu, risuMatch } from './move';
import { setModuleAlways } from './modules';
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
  modules: [],
  missed: [],
};

const bell: ImportedModule = {
  name: 'Bell',
  description: '',
  namespace: null,
  risu: 'risu-bell',
  pack: { regex: [], triggers: [], toggles: '' },
  lore: [],
  loreFolders: [],
  assets: [
    { name: 'ring', read: async () => png() },
    { name: 'notes', read: async () => randomBytes(8) },
  ],
  unsupported: [],
};

function source({ characters, personas = [], presets = [], modules = [], alwaysModules = [] }: { characters: RisuCharacter[]; personas?: RisuPersona[]; presets?: RisuPreset[]; modules?: ImportedModule[]; alwaysModules?: string[] }): RisuBackup {
  return {
    catalog: {
      pictures: 0,
      characters: characters.map((character, key) => ({ key, id: character.id, name: character.card.name, chatCount: character.chats.length, assetCount: character.assets.length, lastTalk: character.chats.reduce((at, chat) => Math.max(at, chat.messages.at(-1)?.at ?? 0), 0) })),
      personas: personas.map(({ name, alias }, key) => ({ key, name, alias })),
      presets: presets.map(({ name, result }, key) => ({ key, name, failure: result.ok ? null : result.failure.kind })),
      modules: modules.map(({ name, risu, assets }, key) => ({ key, name, risu, assetCount: assets.length })),
      alwaysModules, unsupported: [],
    },
    character: vi.fn(async (key) => characters[key]!),
    persona: async (key) => personas[key]!,
    preset: async (key) => presets[key]!,
    module: async (key) => modules[key]!,
  };
}

describe('moveFromRisu', () => {
  it('brings a character whole, its chat on the greeting Risu showed with its messages staged and its persona, and a second run skips it', async () => {
    const { store, files } = await server.account();
    const backup = source({ characters: [luna, { ...luna, id: 'unselected' }], personas: [{ id: 'risu-jin', name: '진', alias: '부자', description: '여행자', picture: async () => null }] });
    const pick = { ...backup.catalog, characters: [backup.catalog.characters[0]!] };
    const moved = await moveFromRisu(store, files, backup, pick, () => {});
    expect(moved).toMatchObject({ ok: true, data: { personas: 1, prompts: 0, modules: [], characters: [{ risu: 'risu-luna', name: '루나', chats: 1 }] } });
    const id = moved.ok ? moved.data.characters[0]!.id : '';
    const [folder] = store.list('folder');
    expect(store.get('character', id)!.value).toMatchObject({ risu: 'risu-luna', folder: folder!.id });
    expect(store.get('character', id)!.value).not.toHaveProperty('modules');
    expect(folder!.value).toEqual({ name: '모험' });

    const [chat] = store.list('chat');
    const jin = store.list('persona').find(({ value }) => value.name === '진' && value.alias === '부자')!.id;
    expect(chat!.value).toEqual({ title: '등대', character: id, models: {}, memory: { ...MEMORY_DEFAULTS, on: false }, note: '비가 온다', persona: jin, variables: [['hp', '7']] });
    await server.hold(store, chat!.id);
    const messages = fold(store.children('entry', chat!.id));
    expect(messages.map((message) => [message.role, shown(message).text, shown(message).staged])).toEqual([
      ['assistant', '둘째 인사', undefined],
      ['user', '안녕', true],
      ['assistant', '반가워 [HP 7]', true],
    ]);
    expect(messages[0]!.versions).toHaveLength(3);
    expect(shown(messages[0]!).greeting).toBe(2);
    expect(risuMatch(store, '루나')).toBe(id);

    expect(await moveFromRisu(store, files, backup, { ...pick, personas: [] }, () => {})).toEqual({ ok: true, data: { characters: [], personas: 0, prompts: 0, modules: [] } });
    expect(backup.character).toHaveBeenCalledExactlyOnceWith(0);
    expect(store.list('character')).toHaveLength(1);
    expect(broughtFromRisu(store)).toEqual(new Set(['risu-luna']));
  });

  it('writes what was talked in last last, so the lists open on it', async () => {
    const { store, files } = await server.account();
    const chatAt = (title: string, at: number) => ({ ...luna.chats[0]!, title, messages: [{ role: 'user' as const, text: title, at }] });
    const recent = { ...luna, id: 'risu-recent', chats: [chatAt('어제', 20), chatAt('작년', 5)] };
    const old = { ...luna, id: 'risu-old', chats: [chatAt('옛날', 1)] };
    const backup = source({ characters: [recent, old] });
    await moveFromRisu(store, files, backup, backup.catalog, () => {});
    expect(store.list('chat').sort((a, b) => a.rev - b.rev).map(({ value }) => value.title)).toEqual(['옛날', '작년', '어제']);
  });

  it('brings a module before the character it is on for, on where Risu had it on, and a second run brings neither again nor turns 항상 back on', async () => {
    const { store, files } = await server.account();
    const characters = [{ ...luna, modules: ['risu-bell', 'risu-gone'] }];
    const backup = source({ characters, modules: [bell], alwaysModules: ['risu-bell', 'risu-gone'] });
    const moved = await moveFromRisu(store, files, backup, backup.catalog, () => {});
    expect(moved).toMatchObject({ ok: true, data: { modules: [{ name: bell.name, unsupported: bell.unsupported, skipped: 1 }], characters: [{ risu: 'risu-luna' }] } });
    const [module] = store.list('module');
    expect(module!.value).toMatchObject({ name: 'Bell', risu: 'risu-bell' });
    expect(store.children('asset', module!.id).map(({ value }) => value.name)).toEqual(['ring']);
    expect(store.list('settings')[0]!.value.modules).toEqual([module!.id]);
    const [character] = store.list('character');
    expect(character!.value.modules).toEqual([module!.id]);

    await setModuleAlways(store, module!.id, false);
    const next = source({ characters: [...characters, { ...luna, id: 'risu-sol', modules: ['risu-bell'] }], modules: [bell], alwaysModules: backup.catalog.alwaysModules });
    expect(await moveFromRisu(store, files, next, next.catalog, () => {})).toMatchObject({ ok: true, data: { modules: [], characters: [{ risu: 'risu-sol' }] } });
    expect(store.list('module')).toHaveLength(1);
    expect(store.list('settings')[0]!.value.modules).toEqual([]);
    expect(store.list('character').find(({ value }) => value.risu === 'risu-sol')!.value.modules).toEqual([module!.id]);
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
