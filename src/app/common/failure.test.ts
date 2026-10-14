import { expect, it } from 'vitest';
import { describeFailure } from './failure';

it('has words of its own for each refusal the server answers about the account, not the generic server trouble', () => {
  const generic = describeFailure({ ok: false, error: 'not-a-code' });
  const codes = ['account-mismatch', 'suspended', 'too-many-calls', 'storage-full', 'file-blocked', 'username-taken', 'too-many-reports', 'not-admin', 'signup-closed', 'too-many-signups', 'sole-operator', 'account-leaving'];
  const words = codes.map((error) => describeFailure({ ok: false, error }));
  expect(words).not.toContain(generic);
  expect(new Set(words).size).toBe(codes.length);
  expect(generic).toContain('(not-a-code)');
  expect(describeFailure({ ok: false, error: 'server-error', status: 403 })).toContain('(server-error 403)');
});
