import { argon2id } from 'hash-wasm';
import { encodeText, open, randomBytes, seal, fromBase64, toBase64 } from './aead';
import { formatRecoveryKey, parseRecoveryKey } from './recovery-key';

export type KdfParams = { algorithm: 'argon2id'; memoryKiB: number; iterations: number; parallelism: number; salt: string };
export type VaultRecord = { kdf: KdfParams; passphraseWrap: string; recoveryWrap: string };
export type VaultKey = Uint8Array<ArrayBuffer>;

// tech-spec §4. Each record stores its own parameters, so raising these later keeps old records openable.
const KDF = { algorithm: 'argon2id', memoryKiB: 64 * 1024, iterations: 3, parallelism: 1 } as const;

const wrapAad = (accountId: string, method: 'passphrase' | 'recovery') => `risu-alpha/vault-key/v1/${accountId}/${method}`;

export async function createVault(accountId: string, passphrase: string) {
  const vaultKey = randomBytes(32);
  const recovery = randomBytes(32);
  const { kdf, passphraseWrap } = await wrapWithPassphrase(accountId, vaultKey, passphrase);
  const recoveryWrap = await seal(await recoveryKek(recovery), vaultKey, wrapAad(accountId, 'recovery'));
  const record: VaultRecord = { kdf, passphraseWrap, recoveryWrap };
  return { record, vaultKey, recoveryKey: formatRecoveryKey(recovery) };
}

export async function wrapWithPassphrase(accountId: string, vaultKey: VaultKey, passphrase: string) {
  const kdf: KdfParams = { ...KDF, salt: toBase64(randomBytes(16)) };
  const passphraseWrap = await seal(await passphraseKek(passphrase, kdf), vaultKey, wrapAad(accountId, 'passphrase'));
  return { kdf, passphraseWrap };
}

export async function openWithPassphrase(accountId: string, record: VaultRecord, passphrase: string): Promise<VaultKey | null> {
  return open(await passphraseKek(passphrase, record.kdf), record.passphraseWrap, wrapAad(accountId, 'passphrase'));
}

export async function openWithRecoveryKey(accountId: string, record: VaultRecord, input: string): Promise<VaultKey | null> {
  const recovery = parseRecoveryKey(input);
  if (!recovery) return null;
  return open(await recoveryKek(recovery), record.recoveryWrap, wrapAad(accountId, 'recovery'));
}

// NFC for the same reason as the login password: Korean text can arrive composed or decomposed.
async function passphraseKek(passphrase: string, kdf: KdfParams): Promise<CryptoKey> {
  const bytes = await argon2id({
    password: passphrase.normalize('NFC'),
    salt: fromBase64(kdf.salt),
    memorySize: kdf.memoryKiB,
    iterations: kdf.iterations,
    parallelism: kdf.parallelism,
    hashLength: 32,
    outputType: 'binary',
  });
  return crypto.subtle.importKey('raw', new Uint8Array(bytes), 'AES-GCM', false, ['encrypt', 'decrypt']);
}

async function recoveryKek(recovery: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', recovery, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(), info: encodeText('risu-alpha vault recovery v1') },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}
