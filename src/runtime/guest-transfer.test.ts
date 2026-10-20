import 'fake-indexeddb/auto';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { unzipSync } from 'fflate';
import { blankCard } from '../engine/import/card';
import { BATCH_LIMITS } from '../contracts/objects';
import { SETTINGS_ID } from '../model/settings';
import { ORDER_ID } from '../model/order';
import { addPrompt, STARTER_ID } from './prompts';
import { FIRST_ID } from './personas';
import { FIRST_PROFILE_ID } from './profiles';
import { memoryId } from '../model/memory';
import { testApp, sessionCookie, signupBody, testConnection } from './testing';
import { randomBytes } from '../vault/aead';
import { lockVault, recallGuest, recallVault, rememberVault } from '../vault/device';
import { createVault, openVault, passwordCredential, recoveryCredential } from '../vault/keys';
import { objectKey, openObject } from '../vault/objects';
import { logIn, prepareGuestSignup, signUp, signUpGuest, uploadGuest } from './account';
import { holdAccount } from './api';
import { feedQuery, serverBackend } from './backend';
import { deviceCache } from './device-cache';
import { Files } from './files';
import { guestAccount, guestBackend } from './guest-store';
import { discardGuest, guestWithContent, transferGuest } from './guest-transfer';
import { openSession } from './session';
import { ObjectStore } from './store';
import { exportBackup, readBackup, restoreBackup } from './testing/backup';
import type { BackupOutput } from './backup-zip';
import { toolChatId, toolDataId } from './tools/store';

let app: Awaited<ReturnType<typeof testApp>>;
let password: Awaited<ReturnType<typeof passwordCredential>>;
let cookie: string | null = null;
let dropBatches = false;
const stores: ObjectStore[] = [];
beforeAll(async () => {
  app = await testApp();
  password = await passwordCredential('tester', 'a password');
});
afterAll(() => app.dispose());
beforeEach(async () => {
  await app.reset();
  holdAccount(null);
  cookie = null;
  dropBatches = false;
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('document', { visibilityState: 'hidden' });
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const path = url.slice('/api/'.length);
    const response = await app.raw(path, { ...init, headers: { ...(init.headers as Record<string, string>), ...(cookie && { cookie }) } });
    if (response.headers.has('set-cookie')) cookie = sessionCookie(response);
    if (dropBatches && path === 'objects/batch') throw new TypeError('Lost upload answer');
    return response;
  });
});
afterEach(async () => {
  for (const store of stores.splice(0)) store.close();
  await discardGuest();
  await lockVault();
  vi.unstubAllGlobals();
});

async function guest() {
  const account = await guestAccount();
  const backend = guestBackend(account.accountId);
  const store = await ObjectStore.open(account.accountId, account.vaultKey, backend);
  stores.push(store);
  expect(await store.pull()).toBeNull();
  return { ...account, backend, store, files: new Files(backend, store) };
}

async function contents() {
  const held = await guest();
  const character = crypto.randomUUID();
  const chat = crypto.randomUUID();
  const message = crypto.randomUUID();
  const image = randomBytes(256);
  const saved = await held.files.save([image]);
  if (!saved.ok || !saved.data[0]) throw new Error('Picture failed');
  const ref = saved.data[0];
  const written = await held.store.batch([
    { type: 'create', kind: 'character', id: character, parent: null, value: { card: blankCard('Guest bot'), folder: null, loreFolders: [], persona: FIRST_ID } },
    { type: 'create', kind: 'persona', id: FIRST_ID, parent: null, value: { name: 'Guest persona', description: 'Only here', picture: null } },
    { type: 'create', kind: 'chat', id: chat, parent: null, value: { character, title: 'A chat', models: {}, persona: FIRST_ID } },
    { type: 'create', kind: 'entry', id: message, parent: chat, value: { type: 'message', role: 'user', text: 'Hello', at: 1, receipt: null, follows: null } },
    { type: 'create', kind: 'avatar', id: crypto.randomUUID(), parent: character, value: { type: 'image/png', size: image.length, thumb: 'thumb', file: ref } },
  ], undefined, { unheld: true });
  expect(written.ok).toBe(true);
  await held.store.upsert('settings', () => ({ models: {}, persona: FIRST_ID }));
  return { ...held, character, chat, message, image, ref };
}

it('does not ask about a guest that holds only the first open’s defaults', async () => {
  const { accountId, vaultKey, backend } = await guest();
  const opened = await openSession(accountId, vaultKey, '손님', new AbortController().signal, undefined, { backend });
  if (!opened.ok) throw new Error(opened.error);
  opened.data.close();
  expect(await guestWithContent()).toEqual({ ok: true, data: null });
});

