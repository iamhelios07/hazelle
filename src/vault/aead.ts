const NONCE_BYTES = 12;

export function randomBytes(length: number): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(length));
}

export function encodeText(text: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(text);
}

// Sealed form: base64(nonce ‖ AES-GCM ciphertext). The AAD binds the ciphertext to where it belongs.
export async function seal(key: CryptoKey, plaintext: Uint8Array<ArrayBuffer>, aad: string): Promise<string> {
  const nonce = randomBytes(NONCE_BYTES);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, additionalData: encodeText(aad) }, key, plaintext);
  const sealed = new Uint8Array(NONCE_BYTES + ciphertext.byteLength);
  sealed.set(nonce);
  sealed.set(new Uint8Array(ciphertext), NONCE_BYTES);
  return toBase64(sealed);
}

// null means the key or the AAD is wrong, or the ciphertext was altered: GCM cannot tell these apart.
export async function open(key: CryptoKey, sealed: string, aad: string): Promise<Uint8Array<ArrayBuffer> | null> {
  const bytes = fromBase64(sealed);
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: bytes.subarray(0, NONCE_BYTES), additionalData: encodeText(aad) },
      key,
      bytes.subarray(NONCE_BYTES),
    );
    return new Uint8Array(plaintext);
  } catch {
    return null;
  }
}

export function toBase64(bytes: Uint8Array): string {
  let text = '';
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text);
}

export function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
}
