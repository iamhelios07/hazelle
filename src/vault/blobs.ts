import { openBytes, sealBytes } from './aead';

// The leading byte names the body format, as for objects. Format 1: AES-256-GCM over the file's own
// bytes, uncompressed, because images arrive compressed already. The key is objectKey (objects.ts);
// the AAD prefix alone keeps a file apart from the object that shares its id.
const FORMAT = 1;

// The server cannot move a file to another id or account without failing this AAD.
const blobAad = (accountId: string, id: string) => `risu-alpha/blob/v1/${accountId}/${id}`;

export async function sealBlob(key: CryptoKey, accountId: string, id: string, bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const sealed = await sealBytes(key, bytes, blobAad(accountId, id));
  const body = new Uint8Array(1 + sealed.length);
  body[0] = FORMAT;
  body.set(sealed, 1);
  return body;
}

// null means the body cannot be read: an unknown format, a wrong key, or a body the server altered or moved.
export async function openBlob(key: CryptoKey, accountId: string, id: string, body: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer> | null> {
  if (body[0] !== FORMAT) return null;
  return openBytes(key, body.subarray(1), blobAad(accountId, id));
}
