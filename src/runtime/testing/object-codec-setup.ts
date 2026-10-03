import { codeObjects, type CodecDown, type CodecJob, type CodecResult, type CodecUp } from '../object-codec-core';

// Plain Node has no browser Worker. The object codec's real transport talks to this in-process one; a test scripts
// replies or a crash with vi.stubGlobal, which vi.unstubAllGlobals puts back to this.
export class CodecWorker {
  onmessage: ((event: { data: CodecUp }) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  private account = '';
  private key: CryptoKey | null = null;

  postMessage(message: CodecDown) {
    if (message.kind === 'init') {
      this.account = message.account;
      this.key = message.key;
      return;
    }
    void this.run(message.job).then((results) => this.onmessage?.({ data: { id: message.id, results } }), () => this.onerror?.());
  }

  run(job: CodecJob): Promise<CodecResult[]> {
    return codeObjects(this.key!, this.account, job);
  }

  terminate() {}
}

globalThis.Worker = CodecWorker as unknown as typeof Worker;
