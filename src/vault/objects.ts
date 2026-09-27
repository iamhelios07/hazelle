import { encodeText, fromBase64, openBytes, sealBytes, toBase64 } from './aead';
import type { VaultKey } from './keys';

export type ObjectAddress = { id: string; kind: string; parent: string | null };

// The leading byte names the body format, so a later format can be read beside this one.
// Format 1: AES-256-GCM over deflate-raw JSON (tech-spec §4).
const FORMAT = 1;

// The server cannot move a body to another object, kind, parent or account without failing this AAD.
const objectAad = (accountId: string, { id, kind, parent }: ObjectAddress) => `risu-alpha/object/v1/${accountId}/${id}/${kind}/${parent ?? ''}`;

// A key of its own, derived from the vault key, so object bodies and key wraps never share a key.
export async function objectKey(vaultKey: VaultKey): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', vaultKey, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(), info: encodeText('risu-alpha objects v1') },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function sealObject(key: CryptoKey, accountId: string, address: ObjectAddress, value: unknown): Promise<string> {
  const sealed = await sealBytes(key, await transform(encodeText(JSON.stringify(value)), new CompressionStream('deflate-raw')), objectAad(accountId, address));
  const body = new Uint8Array(1 + sealed.length);
  body[0] = FORMAT;
  body.set(sealed, 1);
  return toBase64(body);
}

// undefined means the body cannot be read: an unknown format, a wrong key, or a body the server altered or moved.
export async function openObject(key: CryptoKey, accountId: string, address: ObjectAddress, body: string): Promise<unknown> {
  const bytes = fromBase64(body);
  if (bytes[0] !== FORMAT) return undefined;
  const compressed = await openBytes(key, bytes.subarray(1), objectAad(accountId, address));
  if (!compressed) return undefined;
  return JSON.parse(new TextDecoder().decode(await transform(compressed, new DecompressionStream('deflate-raw'))));
}

async function transform(bytes: Uint8Array<ArrayBuffer>, stream: CompressionStream | DecompressionStream): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());
}
