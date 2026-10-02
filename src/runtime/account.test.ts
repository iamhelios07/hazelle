import { expect, it } from 'vitest';
import { AccountFacts, deleteAccount, loadSession } from './account';
import { testServer } from './testing';

const server = testServer();

it('deletes the account only with its password proof, after which the session is gone and its seat open again', async () => {
  await server.account();
  expect(await deleteAccount({ method: 'recovery', proof: server.passwordProof.proof })).toEqual({ ok: false, error: 'wrong-login' });
  expect(await deleteAccount(server.passwordProof)).toEqual({ ok: true, data: undefined });
  expect(await loadSession()).toEqual({ ok: true, data: { session: null, signupOpen: true } });
});

it('learns a suspension and a full account from refusals, and holds full until the account shrinks', () => {
  const facts = new AccountFacts({ accountId: 'a', username: 'jin', admin: false, suspended: false, storage: { bytes: 100, bytesCap: 100, fileBytes: 0, fileBytesCap: null } });
  facts.heard({ kind: 'storage-full' });
  facts.heard({ kind: 'bytes', bytes: 120 });
  expect(facts.snapshot()).toMatchObject({ suspended: false, full: true, storage: { bytes: 120 } });
  facts.heard({ kind: 'bytes', bytes: 90 });
  facts.heard({ kind: 'suspended' });
  expect(facts.snapshot()).toMatchObject({ suspended: true, full: false, storage: { bytes: 90 } });
});
