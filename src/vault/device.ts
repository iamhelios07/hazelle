import { open, seal } from './aead';
import type { VaultKey } from './keys';

// The vault stays unlocked on this device (tech-spec §4): the vault key is kept sealed under a
// non-extractable device key, so the stored copy is useless outside this browser profile.
const DB_NAME = 'risu-alpha';
const STORE = 'device';
const DEVICE_KEY = 'device-key';
const VAULT = 'vault';

const deviceAad = (accountId: string) => `risu-alpha/device/v1/${accountId}`;

type StoredVault = { accountId: string; sealed: string };

export async function rememberVault(accountId: string, vaultKey: VaultKey): Promise<void> {
  let key = await read<CryptoKey>(DEVICE_KEY);
  if (!key) {
    key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    await write(DEVICE_KEY, key);
  }
  await write(VAULT, { accountId, sealed: await seal(key, vaultKey, deviceAad(accountId)) } satisfies StoredVault);
}

export async function recallVault(accountId: string): Promise<VaultKey | null> {
  const stored = await read<StoredVault>(VAULT);
  const key = await read<CryptoKey>(DEVICE_KEY);
  if (!stored || !key || stored.accountId !== accountId) return null;
  return open(key, stored.sealed, deviceAad(accountId));
}

export async function forgetVault(): Promise<void> {
  const db = await database();
  await request(db.transaction(STORE, 'readwrite').objectStore(STORE).delete(VAULT));
}

async function read<T>(name: string): Promise<T | undefined> {
  const db = await database();
  return request<T | undefined>(db.transaction(STORE).objectStore(STORE).get(name));
}

async function write(name: string, value: unknown): Promise<void> {
  const db = await database();
  await request(db.transaction(STORE, 'readwrite').objectStore(STORE).put(value, name));
}

let opened: Promise<IDBDatabase> | undefined;

function database(): Promise<IDBDatabase> {
  opened ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return opened;
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
