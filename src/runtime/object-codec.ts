import type { CodecDown, CodecJob, CodecResult, CodecUp, OpenItem, SealItem } from './object-codec-core';
import { PendingRequests } from './pending-requests';
import { moduleWorker } from './worker';
import workerUrl from './object-codec-worker?worker&url';

export const OPEN_ITEMS = 64;
export const OPEN_BYTES = 4 * 1024 * 1024;
// Values have no cheap encoded size before the worker serializes them. Bound those atomic objects by count.
export const SEAL_ITEMS = 8;
// Opening an account is CPU in the workers (base64, decrypt, inflate, parse) while the main thread waits, so the pool
// takes the cores the main thread can spare, bounded: more workers than that only share the same cores.
export const codecWorkers = () => Math.min(4, Math.max(1, (navigator.hardwareConcurrency || 2) - 1));

export class CodecAborted extends Error {}
export class CodecUnavailable extends Error {}
type CodecTransport = { run(job: CodecJob): Promise<CodecResult[]>; close(): void };

// A pool of workers per open store, each initialized once with the same nonextractable derived key, which is cloned,
// never exported per object. A job goes to the least loaded worker. One worker failing ends the pool: a crash says
// nothing about which objects are corrupt, so no caller may read a partial answer as unreadable objects.
function objectCodecTransport(account: string, key: CryptoKey, count: number): CodecTransport {
  const workers: Worker[] = [];
  const loads: number[] = [];
  let failure: Error | null = null;
  const pending = new PendingRequests<CodecResult[], number>();
  const end = (error: Error) => {
    failure ??= error;
    for (const worker of workers) worker.terminate();
    pending.rejectAll(() => failure);
  };
  try {
    for (let index = 0; index < count; index++) workers.push(moduleWorker(workerUrl));
  } catch {
    end(new CodecUnavailable('Object codec worker could not start'));
  }
  for (const worker of workers) {
    loads.push(0);
    worker.onmessage = ({ data }: MessageEvent<CodecUp>) => {
      const call = pending.take(data.id);
      if (!call) return;
      loads[call.context]!--;
      call.resolve(data.results);
    };
    worker.onerror = worker.onmessageerror = () => end(new CodecUnavailable('Object codec worker failed'));
    try {
      worker.postMessage({ kind: 'init', account, key } satisfies CodecDown);
    } catch {
      end(new CodecUnavailable('Object codec worker could not initialize'));
    }
  }
  return {
    run: (job) => {
      if (failure) return Promise.reject(failure);
      const index = loads.indexOf(Math.min(...loads));
      loads[index]!++;
      const { id, promise } = pending.add(index);
      try {
        workers[index]!.postMessage({ kind: 'batch', id, job } satisfies CodecDown);
      } catch {
        end(new CodecUnavailable('Object codec request could not be sent'));
      }
      return promise;
    },
    close: () => end(new CodecAborted('Object store closed')),
  };
}

export class ObjectCodec {
  private readonly closing = new AbortController();
  private transport: CodecTransport | null = null;
  private active = 0;
  private readonly waiting: (() => void)[] = [];

  constructor(private readonly account: string, private readonly key: CryptoKey, readonly workers = codecWorkers()) {}

  open(items: OpenItem[], signal: AbortSignal): Promise<CodecResult[]> {
    return this.run({ kind: 'open', items }, signal);
  }

  seal(items: SealItem[], limit: number, signal: AbortSignal): Promise<CodecResult<string | null>[]> {
    return this.run({ kind: 'seal', items, limit }, signal) as Promise<CodecResult<string | null>[]>;
  }

  close() {
    this.closing.abort();
    this.transport?.close();
  }

  // All scopes share one admission queue with one slot per worker. Cancelling a caller rejects it promptly, but an
  // already posted batch keeps its slot until it answers: neither other scopes nor repeated cancelled calls flood the
  // workers' queues.
  private run(job: CodecJob, signal: AbortSignal): Promise<CodecResult[]> {
    const stop = AbortSignal.any([signal, this.closing.signal]);
    const check = () => { if (stop.aborted) throw new CodecAborted('Object codec request stopped'); };
    const work = this.admit().then(async () => {
      try {
        check();
        this.transport ??= objectCodecTransport(this.account, this.key, this.workers);
        const results = await this.transport.run(job);
        check();
        return results;
      } finally {
        // A slot is handed to the next waiter, never freed and retaken: a newcomer could otherwise slip past the queue.
        const next = this.waiting.shift();
        if (next) next();
        else this.active--;
      }
    });
    return new Promise((resolve, reject) => {
      const abort = () => reject(new CodecAborted('Object codec request stopped'));
      if (stop.aborted) abort();
      else stop.addEventListener('abort', abort, { once: true });
      void work.then(resolve, reject).finally(() => stop.removeEventListener('abort', abort));
    });
  }

  private admit(): Promise<void> {
    if (this.active < this.workers) {
      this.active++;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => this.waiting.push(resolve));
  }
}
