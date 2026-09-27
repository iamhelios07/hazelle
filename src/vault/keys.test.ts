import { describe, expect, it } from 'vitest';
import { createVault, openWithPassphrase, openWithRecoveryKey, wrapWithPassphrase } from './keys';

describe('vault keys', () => {
  it('opens with the passphrase or the recovery key, and nothing else', async () => {
    const { record, vaultKey, recoveryKey } = await createVault('account-1', '금고 비밀번호');

    expect(await openWithPassphrase('account-1', record, '금고 비밀번호')).toEqual(vaultKey);
    expect(await openWithPassphrase('account-1', record, '다른 비밀번호')).toBeNull();
    expect(await openWithRecoveryKey('account-1', record, recoveryKey)).toEqual(vaultKey);
    expect(await openWithRecoveryKey('account-1', record, recoveryKey.replace(/^./, (c) => (c === 'A' ? 'B' : 'A')))).toBeNull();
  });

  it('refuses a wrapped key moved to another account', async () => {
    const { record, recoveryKey } = await createVault('account-1', '금고 비밀번호');
    expect(await openWithRecoveryKey('account-2', record, recoveryKey)).toBeNull();
  });

  it('re-wraps the same vault key under a new passphrase', async () => {
    const { record, vaultKey } = await createVault('account-1', '예전 비밀번호');
    const rewrapped = { ...record, ...(await wrapWithPassphrase('account-1', vaultKey, '새 비밀번호')) };

    expect(await openWithPassphrase('account-1', rewrapped, '새 비밀번호')).toEqual(vaultKey);
    expect(await openWithPassphrase('account-1', rewrapped, '예전 비밀번호')).toBeNull();
  });
});
