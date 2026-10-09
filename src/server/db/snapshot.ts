import { Worker } from 'node:worker_threads';

export type SnapshotArchive = { bytes: number; expanded: number; sha256: string };
export type ArchiveJob = { plain: string; gzip: string };

export function archiveSnapshot(plain: string, gzip: string): Promise<SnapshotArchive> {
  return new Promise((resolve, reject) => {
    const source = import.meta.url.endsWith('.ts');
    const worker = new Worker(new URL(source ? './snapshot-worker.ts' : './snapshot-worker.js', import.meta.url), {
      workerData: { plain, gzip } satisfies ArchiveJob,
      ...(source && { execArgv: ['--import', 'tsx'] }),
    });
    let result: SnapshotArchive | undefined;
    let failure: Error | undefined;
    worker.once('message', (value: SnapshotArchive) => { result = value; });
    worker.once('error', (error) => { failure = error; });
    // Wait for exit even after an error: the caller may now remove the worker's temporary files.
    worker.once('exit', (code) => {
      if (failure) reject(failure);
      else if (code === 0 && result) resolve(result);
      else reject(new Error(`Snapshot archive worker exited without a result (${code})`));
    });
  });
}
