import { unzipSync, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import type { Card } from '../engine/import/types';
import { fold, type Chat } from '../model/chat';
import type { Lore } from '../model/library';
import { randomBytes } from '../vault/aead';
import { exportBackup, readBackup, restoreBackup } from './backup';
import type { Files } from './files';
import { editCharacter, importCharacter } from './characters';
import { appendUserMessage, removeChat, startChat } from './chat-log';
import { addFirstPersona } from './personas';
import { FIRST_PROFILE_ID, addFirstProfile, setProfileSettings } from './profiles';
import { addDefaults } from './prompts';
import type { ObjectStore } from './store';
import { testServer } from './testing';

const server = testServer();

const held = async (store: ObjectStore) => {
  const objects = new Map<string, { kind: string; parent: string | null; value: unknown }>();
  const failure = await store.scan({}, ({ id, kind, parent }, value) => {
    if (kind !== 'summary') objects.set(id, { kind, parent, value });
  });
  if (failure) throw new Error(failure.error);
  return objects;
};

// Whole bodies, since restore refuses any other.
const card: Card = {
  name: '루나',
  nickname: null,
  description: '',
  personality: '',
  scenario: '',
  greetings: [],
  exampleDialogue: '',
  systemPrompt: '',
  postHistoryInstructions: '',
  creatorNotes: '',
  creator: '',
  version: '',
  tags: [],
  variables: [],
  toggles: '',
  utility: false,
  bias: [],
  regex: [],
  triggers: [],
  loreSettings: { scanDepth: null, tokenBudget: null, recursive: null, fullWordMatching: null },
};
const lore: Lore = {
  name: '등대',
  keys: ['등대'],
  secondaryKeys: [],
  content: '',
  enabled: true,
  constant: false,
  selective: false,
  useRegex: false,
  caseSensitive: false,
  insertionOrder: 100,
  priority: null,
  position: null,
  folder: null,
};

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
  const smile = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, ...randomBytes(16)]);
  const assets = [
    { name: 'smile', read: async () => smile },
    { name: 'grin', read: async () => smile },
  ];
  const added = await importCharacter(store, files, { card, lore: [{ ...lore, folder: null }], loreFolders: [], assets }, { bytes: image, type: 'image/png', thumb: 'data:thumb' }, () => {});
  const character = added.ok ? added.data.id : '';
  const chat = crypto.randomUUID();
  await server.hold(store, chat);
  const opened: Chat = { title: null, character, models: {} };
  const greetings = { ids: [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()], texts: ['안녕', '반가워', '어서 와'], selected: 1, translations: new Map() };
  await startChat(store, chat, opened, greetings);
  await appendUserMessage(store, chat, { id: crypto.randomUUID(), text: '등대에 가자' });
  const gone = crypto.randomUUID();
  await startChat(store, gone, opened, null);
  await appendUserMessage(store, gone, { id: crypto.randomUUID(), text: '지울 채팅' });
  await removeChat(store, gone);
  await store.create('connection', { type: 'openrouter', label: 'OpenRouter', baseUrl: null, protocol: null, secret: 'sk-or-x', starred: [] });
  return { store, files, image, smile, chat, gone };
}

async function exported(store: Pick<ObjectStore, 'scan'>, files: Files) {
  const parts: BlobPart[] = [];
  const result = await exportBackup(store, files, {
    write: async (bytes) => { parts.push(bytes); },
    close: async () => {},
    abort: async () => { parts.length = 0; },
  });
  if (!result.ok) throw new Error(result.error);
  return new Blob(parts);
}

async function read(file: Blob) {
  const result = await readBackup(file);
  if (!result.ok) throw new Error(result.error);
  return result.backup;
}

