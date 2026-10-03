import { expect, it, vi } from 'vitest';
import { BackupPeer } from './backup-peer';

it('backpressures worker chunks through acknowledgements and rejects pending calls on close', async () => {
  const writes: number[] = [];
  let release!: () => void;
  const host: BackupPeer = new BackupPeer((message) => queueMicrotask(() => worker.receive(structuredClone(message))), async (name, args) => {
    if (name !== 'write') throw new Error('unexpected host call');
    writes.push(args as number);
    await new Promise<void>((resolve) => { release = resolve; });
  });
  const worker: BackupPeer = new BackupPeer((message) => queueMicrotask(() => host.receive(structuredClone(message))), async () => {
    for (const chunk of [1, 2]) await worker.call('write', chunk);
    return 'complete';
  });
  const done = host.call('produce');
  await vi.waitFor(() => expect(writes).toEqual([1]), { interval: 1 });
  release();
  await vi.waitFor(() => expect(writes).toEqual([1, 2]), { interval: 1 });
  release();
  await expect(done).resolves.toBe('complete');
  const pending = host.call('produce');
  const stopped = expect(pending).rejects.toThrow('closed');
  host.close();
  worker.close();
  await stopped;
});
