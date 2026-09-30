import { describe, expect, it } from 'vitest';
import type { Card } from '../engine/import/types';
import { fold, type Chat } from '../model/chat';
import { KINDS, type Kind } from '../model/kinds';
import type { Lore } from '../model/library';
import { randomBytes } from '../vault/aead';
import { exportBackup, readBackup, restoreBackup } from './backup';
import { addCharacter } from './characters';
import { appendUserMessage, removeChat, startChat } from './chat-log';
import { addFirstPersona } from './personas';
import { FIRST_PROFILE_ID, addFirstProfile, setProfileSettings } from './profiles';
import { addDefaults } from './prompts';
import type { ObjectStore } from './store';
import { testServer } from './testing';

const server = testServer();

const held = (store: ObjectStore) =>
  new Map((Object.keys(KINDS) as Kind[]).flatMap((kind) => store.list(kind)).map(({ id, kind, parent, value }) => [id, { kind, parent, value }]));

// What opening an account adds (runtime/session).
async function open(username: string, { profile = true } = {}) {
  const account = await server.account();
  await addDefaults(account.store);
  await addFirstPersona(account.store, username);
  if (profile) await addFirstProfile(account.store);
  return account;
}

async function oldAccount({ profile = true } = {}) {
  const { store, files } = await open('jin', { profile });
  if (profile) await setProfileSettings(store, FIRST_PROFILE_ID, { temperature: 0.4 });
  const image = randomBytes(256);
  const added = await addCharacter(store, files, { card: { name: '루나' } as Card, folder: null, loreFolders: [] }, [{ name: '등대' } as Lore], { bytes: image, type: 'image/png', thumb: 'data:thumb' }, () => {});
  const character = added.ok ? added.data : '';
  const chat = crypto.randomUUID();
  const opened: Chat = { title: null, character, models: {} };
  const greetings = { ids: [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()], texts: ['안녕', '반가워', '어서 와'], selected: 1, translations: new Map() };
  await startChat(store, chat, opened, greetings);
  await appendUserMessage(store, chat, { id: crypto.randomUUID(), text: '등대에 가자' });
  const gone = crypto.randomUUID();
  await startChat(store, gone, opened, null);
  await appendUserMessage(store, gone, { id: crypto.randomUUID(), text: '지울 채팅' });
  await removeChat(store, gone);
  await store.create('connection', { type: 'openrouter', label: 'OpenRouter', baseUrl: null, protocol: null, secret: 'sk-or-x', starred: [] });
  return { store, files, image, chat, gone };
}

describe('backup', () => {
  it('brings everything the old account reaches into a new one, keys and pictures included, with each chat as it was', async () => {
    const old = await oldAccount();
    const made = await exportBackup(old.store, old.files);
    const read = readBackup(made.ok ? made.data.zip : new Uint8Array());
    expect(read.ok).toBe(true);
    const expected = held(old.store);
    for (const [id, { parent }] of expected) if (parent === old.gone) expected.delete(id);

    await server.wipe();
    const { store, files } = await open('someone');
    expect(await restoreBackup(store, files, read.ok ? read.backup : { objects: [], files: new Map() }, () => {})).toEqual({ ok: true, data: null });

    expect(held(store)).toEqual(expected);
    expect(fold(store.children('entry', old.chat))).toEqual(fold(old.store.children('entry', old.chat)));
    const [avatar] = store.list('avatar');
    expect(await files.get(avatar!.id)).toEqual({ ok: true, data: old.image });
  });

  it('takes a backup from before 설정 묶음 into an account that opened with one', async () => {
    const old = await oldAccount({ profile: false });
    const made = await exportBackup(old.store, old.files);
    const read = readBackup(made.ok ? made.data.zip : new Uint8Array());

    await server.wipe();
    const { store, files } = await open('someone');
    expect(await restoreBackup(store, files, read.ok ? read.backup : { objects: [], files: new Map() }, () => {})).toEqual({ ok: true, data: null });
    const expected = held(old.store);
    for (const [id, { parent }] of expected) if (parent === old.gone) expected.delete(id);
    expect(held(store)).toEqual(expected);
  });

  it('refuses an account holding something of its own, and writes nothing', async () => {
    const old = await oldAccount();
    const made = await exportBackup(old.store, old.files);
    const read = readBackup(made.ok ? made.data.zip : new Uint8Array());

    await server.wipe();
    const { store, files } = await server.account();
    await store.create('persona', { name: '다른 사람', description: '', picture: null });
    const before = held(store);
    expect(await restoreBackup(store, files, read.ok ? read.backup : { objects: [], files: new Map() }, () => {})).toEqual({ ok: false, error: 'not-new' });
    expect(held(store)).toEqual(before);
  });
});
