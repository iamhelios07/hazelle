import { connectApi } from '../../sandbox/api';
import { installRisu } from '../../sandbox/risu';
import type { Up } from '../../tool-api/protocol';
import type { OpenFrame, Opening } from '../tools/frame';

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

export type InProcessFrame = { host: LocalPort; sandbox: LocalPort; api: Hazelle.Api | null; page: boolean; opening: Opening; emit(message: Up): void };
export function inProcessTools(execute: (api: Hazelle.Api, code: string) => void | Promise<void>) {
  const frames: InProcessFrame[] = [];
  const open: OpenFrame = (opening) => {
    const host = new LocalPort();
    const sandbox = new LocalPort();
    host.peer = sandbox;
    sandbox.peer = host;
    const frame: InProcessFrame = { host, sandbox, api: null, page: opening.role === 'page', opening, emit: (message) => sandbox.postMessage(message) };
    frames.push(frame);
    const close = connectApi(sandbox, (code, api) => { frame.api = api; return execute(api, code); });
    return { port: host, ready: Promise.resolve(), frame: null, close: () => { host.close(); close(); } };
  };
  return { open, frames };
}

// A Risu plugin's frame: plugin runs with Risuai, risuai and the dialog shims in scope.
export const inProcessRisu = (plugin: (scope: Record<string, unknown>) => void) => inProcessTools((api) => {
  const scope: Record<string, unknown> = {};
  installRisu(api, scope);
  plugin(scope);
});
