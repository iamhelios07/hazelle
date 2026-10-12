import { createServer } from 'node:http';

// A chat-completions provider that streams one SSE chunk every intervalMs for seconds, as the request's `load` asks.
// Run with plain node (type stripping); it imports nothing local. Usage: node fake-provider.ts <port>

const port = Number(process.argv[2]);
let open = 0;

createServer((request, response) => {
  let raw = '';
  request.on('data', (chunk: Buffer) => (raw += chunk.toString()));
  request.on('end', () => {
    const { load } = JSON.parse(raw || '{}') as { load?: { seconds: number; intervalMs: number; bytes: number } };
    const { seconds = 30, intervalMs = 50, bytes = 200 } = load ?? {};
    response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    open++;
    const text = 'x'.repeat(bytes);
    const ends = Date.now() + seconds * 1000;
    const timer = setInterval(() => {
      if (Date.now() >= ends) {
        response.end('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
        return clearInterval(timer);
      }
      response.write(`data: {"id":"load","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"${text}"}}]}\n\n`);
    }, intervalMs);
    response.on('close', () => {
      clearInterval(timer);
      open--;
    });
  });
}).listen(port, '0.0.0.0', () => console.log(JSON.stringify({ listening: port })));

setInterval(() => open && console.log(JSON.stringify({ at: new Date().toISOString(), open })), 10_000).unref();
