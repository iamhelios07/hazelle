// A frame is [u32 length of what follows][u8 type][u32 seq][body]. hello's body is the object's ECDH public key in the
// clear and ping's is empty; every other body is sealed. ping keeps one reader's connection alive and is not part of
// the reply: never stored, seq 0, skipped by its type before its seq is looked at.
export const HELLO = 0;
export const HEAD = 1;
export const DATA = 2;
export const END = 3;
export const PING = 4;
// Before a try is sent again (Retry); its body is empty. It comes only before head: past head the reply is the reader's.
export const WAIT = 5;

// Retry on failure (design §6.7): a try the provider refused for a moment (an answer with one of statuses) or whose
// address could not be reached is sent again, times more at most, before anything of it is passed on. The page's
// connector says which statuses.
export type Retry = { times: number; statuses: readonly number[] };
export const RETRY_MOST = 5;
// A Retry-After past this is the provider saying no for now, and the failure is final.
const WAIT_MOST_MS = 60_000;

// How long to wait after the tries-th try failed: the provider's Retry-After, in seconds or as a date, else 2 s doubling
// with each try. null: longer than WAIT_MOST_MS.
export function retryWait(tries: number, retryAfter: string | null, now: number): number | null {
  const asked = retryAfter === null ? NaN : /^\d+$/.test(retryAfter.trim()) ? Number(retryAfter) * 1000 : Date.parse(retryAfter) - now;
  if (Number.isNaN(asked)) return 1000 * 2 ** tries;
  return asked > WAIT_MOST_MS ? null : Math.max(0, asked);
}
