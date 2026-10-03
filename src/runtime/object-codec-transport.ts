import type { CodecDown, CodecJob, CodecResult, CodecUp } from './object-codec-core';
import workerUrl from './object-codec-worker?worker&url';

export class CodecAborted extends Error {}
export class CodecUnavailable extends Error {}
export type CodecTransport = { run(job: CodecJob): Promise<CodecResult[]>; close(): void };

type Policy = { createScriptURL(url: string): string };
const policy = (globalThis as { trustedTypes?: { createPolicy(name: string, rules: Policy): Policy } }).trustedTypes?.createPolicy('object-codec-worker', {
  createScriptURL: (url) => {
    if (url !== workerUrl) throw new TypeError('not the object codec worker');
    return url;
  },
});

// One worker per open store. Its nonextractable derived key is cloned once, never exported per object.
export function objectCodecTransport(account: string, key: CryptoKey): CodecTransport {
  let worker: Worker;
  try {
    worker = new Worker((policy?.createScriptURL(workerUrl) ?? workerUrl) as string, { type: 'module' });
  } catch {
    throw new CodecUnavailable('Object codec worker could not start');
  }
  let failure: Error | null = null;
  let ids = 0;
  const pending = new Map<number, { resolve: (results: CodecResult[]) => void; reject: (error: Error) => void }>();
  const end = (error: Error) => {
    failure ??= error;
    worker.terminate();
    for (const call of pending.values()) call.reject(failure);
    pending.clear();
  };
  worker.onmessage = ({ data }: MessageEvent<CodecUp>) => {
    const call = pending.get(data.id);
    pending.delete(data.id);
    call?.resolve(data.results);
  };
  worker.onerror = worker.onmessageerror = () => end(new CodecUnavailable('Object codec worker failed'));
  try {
    worker.postMessage({ kind: 'init', account, key } satisfies CodecDown);
  } catch {
    end(new CodecUnavailable('Object codec worker could not initialize'));
  }
  return {
    run: (job) => new Promise((resolve, reject) => {
      if (failure) return reject(failure);
      const id = ++ids;
      pending.set(id, { resolve, reject });
      try {
        worker.postMessage({ kind: 'batch', id, job } satisfies CodecDown);
      } catch {
        end(new CodecUnavailable('Object codec request could not be sent'));
      }
    }),
    close: () => end(new CodecAborted('Object store closed')),
  };
}
