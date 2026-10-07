// A frame is [u32 length of what follows][u8 type][u32 seq][body]. hello's body is the object's ECDH public key in the
// clear and ping's is empty; every other body is sealed. ping keeps one reader's connection alive and is not part of
// the reply: never stored, seq 0, skipped by its type before its seq is looked at.
export const HELLO = 0;
export const HEAD = 1;
export const DATA = 2;
export const END = 3;
export const PING = 4;
