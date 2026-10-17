import { getRequestListener } from '@hono/node-server';
import { Agent, createServer, request, type ClientRequest } from 'node:http';
import { parentPort, workerData } from 'node:worker_threads';
import { VISITOR_HEADER } from '../contracts/http';
import type { ShareCover } from '../contracts/shares';
import { endToEnd } from './hop-by-hop';
import { clientFiles } from './static';

export type FrontendOptions = { port: number; apiPort: number; clientDir: string };

const { port, apiPort, clientDir } = workerData as FrontendOptions;
// A share page's embed text, asked of the API, which owns the database; a failure leaves the page without one.
async function cover(id: string): Promise<ShareCover | null> {
  try {
    const answer = await fetch(`http://127.0.0.1:${apiPort}/api/shares/${id}/cover`);
    return answer.ok ? ((await answer.json()) as { cover: ShareCover | null }).cover : null;
  } catch {
    return null;
  }
}
const files = getRequestListener(clientFiles(clientDir, cover).fetch);
// A finite socket timeout lets Node honor the API's shorter keep-alive hint; zero keeps idle sockets until
// the server closes them and races reuse. The agent destroys timed-out free sockets, not active requests.
const agent = new Agent({ keepAlive: true, timeout: 5000 });
let draining = false;

const server = createServer((incoming, outgoing) => {
  const path = incoming.url?.split('?')[0] ?? '/';
  if (path !== '/api' && !path.startsWith('/api/')) return void files(incoming, outgoing);

  const startedAt = Date.now();
  const started = performance.now();
  let connectedMs: number | null = null;
  let sentMs: number | null = null;
  // The visitor is the last X-Forwarded-For entry when a proxy is in front (Caddy, the hosted machine's only way in,
  // writes it), else the connection's peer. Written over whatever the request says, so no one names their own key.
  const forwarded = incoming.headers['x-forwarded-for'];
  const visitor = (Array.isArray(forwarded) ? forwarded.join(',') : forwarded)?.split(',').at(-1)?.trim() || incoming.socket.remoteAddress || 'unknown';
  // After endToEnd: a header the request's Connection names could otherwise remove the visitor.
  const headers = { ...endToEnd(incoming.headers), [VISITOR_HEADER]: visitor };
  const failed = (error: NodeJS.ErrnoException, reusedSocket: boolean | null) => {
    // The visitor left first and this proxy ended the upstream itself (below): nothing failed and no one is answered.
    if (incoming.aborted || outgoing.destroyed) return;
    // No URL, headers or body: any of them can carry credentials. System error fields identify the transport failure.
    console.error(JSON.stringify({
      at: new Date().toISOString(), event: 'proxy failed', startedAt, method: incoming.method,
      code: error.code ?? null, syscall: error.syscall ?? null, causeCode: (error.cause as NodeJS.ErrnoException | undefined)?.code ?? null,
      ms: performance.now() - started, connectedMs, sentMs, reusedSocket,
      headersSent: outgoing.headersSent, draining,
    }));
    if (outgoing.headersSent) return outgoing.destroy();
    outgoing.writeHead(502, { 'content-type': 'application/json' });
    outgoing.end('{"error":"offline"}');
  };
  // Node throws some request faults instead of emitting them; uncaught, one request would stop this listener.
  let upstream: ClientRequest;
  try {
    // Keep bodies streaming and retain the original Content-Length: the API rejects chunked uploads before reading them.
    upstream = request({ host: '127.0.0.1', port: apiPort, method: incoming.method, path: incoming.url, headers, agent }, (response) => {
      const headers = endToEnd(response.headers);
      headers['server-timing'] = [headers['server-timing'], `api_wait;dur=${(performance.now() - started).toFixed(1)}`].filter(Boolean).join(', ');
      outgoing.writeHead(response.statusCode!, headers);
      response.on('error', () => outgoing.destroy());
      response.pipe(outgoing);
    });
  } catch (error) {
    return failed(error as NodeJS.ErrnoException, null);
  }
  upstream.on('socket', (socket) => {
    const connected = () => { connectedMs = performance.now() - started; };
    if (socket.connecting) socket.once('connect', connected);
    else connected();
  });
  upstream.on('finish', () => { sentMs = performance.now() - started; });
  upstream.on('error', (error) => failed(error, upstream.reusedSocket));
  incoming.on('aborted', () => upstream.destroy());
  incoming.on('error', () => upstream.destroy());
  outgoing.on('close', () => { if (!outgoing.writableFinished) upstream.destroy(); });
  incoming.pipe(upstream, { end: false });
  incoming.on('end', () => {
    try {
      upstream.end();
    } catch (error) {
      upstream.destroy(error as Error);
    }
  });
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