it('keeps account-bound seals and content-sealed pictures unchanged, clears the device cache, and opens a fresh account session', async () => {
  const source = await contents();
  const before = await source.backend.feed(feedQuery({ since: 0, timeline: null }));
  if (!before.ok) throw new Error(before.error);
  const row = before.data.changes.find(({ kind }) => kind === 'character')!;
  const key = await objectKey(source.vaultKey);
  expect(await openObject(key, crypto.randomUUID(), row, row.body!)).toBeUndefined();
  const cache = deviceCache(source.accountId);
  const { generation } = await cache.open();
  const adopted = await cache.adopt(generation, 'guest-era');
  await cache.write(adopted, { changes: before.data.changes, feed: { cursor: 999, complete: true, until: null, limits: BATCH_LIMITS, heads: [], revisions: [] } });
  const draft = await prepareGuestSignup('tester', password);
  const recovered = (await recoveryCredential(draft.recoveryKey))!;
  expect(await openVault(source.accountId, draft.signup, recovered)).toEqual(source.vaultKey);
  const progress: unknown[] = [];
  expect((await signUpGuest(draft, { progress: (step) => progress.push(step) })).ok).toBe(true);
  expect(progress).toContainEqual({ kind: 'objects', done: before.data.changes.length, total: before.data.changes.length });
  expect(await recallGuest()).toBeNull();
  expect(await recallVault(source.accountId)).toEqual(source.vaultKey);
  expect((await cache.open()).saved).toBeNull();
  const uploaded = await serverBackend().feed(feedQuery({ since: 0, timeline: null }));
  expect(uploaded.ok && uploaded.data.changes.map(({ id, body }) => ({ id, body }))).toEqual(before.data.changes.map(({ id, body }) => ({ id, body })));
  const opened = await openSession(source.accountId, source.vaultKey, 'tester', new AbortController().signal);
  if (!opened.ok) throw new Error(opened.error);
  try {
    expect(opened.data.store.get('character', source.character)?.value.card.name).toBe('Guest bot');
    const lease = opened.data.store.retainChat(source.chat);
    expect(await lease.ready).toBeNull();
    expect(opened.data.store.children('entry', source.chat)[0]?.value).toMatchObject({ text: 'Hello' });
    lease.release();
    expect(await opened.data.files.read(source.ref)).toEqual({ ok: true, data: source.image });
  } finally { opened.data.close(); }
  const emptied = await source.backend.feed(feedQuery({ since: 0, timeline: null }));
  expect(emptied.ok && emptied.data.changes).toEqual([]);
  expect(await source.backend.readFile(source.ref.id)).toEqual({ ok: false, error: 'not-found' });
});

it('resumes lost batch answers through repeated signup and normal sign-in without duplicate objects or a different recovery key', async () => {
  const source = await guest();
  expect((await source.store.batch(Array.from({ length: 620 }, (_, index) => ({ type: 'create' as const, kind: 'persona' as const, id: crypto.randomUUID(), parent: null, value: { name: `Person ${index}`, description: '', picture: null } })))).ok).toBe(true);
  const draft = await prepareGuestSignup('tester', password);
  dropBatches = true;
  expect(await signUpGuest(draft)).toMatchObject({ ok: false, error: 'offline' });
  expect(await recallGuest()).toEqual({ accountId: source.accountId, vaultKey: source.vaultKey });
  const again = await prepareGuestSignup('tester', password);
  expect(again.recoveryKey).toBe(draft.recoveryKey);
  expect(await signUpGuest(again)).toMatchObject({ ok: false, error: 'offline' });
  dropBatches = false;
  const signedIn = await logIn('tester', password);
  expect(signedIn.ok).toBe(true);
  if (!signedIn.ok) throw new Error(signedIn.error);
  expect(await openVault(source.accountId, signedIn.data.vault, (await recoveryCredential(again.recoveryKey))!)).toEqual(source.vaultKey);
  expect(await recallGuest()).toBeNull();
  const fresh = await ObjectStore.open(source.accountId, source.vaultKey, serverBackend());
  stores.push(fresh);
  expect(await fresh.pull()).toBeNull();
  expect(fresh.list('persona')).toHaveLength(620);
  expect(await app.env.db.prepare('SELECT COUNT(*) AS count FROM accounts').first('count')).toBe(1);
});

