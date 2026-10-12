// The share consent's version. The account's row keeps the one it agreed to, and a publish needs the current one, so
// changing the consent's text raises this and every sharer is asked again.
export const SHARE_CONSENT = 1;

// A share's id: 12 random bytes in base64url, made by the server.
export const SHARE_ID = /^[A-Za-z0-9_-]{16}$/;
// The files one version names, its pictures; the manifest is apart.
export const MAX_SHARE_FILES = 10_000;
// The full link a report carries: the address with its key.
export const MAX_SHARE_LINK = 300;

// The opt-in embed text, stored unsealed. Never a picture.
export type ShareCover = { name: string; creator: string; line: string };
export const COVER_LENGTH = { name: 100, creator: 100, line: 200 } as const satisfies Record<keyof ShareCover, number>;

// What the anonymous GET answers. live: the newest version, the manifest's file id and the 받은 횟수.
export type ShareState = { state: 'live'; version: number; manifest: string; received: number } | { state: 'held' } | { state: 'gone' };