describe('backup', () => {
  it('brings everything the old account reaches into a new one, keys and pictures included, with each chat as it was', async () => {
    const old = await oldAccount();
    const made = await exported(old.store, old.files);
    const backup = await read(made);
    const expected = await held(old.store);
    for (const [id, { parent }] of expected) if (parent === old.gone) expected.delete(id);

    await server.wipe();
    const { store, files } = await open('someone');
    expect(await restoreBackup(store, files, backup)).toEqual({ ok: true, data: { skipped: 0 } });

    expect(await held(store)).toEqual(expected);
    await server.hold(store, old.chat);
    expect(fold(store.children('entry', old.chat))).toEqual(fold(old.store.children('entry', old.chat)));
    const [avatar] = store.list('avatar');
    expect(await files.read(avatar!.value.file)).toEqual({ ok: true, data: old.image });
    const zipped = unzipSync(new Uint8Array(await made.arrayBuffer()));
    expect(Object.keys(zipped).filter((name) => name.startsWith('files/'))).toHaveLength(2);
  });

  it('restores the old zipSync format from before 설정 묶음 into an account that opened with one', async () => {
    const old = await oldAccount({ profile: false });
    const made = await exported(old.store, old.files);
    const classic = zipSync(unzipSync(new Uint8Array(await made.arrayBuffer())));
    const backup = await read(new Blob([classic]));

    const expected = await held(old.store);
    await server.wipe();
    const { store, files } = await open('someone');
    expect(await restoreBackup(store, files, backup)).toEqual({ ok: true, data: { skipped: 0 } });
    for (const [id, { parent }] of expected) if (parent === old.gone) expected.delete(id);
    expect(await held(store)).toEqual(expected);
  });

  it('writes an object edited on another device during the walk once, so its own importer reads the file', async () => {
    const { store, files, open } = await server.account();
    const created = await store.create('connection', { type: 'openrouter', label: 'a', baseUrl: null, protocol: null, secret: 'sk-or-x', starred: [] });
    if (!created.ok) throw new Error(created.error);
    // More than one feed page, so the walk asks again after the edit.
    await store.batch(Array.from({ length: 500 }, (_, index) => ({ type: 'create', kind: 'folder', id: crypto.randomUUID(), parent: null, value: { name: `${index}` } })));
    const other = await open();
    await other.pull();
    const editing: Pick<ObjectStore, 'scan'> = {
      scan: (options, visit) => store.scan(options, async (row, value) => {
        await visit(row, value);
        if (!options.metadata && row.id === created.data.id) await other.update('connection', row.id, (current) => ({ ...current, label: 'b' }));
      }),
    };

    const backup = await read(await exported(editing, files));
    expect(backup.objects.filter(({ id }) => id === created.data.id)).toHaveLength(1);
  }, 15_000);

  it('refuses a file whose picture was changed, before writing any object', async () => {
    const old = await oldAccount();
    const made = await exported(old.store, old.files);
    const entries = unzipSync(new Uint8Array(await made.arrayBuffer()));
    const id = Object.keys(entries).find((name) => name.startsWith('files/'))!;
    entries[id] = randomBytes(64);
    const backup = await read(new Blob([zipSync(entries)]));

    await server.wipe();
    const { store, files } = await open('someone');
    const before = await held(store);
    expect(await restoreBackup(store, files, backup)).toEqual({ ok: false, error: 'not-backup' });
    expect(await held(store)).toEqual(before);
  });

  it('refuses to carry on with another backup of the same account, whose ids it shares, and writes nothing', async () => {
    const old = await oldAccount();
    const first = await read(await exported(old.store, old.files));
    await editCharacter(old.store, old.store.list('character')[0]!.id, { name: '다른 루나' });
    const second = await read(await exported(old.store, old.files));

    await server.wipe();
    const { store, files } = await open('someone');
    expect(await restoreBackup(store, files, first)).toEqual({ ok: true, data: { skipped: 0 } });
    const before = await held(store);
    expect(await restoreBackup(store, files, second)).toEqual({ ok: false, error: 'not-new' });
    expect(await held(store)).toEqual(before);
  });

  it('refuses an account holding something of its own, and writes nothing', async () => {
    const old = await oldAccount();
    const made = await exported(old.store, old.files);
    const backup = await read(made);

    await server.wipe();
    const { store, files } = await server.account();
    await store.create('persona', { name: '다른 사람', description: '', picture: null });
    const before = await held(store);
    expect(await restoreBackup(store, files, backup)).toEqual({ ok: false, error: 'not-new' });
    expect(await held(store)).toEqual(before);
  });
});
