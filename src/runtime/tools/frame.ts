import type { Port } from '../../tool-api/protocol';
import { ToolStopped } from '../script-binding';
import type { ToolPage } from './facade';

export type Connection = { port: Port; ready: Promise<void>; close(): void };
export type OpenFrame = (page?: ToolPage) => Connection;

export const toolFrame: OpenFrame = (page) => {
  const frame = page ? null : document.createElement('iframe');
  const channel = new MessageChannel();
  let target = page?.window ?? null;
  let connected = false;
  let closed = false;
  let reject!: (error: Error) => void;
  let loaded!: () => void;
  const ready = new Promise<void>((resolve, failed) => { loaded = resolve; reject = failed; });
  const receive = (event: MessageEvent) => {
    if (closed || connected || event.source !== target || event.data?.kind !== 'hazelle-ready') return;
    connected = true;
    window.removeEventListener('message', receive);
    target!.postMessage({ kind: 'hazelle-connect', role: page ? 'page' : 'background' }, '*', [channel.port2]);
    loaded();
  };
  window.addEventListener('message', receive);
  if (frame) {
    frame.hidden = true;
    frame.setAttribute('sandbox', 'allow-scripts');
    frame.src = '/sandbox.html?role=background';
    document.body.append(frame);
    target = frame.contentWindow;
  }
  // A visible frame may already have loaded before React hands over its window.
  target?.postMessage({ kind: 'hazelle-hello' }, '*');
  return {
    port: channel.port1, ready,
    close() {
      if (closed) return;
      closed = true;
      window.removeEventListener('message', receive);
      target?.postMessage({ kind: 'hazelle-stop' }, '*');
      frame?.remove();
      channel.port1.close();
      channel.port2.close();
      if (!connected) reject(new ToolStopped());
    },
  };
};
