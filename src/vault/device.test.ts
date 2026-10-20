import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { randomBytes, seal } from './aead';

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal('indexedDB', new IDBFactory());
});
afterEach(() => vi.unstubAllGlobals());

it.each([false, true])('migrates the v1 single vault into its v2 slot (guest=%s) and deletes the old slot', async (guest) => {
  const accountId = crypto.randomUUID();
  const vaultKey = randomBytes(32);
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const sealed = await seal(key, vaultKey, `risu-alpha/device/v1/${accountId}`);
  const old = await new Promise<IDBDatabase>((resolve) => {
    const req = indexedDB.open('risu-alpha', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('device');
    req.onsuccess = () => resolve(req.result);
  });
  const tx = old.transaction('device', 'readwrite');
  tx.objectStore('device').put(key, 'device-key');
  tx.objectStore('device').put({ accountId, sealed, ...(guest && { guest: true }) }, 'vault');
  await new Promise<void>((resolve) => { tx.oncomplete = () => resolve(); });
  old.close();
  const { recallGuest, recallVault } = await import('./device');
  expect(await recallGuest()).toEqual(guest ? { accountId, vaultKey } : null);
  expect(await recallVault(accountId)).toEqual(vaultKey);
  const db = await new Promise<IDBDatabase>((resolve) => {
    const req = indexedDB.open('risu-alpha', 2);
    req.onsuccess = () => resolve(req.result);
  });
  const stored = await new Promise<unknown>((resolve) => {
    const req = db.transaction('device').objectStore('device').get('vault');
    req.onsuccess = () => resolve(req.result);
  });
  expect(stored).toBeUndefined();
  db.close();
});

it('keeps both keys until the sign-in choice, locks only the account, and forgets only the chosen guest', async () => {
  const { rememberVault, guestSignupRecovery, recallGuest, recallVault, lockVault, forgetGuestVault } = await import('./device');
  const guest = { accountId: crypto.randomUUID(), vaultKey: randomBytes(32) };
  const account = { accountId: crypto.randomUUID(), vaultKey: randomBytes(32) };
  await rememberVault(guest.accountId, guest.vaultKey, true);
  const recovery = await guestSignupRecovery(guest.accountId);
  expect(await guestSignupRecovery(guest.accountId)).toEqual(recovery);
  await rememberVault(account.accountId, account.vaultKey);
  expect(await recallGuest()).toEqual(guest);
  expect(await recallVault(account.accountId)).toEqual(account.vaultKey);
  await lockVault();
  expect(await recallVault(account.accountId)).toBeNull();
  expect(await recallGuest()).toEqual(guest);
  await rememberVault(account.accountId, account.vaultKey);
  await forgetGuestVault(crypto.randomUUID());
  expect(await recallGuest()).toEqual(guest);
  await forgetGuestVault(guest.accountId);
  expect(await recallGuest()).toBeNull();
  expect(await recallVault(account.accountId)).toEqual(account.vaultKey);
});
