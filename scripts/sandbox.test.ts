import { Script } from 'node:vm';
import { expect, it } from 'vitest';
import { sandboxSource } from './sandbox';

it('bundles both realms into one classic import-free host asset', async () => {
  const source = await sandboxSource();
  expect(() => new Script(source)).not.toThrow();
  expect(source).not.toMatch(/\bimport\s*(?:\(|\{)/);
  expect(source).toContain('RTCPeerConnection');
  expect(source).toContain('new Worker');
  expect(source).toContain('hazelle-ready');
});
