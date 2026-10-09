import { getRequestListener } from '@hono/node-server';
import { Agent, createServer, request } from 'node:http';
import { parentPort, workerData } from 'node:worker_threads';
import { clientFiles } from './static';

export type FrontendOptions = { port: number; apiPort: number; clientDir: string };

const { port, apiPort, clientDir } = workerData as FrontendOptions;
const files = getRequestListener(clientFiles(clientDir).fetch);
const agent = new Agent({ keepAlive: true });
let draining = false;

const server = createServer((incoming, outgoing) => {
  const path = incoming.url?.split('?')[0] ?? '/';
  if (path !== '/api' && !path.startsWith('/api/')) return void files(incoming, outgoing);

  const started = performance.now();
  // Keep bodies streaming and retain the original Content-Length: the API rejects chunked uploads before reading them.
  const upstream = request({ host: '127.0.0.1', port: apiPort, method: incoming.method, path: incoming.url, headers: incoming.headers, agent }, (response) => {
    const headers = { ...response.headers };
    headers['server-timing'] = [headers['server-timing'], `api_wait;dur=${(performance.now() - started).toFixed(1)}`].filter(Boolean).join(', ');
    outgoing.writeHead(response.statusCode!, headers);
    response.on('error', () => outgoing.destroy());
    response.pipe(outgoing);
  });
  upstream.on('error', () => {
    if (outgoing.headersSent) return outgoing.destroy();
    outgoing.writeHead(502, { 'content-type': 'application/json' });
    outgoing.end('{"error":"offline"}');
  });
  incoming.on('aborted', () => upstream.destroy());
  incoming.on('error', () => upstream.destroy());
  outgoing.on('close', () => { if (!outgoing.writableFinished) upstream.destroy(); });
  incoming.pipe(upstream);
});

server.listen(port, () => parentPort!.postMessage('listening'));
parentPort!.on('message', (message: string) => {
  if (message !== 'drain' || draining) return;
  draining = true;
  const sweeping = setInterval(() => server.closeIdleConnections(), 100);
  server.close(() => {
    clearInterval(sweeping);
    agent.destroy();
    parentPort!.postMessage('closed');
  });
  parentPort!.postMessage('draining');
});
