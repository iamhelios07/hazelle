import type { Port, Role } from '../../tool-api/protocol';
import { ToolStopped } from '../script-binding';
import type { ToolPage } from './facade';

// frame: the iframe a frame tool's document runs in, which its page shows.
export type Connection = { port: Port; ready: Promise<void>; close(): void; frame: HTMLIFrameElement | null };
export type Opening = { role: 'background' | 'frame' } | { role: 'page'; page: ToolPage };
export type OpenFrame = (opening: Opening) => Connection;
// A stopped frame's onUnload callbacks run until it is removed; the host no longer answers their calls.
const UNLOAD_MS = 1000;

export const toolFrame: OpenFrame = (opening) => {
  const page = opening.role === 'page' ? opening.page : null;
  const role: Role = opening.role;
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
    target!.postMessage({ kind: 'hazelle-connect', role }, '*', [channel.port2]);
    loaded();
  };
  window.addEventListener('message', receive);
  if (frame) {
    frame.hidden = true;
    frame.setAttribute('sandbox', 'allow-scripts');
    frame.src = `/sandbox.html?role=${role}`;
    document.body.append(frame);
    target = frame.contentWindow;
  }
  // A visible frame may already have loaded before React hands over its window.
  target?.postMessage({ kind: 'hazelle-hello' }, '*');
  return {
    port: channel.port1, ready, frame: role === 'frame' ? frame : null,
    close() {
      if (closed) return;
      closed = true;
      window.removeEventListener('message', receive);
      target?.postMessage({ kind: 'hazelle-stop' }, '*');
      if (role === 'frame' && frame) {
        frame.hidden = true;
        setTimeout(() => frame.remove(), UNLOAD_MS);
      } else frame?.remove();
      channel.port1.close();
      channel.port2.close();
      if (!connected) reject(new ToolStopped());
    },
  };
};
