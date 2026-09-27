import { argon2id } from '@noble/hashes/argon2.js';

// Sized for the Worker's 128 MB isolate (tech-spec §4). Each hash records its own parameters, so
// raising these later leaves existing hashes verifiable.
const PARAMS = { m: 19456, t: 2, p: 1 };
const PHC = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/;

// Passwords are NFC-normalized because the same Korean text can arrive composed or decomposed,
// depending on the OS and IME it was typed on.
export function hashPassword(password: string): string {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = argon2id(password.normalize('NFC'), salt, { ...PARAMS, dkLen: 32 });
  return `$argon2id$v=19$m=${PARAMS.m},t=${PARAMS.t},p=${PARAMS.p}$${toBase64(salt)}$${toBase64(hash)}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const match = PHC.exec(stored);
  if (!match) throw new Error('Unreadable login hash');
  const [m, t, p, salt, hash] = match.slice(1) as [string, string, string, string, string];
  const expected = fromBase64(hash);
  const actual = argon2id(password.normalize('NFC'), fromBase64(salt), {
    m: Number(m),
    t: Number(t),
    p: Number(p),
    dkLen: expected.length,
  });
  let difference = 0;
  for (let i = 0; i < expected.length; i++) difference |= expected[i]! ^ actual[i]!;
  return difference === 0;
}

function toBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/=+$/, '');
}

function fromBase64(text: string): Uint8Array {
  return Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
}