it('refuses a full signup cap without changing guest content, pictures or its vault mark', async () => {
  const source = await contents();
  const draft = await prepareGuestSignup('tester', password);
  const before = await source.backend.feed(feedQuery({ since: 0, timeline: null }));
  await app.env.db.prepare('UPDATE service SET signup_cap = 0').run();
  expect(await signUpGuest(draft)).toEqual({ ok: false, error: 'signup-closed' });
  expect(await source.backend.feed(feedQuery({ since: 0, timeline: null }))).toEqual(before);
  expect(await source.files.read(source.ref)).toEqual({ ok: true, data: source.image });
  expect(await recallGuest()).toEqual({ accountId: source.accountId, vaultKey: source.vaultKey });
});

it('keeps guest ids, copies edited seeded prompts with their references, and retries without changing account items or picture seals', async () => {
  const source = await contents();
  expect((await addPrompt(source.store, 'Guest starter', 'conversation', STARTER_ID)).ok).toBe(true);
  await source.store.update('prompt', STARTER_ID, (current) => ({ ...current, authorNote: 'Guest edited instructions' }));
  await source.store.update('chat', source.chat, (current) => ({ ...current, prompt: STARTER_ID }));
  await source.store.upsert('order', () => ({ ids: [source.character] }));
  const sealedPicture = await source.backend.readFile(source.ref.id);
  const module = crypto.randomUUID();
  const providerModel = crypto.randomUUID();
  const connectionAccount = crypto.randomUUID();
  const group = crypto.randomUUID();
  await source.store.batch([
    { type: 'create', kind: 'connection', id: crypto.randomUUID(), parent: null, value: { ...testConnection, accounts: [{ id: connectionAccount, secret: 'synthetic' }], turns: { day: 1, groups: [{ id: group, name: 'one', accounts: [connectionAccount] }], anchor: { group, cycle: 0 } }, starred: [{ ...testConnection.starred[0]!, id: providerModel, profile: FIRST_PROFILE_ID }] } },
    { type: 'create', kind: 'profile', id: FIRST_PROFILE_ID, parent: null, value: { name: 'Guest profile', settings: {} } },
    { type: 'create', kind: 'memory', id: memoryId(source.chat), parent: source.chat, value: { records: [], chapters: [], state: [], threads: [] } },
    { type: 'create', kind: 'module', id: module, parent: null, value: { name: 'Tool', description: '', namespace: null, loreFolders: [], toggles: [], regex: [], triggers: [] } },
    { type: 'create', kind: 'tooldata', id: await toolDataId(module, 'key'), parent: module, value: { key: 'key', value: { message: source.message, nested: [{ unrecognized: STARTER_ID }, FIRST_PROFILE_ID, SETTINGS_ID] } } },
    { type: 'create', kind: 'toolchat', id: await toolChatId(module, source.chat, null), parent: source.chat, value: { module, key: null, value: { [source.message]: { version: source.message, text: source.message } } } },
  ], undefined, { unheld: true });
  const accountId = crypto.randomUUID();
  const account = await createVault(accountId, password);
  expect((await signUp({ accountId, username: 'tester', ...account.signup })).ok).toBe(true);
  holdAccount(accountId);
  await rememberVault(accountId, account.vaultKey);
  expect((await logIn('tester', password)).ok).toBe(true);
  expect(await guestWithContent()).toEqual({ ok: true, data: { accountId: source.accountId, vaultKey: source.vaultKey } });
  const target = await ObjectStore.open(accountId, account.vaultKey, serverBackend());
  stores.push(target);
  await target.pull();
  await target.upsert('settings', () => ({ models: {}, persona: FIRST_ID, prompt: STARTER_ID, translatorNote: 'Account preference' }));
  await target.create('persona', { name: 'Account persona', description: '', picture: null }, { id: FIRST_ID });
  await target.create('profile', { name: 'Account profile', settings: {} }, { id: FIRST_PROFILE_ID });
  await addPrompt(target, 'Account starter', 'conversation', STARTER_ID);
  const accountCharacter = crypto.randomUUID();
  await target.create('character', { card: blankCard('Account bot'), folder: null, loreFolders: [] }, { id: accountCharacter });
  await target.upsert('order', () => ({ ids: [accountCharacter] }));
  const untouched = [target.get('character', accountCharacter), target.get('persona', FIRST_ID), target.get('profile', FIRST_PROFILE_ID), target.get('prompt', STARTER_ID), target.get('settings', SETTINGS_ID), target.get('order', ORDER_ID)];
  dropBatches = true;
  expect(await uploadGuest(accountId, account.vaultKey)).toMatchObject({ ok: false, error: 'offline' });
  expect(await recallGuest()).not.toBeNull();
  dropBatches = false;
  expect(await uploadGuest(accountId, account.vaultKey)).toEqual({ ok: true, data: null });
  await target.pull();
  expect(target.list('character').map(({ value }) => value.card.name).sort()).toEqual(['Account bot', 'Guest bot']);
  expect([target.get('character', accountCharacter), target.get('persona', FIRST_ID), target.get('profile', FIRST_PROFILE_ID), target.get('prompt', STARTER_ID), target.get('settings', SETTINGS_ID), target.get('order', ORDER_ID)]).toEqual(untouched);
  expect(target.get('character', source.character)?.value.card.name).toBe('Guest bot');
  expect(target.list('persona')).toHaveLength(2);
  expect(target.list('profile')).toHaveLength(2);
  expect(target.list('prompt')).toHaveLength(2);
  const prompt = target.list('prompt').find(({ value }) => value.name === 'Guest starter')!;
  expect(prompt.id).not.toBe(STARTER_ID);
  expect(prompt.value).toMatchObject({ authorNote: 'Guest edited instructions' });
  const persona = target.list('persona').find(({ value }) => value.name === 'Guest persona')!;
  expect(persona.id).not.toBe(FIRST_ID);
  const connection = target.list('connection')[0]!.value;
  expect(connection.starred[0]!.id).toBe(providerModel);
  expect(connection.accounts[0]!.id).toBe(connectionAccount);
  expect(connection.turns?.groups[0]!.id).toBe(group);
  const profile = target.list('profile').find(({ value }) => value.name === 'Guest profile')!;
  expect(profile.id).not.toBe(FIRST_PROFILE_ID);
  expect(connection.starred[0]!.profile).toBe(profile.id);
  const chat = target.list('chat')[0]!;
  expect(chat.value.persona).toBe(persona.id);
  expect(chat.id).toBe(source.chat);
  expect(chat.value.prompt).toBe(prompt.id);
  expect(chat.value.seed).toBeUndefined();
  const lease = target.retainChat(chat.id);
  expect(await lease.ready).toBeNull();
  expect(target.get('memory', memoryId(chat.id))).not.toBeNull();
  const message = target.children('entry', chat.id)[0]!;
  expect(message.id).toBe(source.message);
  expect(message.value).toMatchObject({ text: 'Hello' });
  expect('seed' in message.value && message.value.seed).toBe(false);
  const badge = target.children('toolchat', chat.id)[0]!;
  const importedModule = target.list('module')[0]!.id;
  expect(importedModule).toBe(module);
  expect(badge.id).toBe(await toolChatId(importedModule, chat.id, null));
  expect(badge.value.value).toEqual({ [message.id]: { version: message.id, text: source.message } });
  expect(target.get('tooldata', await toolDataId(importedModule, 'key'))?.value.value).toEqual({ message: source.message, nested: [{ unrecognized: prompt.id }, profile.id, SETTINGS_ID] });
  lease.release();
  expect(await serverBackend().readFile(source.ref.id)).toEqual(sealedPicture);
  expect(target.children('avatar', source.character)[0]!.value.file).toEqual(source.ref);
  expect(await new Files(serverBackend(), target).read(source.ref)).toEqual({ ok: true, data: source.image });
  expect(await recallGuest()).toBeNull();
});

