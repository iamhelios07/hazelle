import { connectApi } from './api';

declare const BACKGROUND_SOURCE: string;
let connected = false;
let worker: Worker | null = null;
const ready = () => parent.postMessage({ kind: 'hazelle-ready' }, '*');
addEventListener('message', (event: MessageEvent) => {
  // An opaque document's origin is null. Only the embedding window supplies its port.
  if (event.source !== parent) return;
  if (event.data?.kind === 'hazelle-hello' && !connected) return ready();
  if (event.data?.kind === 'hazelle-stop') { worker?.terminate(); return; }
  const port = event.ports[0];
  if (connected || event.data?.kind !== 'hazelle-connect' || !port) return;
  connected = true;
  if (event.data.role === 'background') {
    const url = URL.createObjectURL(new Blob([BACKGROUND_SOURCE], { type: 'text/javascript' }));
    worker = new Worker(url);
    URL.revokeObjectURL(url);
    worker.postMessage(null, [port]);
    return;
  }
  // WebRTC bypasses connect-src in Chromium and Firefox; page code must never see these constructors.
  Reflect.deleteProperty(globalThis, 'RTCPeerConnection');
  Reflect.deleteProperty(globalThis, 'webkitRTCPeerConnection');
  connectApi(port, (code, api) => {
    Object.defineProperty(globalThis, 'hazelle', { value: api });
    return (0, eval)(code) as void | Promise<void>;
  });
});
ready();
