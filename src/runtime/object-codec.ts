import type { CodecJob, CodecResult, OpenItem, SealItem } from './object-codec-core';
import { CodecAborted, objectCodecTransport, type CodecTransport } from './object-codec-transport';

export const OPEN_ITEMS = 64;
export const OPEN_BYTES = 4 * 1024 * 1024;
// Values have no cheap encoded size before the worker serializes them. Bound those atomic objects by count.
export const SEAL_ITEMS = 8;

export class ObjectCodec {
  private readonly closing = new AbortController();
  private transport: CodecTransport | null = null;
  private tail: Promise<void> = Promise.resolve();

  constructor(private readonly account: string, private readonly key: CryptoKey) {}

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

  // All scopes share one admission queue. Cancelling a caller rejects it promptly, but an already posted batch
  // keeps the slot until it answers: neither other scopes nor repeated cancelled calls flood the worker's queue.
  private run(job: CodecJob, signal: AbortSignal): Promise<CodecResult[]> {
    const stop = AbortSignal.any([signal, this.closing.signal]);
    const check = () => { if (stop.aborted) throw new CodecAborted('Object codec request stopped'); };
    const work = this.tail.then(async () => {
      check();
      this.transport ??= objectCodecTransport(this.account, this.key);
      const results = await this.transport.run(job);
      check();
      return results;
    });
    this.tail = work.then(() => {}, () => {});
    return new Promise((resolve, reject) => {
      const abort = () => reject(new CodecAborted('Object codec request stopped'));
      if (stop.aborted) abort();
      else stop.addEventListener('abort', abort, { once: true });
      void work.then(resolve, reject).finally(() => stop.removeEventListener('abort', abort));
    });
  }
}