it('retains the guest master on a concurrent tab write or a destination rewind, and reconciles edits and deletions on retry', async () => {
  const source = await contents();
  const draft = await prepareGuestSignup('tester', password);
  dropBatches = true;
  expect(await signUpGuest(draft)).toMatchObject({ ok: false, error: 'offline' });
  dropBatches = false;
  await source.store.update('character', source.character, (current) => ({ ...current, alias: 'Changed since the first upload' }));
  const avatar = source.store.children('avatar', source.character)[0]!;
  await source.store.remove(avatar.id);
  const backend = serverBackend();
  expect(await transferGuest(source.accountId, source.vaultKey, {}, {
    ...backend,
    feed: (query, signal) => query.since > 0 ? Promise.resolve({ ok: false, error: 'cache-reset' }) : backend.feed(query, signal),
  })).toEqual({ ok: false, error: 'cache-reset' });
  expect(await recallGuest()).not.toBeNull();
  let written = false;
  expect(await transferGuest(source.accountId, source.vaultKey, {}, {
    ...backend,
    batch: async (...args) => {
      const result = await backend.batch(...args);
      if (!written) {
        written = true;
        await source.files.save([randomBytes(32)]);
      }
      return result;
    },
  })).toEqual({ ok: false, error: 'conflict' });
  expect(await recallGuest()).not.toBeNull();
  expect(await transferGuest(source.accountId, source.vaultKey)).toEqual({ ok: true, data: null });
  const fresh = await ObjectStore.open(source.accountId, source.vaultKey, backend);
  stores.push(fresh);
  expect(await fresh.pull()).toBeNull();
  expect(fresh.get('character', source.character)?.value.alias).toBe('Changed since the first upload');
  expect(fresh.children('avatar', source.character)).toEqual([]);
});

