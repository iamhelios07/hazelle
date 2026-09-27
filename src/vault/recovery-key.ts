// Crockford base32: no I, L, O or U, so a hand-copied key has fewer look-alike characters.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const KEY_BYTES = 32;
const KEY_CHARS = Math.ceil((KEY_BYTES * 8) / 5);

export function formatRecoveryKey(bytes: Uint8Array): string {
  let bits = 0;
  let buffer = 0;
  let chars = '';
  for (const byte of bytes) {
    buffer = ((buffer << 8) | byte) & 0xffff;
    bits += 8;
    while (bits >= 5) {
      chars += ALPHABET[(buffer >> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) chars += ALPHABET[(buffer << (5 - bits)) & 31];
  return chars.match(/.{1,4}/g)!.join('-');
}

// Accepts the key as typed or pasted, or the whole downloaded file. In a file, the key is the line
// that reads as a whole key; a pattern search could borrow letters from the username line above it.
export function parseRecoveryKey(input: string): Uint8Array<ArrayBuffer> | null {
  const isKey = (chars: string) => chars.length === KEY_CHARS && [...chars].every((c) => ALPHABET.includes(c));
  const chars = input.split(/\r?\n/).map(normalize).find(isKey) ?? normalize(input);
  if (!isKey(chars)) return null;
  const bytes = new Uint8Array(KEY_BYTES);
  let bits = 0;
  let buffer = 0;
  let index = 0;
  for (const char of chars) {
    const value = ALPHABET.indexOf(char);
    buffer = ((buffer << 5) | value) & 0xfff;
    bits += 5;
    if (bits >= 8) {
      if (index < KEY_BYTES) bytes[index++] = (buffer >> (bits - 8)) & 0xff;
      bits -= 8;
    }
  }
  return bytes;
}

function normalize(text: string): string {
  return text
    .toUpperCase()
    .replace(/[-\s]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
}
