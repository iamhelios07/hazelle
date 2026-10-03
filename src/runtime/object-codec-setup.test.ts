import { vi } from 'vitest';

// Plain Node has no browser Worker. Tests explicitly replace transport, not the vault codec or production policy.
vi.mock('./object-codec-transport', async (original) => {
  const transport = await original<typeof import('./object-codec-transport')>();
  const { codeObjects } = await import('./object-codec-core');
  return { ...transport, objectCodecTransport: (account: string, key: CryptoKey) => ({
    run: (job: import('./object-codec-core').CodecJob) => codeObjects(key, account, job),
    close: () => {},
  }) };
});
