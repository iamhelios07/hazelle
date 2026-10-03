import { unzipSync, zipSync } from 'fflate';
import { describe, expect, it, vi } from 'vitest';
import type { Card } from '../engine/import/types';
import { fold, type Chat } from '../model/chat';
import type { Lore } from '../model/library';
import { randomBytes } from '../vault/aead';
import { exportBackup, readBackup, restoreBackup } from './testing/backup';
import type { Files } from './files';
import { editCharacter, importCharacter, setDeleted } from './characters';
import { appendUserMessage, removeChat, startChat } from './chat-log';
import { projectGreetings } from './greetings';
import { addFirstPersona } from './personas';
import { FIRST_PROFILE_ID, addFirstProfile, setProfileSettings } from './profiles';
import { addDefaults, addPrompt, removePrompt } from './prompts';
import type { ObjectStore, Write } from './store';
import { summaryId, summaryStale } from './summary';
import { testServer } from './testing';

const server = testServer();
vi.mock('./picture', () => ({ thumbnail: async () => 'data:thumb' }));

const held = async (store: ObjectStore) => {
  const objects = new Map<string, { kind: string; parent: string | null; value: unknown }>();
  const pin = await store.pin();
  if (!pin.ok) throw new Error(pin.error);
  const failure = await store.scan({}, ({ id, kind, parent }, value) => {
    if (kind !== 'summary') objects.set(id, { kind, parent, value });
  }, pin.data);
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
  const added = await importCharacter(store, files, { card, lore: [{ ...lore, folder: null }], loreFolders: [], assets }, { bytes: image, type: 'image/png' }, () => {});
  const character = added.ok ? added.data.id : '';
  const chat = crypto.randomUUID();
  await server.hold(store, chat);
  const opened: Chat = { title: null, character, models: {} };
  const greetings = projectGreetings(['안녕', '반가워', '어서 와'], [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()], 1);
  await startChat(store, chat, opened, greetings);
  await appendUserMessage(store, chat, { id: crypto.randomUUID(), text: '등대에 가자' });
  const gone = crypto.randomUUID();
  await startChat(store, gone, opened, null);
  await appendUserMessage(store, gone, { id: crypto.randomUUID(), text: '지울 채팅' });
  await removeChat(store, gone);
  await store.create('connection', { type: 'openrouter', label: 'OpenRouter', baseUrl: null, protocol: null, secret: 'sk-or-x', starred: [] });
  return { store, files, image, smile, chat, gone };
}

async function exported(store: Pick<ObjectStore, 'scan' | 'pin' | 'list'>, files: Files) {
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
    for (const [id, { parent }] of expected) if (id === old.gone || parent === old.gone) expected.delete(id);

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

  it('restores root pages unheld and resumes a stopped one-chat summary pass without retaining histories', async () => {
    const old = await open('old');
    const chats = Array.from({ length: 130 }, () => crypto.randomUUID());
    const writes = chats.flatMap((id): Write[] => [
      { type: 'create', id: crypto.randomUUID(), kind: 'entry', parent: id, value: { type: 'message', role: 'user', at: 1, text: id, receipt: null } },
      { type: 'create', id, kind: 'chat', parent: null, value: { title: null, character: null, models: {} } },
    ]);
    expect((await old.store.batch(writes, undefined, { unheld: true })).ok).toBe(true);
    const backup = await read(await exported(old.store, old.files));
    await server.wipe();
    const { store, files } = await open('new');
    const held = new Map<string, number>();
    const retained: string[] = [];
    let peak = 0;
    const retain = store.retainChat.bind(store);
    vi.spyOn(store, 'retainChat').mockImplementation((id, created) => {
      retained.push(id);
      const lease = retain(id, created);
      held.set(id, (held.get(id) ?? 0) + 1);
      peak = Math.max(peak, held.size);
      let released = false;
      return { ready: lease.ready, release: () => {
        if (released) return;
        released = true;
        const count = held.get(id)! - 1;
        if (count) held.set(id, count); else held.delete(id);
        lease.release();
      } };
    });
    const stop = new AbortController();
    const save = store.saveSummary.bind(store);
    const summary = vi.spyOn(store, 'saveSummary').mockImplementation(async (id) => {
      const result = await save(id);
      stop.abort();
      return result;
    });
    expect(await restoreBackup(store, files, backup, { signal: stop.signal })).toEqual({ ok: false, error: 'stopped' });
    summary.mockRestore();
    const summarized = new Set<string>(chats.filter((id) => store.get('summary', summaryId(id))));
    expect(summarized.size).toBeGreaterThan(0);
    retained.length = 0;
    expect(await restoreBackup(store, files, backup)).toEqual({ ok: true, data: { skipped: 0 } });
    expect(retained.filter((id) => summarized.has(id))).toEqual([]);
    expect(peak).toBe(1);
    expect(held.size).toBe(0);
    for (const id of chats) {
      expect(store.scopeState(id)).toBe('unloaded');
      const summary = store.get('summary', summaryId(id))!.value;
      expect(summary).toMatchObject({ count: 1, preview: id });
      expect(summaryStale(store, id, summary)).toBe(false);
    }
  }, 60_000);

  it('leaves out what is in 휴지통: a deleted character with its chat and picture, and a deleted prompt', async () => {
    const old = await oldAccount();
    const added = await importCharacter(old.store, old.files, { card, lore: [], loreFolders: [], assets: [] }, { bytes: old.image, type: 'image/png' }, () => {});
    const binned = added.ok ? added.data.id : '';
    const chat = crypto.randomUUID();
    await server.hold(old.store, chat);
    await startChat(old.store, chat, { title: null, character: binned, models: {} }, null);
    await appendUserMessage(old.store, chat, { id: crypto.randomUUID(), text: '같이 가는 채팅' });
    await setDeleted(old.store, binned, Date.now());
    const prompt = await addPrompt(old.store, '지운 프롬프트', 'conversation');
    await removePrompt(old.store, prompt.ok ? prompt.data.id : '');
    const backup = await read(await exported(old.store, old.files));
    const expected = await held(old.store);
    const out = new Set([old.gone, binned, chat, prompt.ok ? prompt.data.id : '']);
    for (const [id, { parent }] of expected) if (out.has(id) || (parent !== null && out.has(parent))) expected.delete(id);
    expect(expected.has(old.chat)).toBe(true);

    await server.wipe();
    const { store, files } = await open('someone');
    expect(await restoreBackup(store, files, backup)).toEqual({ ok: true, data: { skipped: 0 } });
    expect(await held(store)).toEqual(expected);
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
    for (const [id, { parent }] of expected) if (id === old.gone || parent === old.gone) expected.delete(id);
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
    const editing: Pick<ObjectStore, 'scan' | 'pin' | 'list'> = {
      pin: () => store.pin(),
      list: (kind) => store.list(kind),
      scan: (options, visit, pin) => store.scan(options, async (row, value) => {
        await visit(row, value);
        if (!options.metadata && row.id === created.data.id) await other.update('connection', row.id, (current) => ({ ...current, label: 'b' }));
      }, pin),
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