it('discard clears the guest objects, pictures and key but preserves the remembered account', async () => {
  const source = await contents();
  const accountId = crypto.randomUUID();
  const key = randomBytes(32);
  await rememberVault(accountId, key);
  expect((await guestWithContent()).ok).toBe(true);
  expect(await discardGuest()).toEqual({ ok: true, data: null });
  expect(await recallGuest()).toBeNull();
  expect(await recallVault(accountId)).toEqual(key);
  expect(await source.backend.readFile(source.ref.id)).toEqual({ ok: false, error: 'not-found' });
  const all = await source.backend.feed(feedQuery({ since: 0, timeline: null }));
  expect(all.ok && all.data.changes).toEqual([]);
});

it('writes a version-3 guest backup and loads it into a fresh guest without any server request', async () => {
  const source = await contents();
  const fetched = vi.fn(() => Promise.reject(new Error('Guest backup used the server')));
  vi.stubGlobal('fetch', fetched);
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  const output: BackupOutput = { write: async (bytes) => { chunks.push(bytes.slice()); }, close: async () => {}, abort: async () => {} };
  expect(await exportBackup(source.store, source.files, output)).toEqual({ ok: true, data: { left: 0, skipped: 0 } });
  const file = new Blob(chunks);
  expect(JSON.parse(new TextDecoder().decode(unzipSync(new Uint8Array(await file.arrayBuffer()))['manifest.json']))).toEqual({ format: 'risu-alpha-backup', version: 3 });
  const backup = await readBackup(file);
  if (!backup.ok) throw new Error(backup.error);
  await discardGuest();
  const fresh = await guest();
  try {
    expect(await restoreBackup(fresh.store, fresh.files, backup.backup)).toEqual({ ok: true, data: { skipped: 0 } });
    expect(fresh.store.get('character', source.character)?.value.card.name).toBe('Guest bot');
    expect(await fresh.files.read(source.ref)).toEqual({ ok: true, data: source.image });
  } finally { await backup.backup.records.close(); }
  expect(fetched).not.toHaveBeenCalled();
});

it('asks for persistence only at guest creation', async () => {
  const persist = vi.fn(async () => true);
  vi.stubGlobal('navigator', { storage: { persist } });
  const made = await guestAccount();
  expect(await guestAccount()).toEqual(made);
  expect(persist).toHaveBeenCalledTimes(1);
});

it('refuses cancellation before signup and picture limits before an upload, retaining the guest', async () => {
  const source = await contents();
  const draft = await prepareGuestSignup('tester', password);
  const stopped = new AbortController();
  stopped.abort();
  expect(await signUpGuest(draft, { signal: stopped.signal })).toEqual({ ok: false, error: 'stopped' });
  expect(await app.env.db.prepare('SELECT COUNT(*) AS count FROM accounts').first('count')).toBe(0);
  expect((await signUp({ accountId: source.accountId, username: 'tester', ...draft.signup })).ok).toBe(true);
  holdAccount(source.accountId);
  const backend = serverBackend();
  const putFile = vi.fn(backend.putFile);
  expect(await transferGuest(source.accountId, source.vaultKey, {}, {
    ...backend, putFile,
    missingFiles: async (ids) => ({ ok: true, data: { missing: ids, maxBytes: 1, room: null } }),
  })).toEqual({ ok: false, error: 'too-large' });
  expect(putFile).not.toHaveBeenCalled();
  expect(await recallGuest()).toEqual({ accountId: source.accountId, vaultKey: source.vaultKey });
  expect(await source.files.read(source.ref)).toEqual({ ok: true, data: source.image });
});

it('validates client ids and refuses a taken id', async () => {
  const body = signupBody();
  expect((await app.post('signup', { ...body, accountId: 'not-an-id' })).status).toBe(400);
  expect((await app.post('signup', body)).status).toBe(201);
  await app.env.db.prepare('UPDATE service SET signup_cap = 2').run();
  expect((await app.post('signup', { ...body, username: 'another' })).status).toBe(409);
  expect(await app.env.db.prepare('SELECT COUNT(*) AS count FROM accounts').first('count')).toBe(1);
});
