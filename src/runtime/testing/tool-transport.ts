import { connectApi } from '../../sandbox/api';
import type { Up } from '../../tool-api/protocol';
import type { OpenFrame } from '../tools/frame';

class LocalPort {
  onmessage: ((event: MessageEvent) => void) | null = null;
  closed = false;
  peer: LocalPort | null = null;
  readonly sent: unknown[] = [];
  silent = false;
  postMessage(message: unknown) {
    if (this.closed || this.silent) return;
    const data: unknown = structuredClone(message);
    this.sent.push(data);
    queueMicrotask(() => { if (!this.peer?.closed) this.peer?.onmessage?.(new MessageEvent('message', { data })); });
  }
  start() {}
  close() { this.closed = true; }
}

export type InProcessFrame = { host: LocalPort; sandbox: LocalPort; api: Hazelle.Api | null; page: boolean; emit(message: Up): void };
export function inProcessTools(execute: (api: Hazelle.Api, code: string) => void | Promise<void>) {
  const frames: InProcessFrame[] = [];
  const open: OpenFrame = (page) => {
    const host = new LocalPort();
    const sandbox = new LocalPort();
    host.peer = sandbox;
    sandbox.peer = host;
    const frame: InProcessFrame = { host, sandbox, api: null, page: !!page, emit: (message) => sandbox.postMessage(message) };
    frames.push(frame);
    const close = connectApi(sandbox, (code, api) => { frame.api = api; return execute(api, code); });
    return { port: host, ready: Promise.resolve(), close: () => { host.close(); close(); } };
  };
  return { open, frames };
}
