import { describe, expect, it, vi } from 'vitest';
import { createRelay, type Upstream, type UpstreamInit } from './relay';

const envelope = (overrides: Record<string, unknown> = {}) => ({
  url: 'https://api.example.com/v1/chat/completions',
  method: 'POST',
  headers: { authorization: 'Bearer test', 'content-type': 'application/json' },
  body: '{"stream":true}',
  ...overrides,
});

const post = (body: unknown) =>
  new Request('http://localhost/api/relay', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) });

describe('relay', () => {
  it('streams upstream chunks before the upstream finishes', async () => {
    let push!: ReadableStreamDefaultController<Uint8Array>;
    const upstreamBody = new ReadableStream<Uint8Array>({ start: (c) => void (push = c) });
    const relay = createRelay(async () => new Response(upstreamBody, { headers: { 'content-type': 'text/event-stream' } }));

    const response = await relay(post(envelope()));
    const reader = response.body!.getReader();
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    push.enqueue(encoder.encode('data: one\n\n'));
    expect(decoder.decode((await reader.read()).value)).toBe('data: one\n\n');
    push.enqueue(encoder.encode('data: two\n\n'));
    expect(decoder.decode((await reader.read()).value)).toBe('data: two\n\n');
    push.close();
    expect((await reader.read()).done).toBe(true);
  });

  it('forwards the envelope without hop-by-hop or identifying headers', async () => {
    const upstream = vi.fn<Upstream>(async () => new Response('ok'));
    const request = post(
      envelope({
        headers: {
          Authorization: 'Bearer test',
          Host: 'evil.test',
          Cookie: 'a=b',
          'X-Forwarded-For': '10.0.0.1',
          'CF-Connecting-IP': '10.0.0.1',
          Connection: 'keep-alive',
          'anthropic-version': '2023-06-01',
        },
      }),
    );
    await createRelay(upstream)(request);

    const [url, init] = upstream.mock.calls[0] as [URL, UpstreamInit];
    expect(url.href).toBe('https://api.example.com/v1/chat/completions');
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{"stream":true}');
    expect(init.redirect).toBe('manual');
    expect(init.signal).toBe(request.signal);
    expect([...init.headers.keys()].sort()).toEqual(['anthropic-version', 'authorization']);
  });

  it('passes upstream status and headers through, minus the ones that would mislead the browser', async () => {
    const relay = createRelay(
      async () =>
        new Response('{"error":"rate"}', {
          status: 429,
          headers: {
            'content-type': 'application/json',
            'retry-after': '3',
            'x-request-id': 'req_1',
            'set-cookie': 'track=1',
            'content-encoding': 'gzip',
            'www-authenticate': 'Basic',
            'clear-site-data': '"cookies", "storage"',
            nel: '{"report_to":"cf-nel"}',
            'x-relay': 'spoofed',
          },
        }),
    );
    const response = await relay(post(envelope()));

    expect(response.status).toBe(429);
    expect(response.headers.get('x-relay')).toBe('upstream');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('retry-after')).toBe('3');
    expect(response.headers.get('x-request-id')).toBe('req_1');
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(response.headers.get('content-encoding')).toBeNull();
    expect(response.headers.get('www-authenticate')).toBeNull();
    expect(response.headers.get('clear-site-data')).toBeNull();
    expect(response.headers.get('nel')).toBeNull();
    expect(await response.text()).toBe('{"error":"rate"}');
  });

  it('reports a redirect instead of relaying it', async () => {
    const relay = createRelay(async () => new Response(null, { status: 302, headers: { location: 'https://elsewhere.test/' } }));
    const response = await relay(post(envelope()));

    expect(response.status).toBe(502);
    expect(response.headers.get('x-relay')).toBe('error');
    expect(await response.json()).toEqual({ error: 'upstream-redirect', status: 302, location: 'https://elsewhere.test/' });
  });

  it.each([
    ['not JSON', 'nope'],
    ['a missing URL', envelope({ url: undefined })],
    ['an unknown method', envelope({ method: 'CONNECT' })],
    ['a GET with a body', envelope({ method: 'GET' })],
    ['a non-string header', envelope({ headers: { a: 1 } })],
  ])('refuses an envelope with %s', async (_label, body) => {
    const upstream = vi.fn<Upstream>();
    const response = await createRelay(upstream)(post(body));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'bad-envelope' });
    expect(upstream).not.toHaveBeenCalled();
  });

  it('refuses a non-https or non-public target before any network call', async () => {
    const upstream = vi.fn<Upstream>();
    const relay = createRelay(upstream);

    expect(await (await relay(post(envelope({ url: 'http://api.example.com/' })))).json()).toEqual({ error: 'not-https' });
    expect(await (await relay(post(envelope({ url: 'https://10.0.0.1/' })))).json()).toEqual({ error: 'not-public' });
    expect(upstream).not.toHaveBeenCalled();
  });

  it('reports a failed upstream call as unreachable', async () => {
    const relay = createRelay(async () => {
      throw new TypeError('fetch failed');
    });
    const response = await relay(post(envelope()));

    expect(response.status).toBe(502);
    expect(response.headers.get('x-relay')).toBe('error');
    expect(await response.json()).toEqual({ error: 'upstream-unreachable' });
  });
});
