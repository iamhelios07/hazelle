import { expect, it } from 'vitest';
import { deleteAccount, loadSession } from './account';
import { testServer } from './testing';

const server = testServer();

it('deletes the account only with its password proof, after which the session is gone and its seat open again', async () => {
  await server.account();
  expect(await deleteAccount({ method: 'recovery', proof: server.passwordProof.proof })).toEqual({ ok: false, error: 'wrong-login' });
  expect(await deleteAccount(server.passwordProof)).toEqual({ ok: true, data: undefined });
  expect(await loadSession()).toEqual({ ok: true, data: { session: null, signupOpen: true } });
});
