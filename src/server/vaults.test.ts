import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sessionCookie, testApp } from './testing';

let t: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => {
  t = await testApp();
});
afterAll(() => t.dispose());
beforeEach(() => t.reset());

const record = {
  kdf: { algorithm: 'argon2id', memoryKiB: 65536, iterations: 3, parallelism: 1, salt: 'c2FsdA==' },
  passphraseWrap: 'cGFzc3BocmFzZQ==',
  recoveryWrap: 'cmVjb3Zlcnk=',
};

async function signedIn() {
  return sessionCookie(await t.post('signup', { username: 'jin', password: 'correct horse' }));
}

describe('vault', () => {
  it('stores the record once and returns it as given', async () => {
    const cookie = await signedIn();
    expect(await (await t.get('vault', cookie)).json()).toEqual({ error: 'no-vault' });

    expect((await t.post('vault', record, cookie)).status).toBe(201);
    expect(await (await t.get('vault', cookie)).json()).toEqual(record);

    const again = await t.post('vault', record, cookie);
    expect(again.status).toBe(409);
    expect(await again.json()).toEqual({ error: 'vault-exists' });
  });

  it('replaces the passphrase wrap and keeps the recovery wrap', async () => {
    const cookie = await signedIn();
    await t.post('vault', record, cookie);
    const kdf = { ...record.kdf, salt: 'bmV3IHNhbHQ=' };

    expect((await t.put('vault/passphrase', { kdf, passphraseWrap: 'bmV3' }, cookie)).status).toBe(204);
    expect(await (await t.get('vault', cookie)).json()).toEqual({ kdf, passphraseWrap: 'bmV3', recoveryWrap: record.recoveryWrap });
  });

  it('refuses a malformed record and a missing session', async () => {
    const cookie = await signedIn();
    expect((await t.post('vault', { ...record, recoveryWrap: 42 }, cookie)).status).toBe(400);
    expect((await t.post('vault', { ...record, kdf: 'argon2id' }, cookie)).status).toBe(400);
    expect((await t.get('vault')).status).toBe(401);
  });
});
