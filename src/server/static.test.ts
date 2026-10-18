import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PulseAnswer, PulseBoard } from '../contracts/pulse';
import { clientFiles, CSP, SANDBOX_CSP, SANDBOX_NETWORK_CSP } from './static';

let dir: string;
let client: ReturnType<typeof clientFiles>;
let pulse: () => Promise<PulseAnswer>;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'hazelle-client-'));
  mkdirSync(join(dir, 'assets'));
  for (const [name, body] of [
    ['index.html', '<!doctype html>page'],
    ['sandbox.html', readFileSync('sandbox.html', 'utf8')],
    ['assets/main-h1.js', 'main'],
    ['assets/evaluation-worker-h2.js', 'worker'],
    ['assets/tokenizer-h3.wasm', 'wasm'],
    ['license.txt', 'license'],
    ['source.tar.gz', 'source'],
  ]) {
    writeFileSync(join(dir, name!), body!);
  }
  client = clientFiles(dir, async (share) => (share === 'covered-share-id' ? { name: 'Mira <b>', creator: 'jin & co', line: '$& "quoted"' } : null), () => pulse());
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const PAGE = { accept: 'text/html,application/xhtml+xml,*/*;q=0.8' };
const ANY = { accept: '*/*' };

describe('the client files', () => {
  it('serves hashed assets as immutable with their types, other files and the page as no-cache, all under the CSP', async () => {
    const cases: [path: string, type: string, cache: string, body: string][] = [
      ['/assets/main-h1.js', 'text/javascript; charset=utf-8', 'public, max-age=31536000, immutable', 'main'],
      ['/assets/evaluation-worker-h2.js', 'text/javascript; charset=utf-8', 'public, max-age=31536000, immutable', 'worker'],
      ['/assets/tokenizer-h3.wasm', 'application/wasm', 'public, max-age=31536000, immutable', 'wasm'],
      ['/license.txt', 'text/plain; charset=utf-8', 'no-cache', 'license'],
      ['/source.tar.gz', 'application/gzip', 'no-cache', 'source'],
      ['/', 'text/html; charset=utf-8', 'no-cache', '<!doctype html>page'],
    ];
    for (const [path, type, cache, body] of cases) {
      const response = await client.request(path, { headers: ANY });
      expect([path, response.status, response.headers.get('content-type'), response.headers.get('cache-control'), await response.text()]).toEqual([path, 200, type, cache, body]);
      expect(response.headers.get('content-security-policy')).toBe(CSP);
      expect(response.headers.get('x-content-type-options')).toBe('nosniff');
      expect(response.headers.get('referrer-policy')).toBe('no-referrer');
      expect(response.headers.get('access-control-allow-origin')).toBe(path.startsWith('/assets/') ? '*' : null);
    }
  });

  it('answers a page load of any path that is no file with the page, dotted model routes included', async () => {
    for (const path of ['/terms', '/privacy', '/models/c1/vendor/model-4.5', '/chats/abc']) {
      const response = await client.request(path, { headers: PAGE });
      expect([path, response.status, response.headers.get('cache-control'), await response.text()]).toEqual([path, 200, 'no-cache', '<!doctype html>page']);
      expect(response.headers.get('content-security-policy')).toBe(CSP);
    }
  });

  it("fills a share page's embed with its escaped cover text, and never with a picture", async () => {
    writeFileSync(join(dir, 'index.html'), '<title>헤이젤</title><meta name="description" content="app" /><meta property="og:title" content="헤이젤" /><meta property="og:description" content="app" /><meta property="og:image" content="https://hazelle.app/og.png" /><meta name="twitter:card" content="summary_large_image" />');
    const covered = await (await client.request('/s/covered-share-id', { headers: PAGE })).text();
    expect(covered).toBe('<title>Mira &#60;b&#62; · jin &#38; co</title><meta name="description" content="$&#38; &#34;quoted&#34;" /><meta property="og:title" content="Mira &#60;b&#62; · jin &#38; co" /><meta property="og:description" content="$&#38; &#34;quoted&#34;" /><meta name="twitter:card" content="summary" />');
    const bare = await client.request('/s/no-cover-share00', { headers: PAGE });
    expect([bare.headers.get('content-security-policy'), await bare.text()]).toEqual([CSP, '<title>헤이젤</title><meta name="description" content="app" /><meta property="og:title" content="헤이젤" /><meta property="og:description" content="app" /><meta name="twitter:card" content="summary" />']);
    writeFileSync(join(dir, 'index.html'), '<!doctype html>page');
  });

  it("fills 헤이젤 나우's embed with the board's escaped numbers and its first named 대화 model, keeping the picture", async () => {
    const html = '<title>헤이젤</title><meta name="description" content="app" /><meta property="og:title" content="헤이젤" /><meta property="og:description" content="app" /><meta property="og:image" content="https://hazelle.app/og.png" />';
    writeFileSync(join(dir, 'index.html'), html);
    const row = (model: string | null) => ({ key: model ?? '', model, share: 0.5, people: 5 });
    const board = { week: { from: 0, people: 4560 }, replies: 12340, ranking: { chat: { merged: [row(null), row('GPT <5> & "co"')], split: [] } } } as unknown as PulseBoard;
    pulse = async () => ({ starts: 0, at: 0, board });
    const page = async () => (await client.request('/now', { headers: PAGE })).text();
    expect(await page()).toBe(
      '<title>헤이젤 나우 · 대화 1위 GPT &#60;5&#62; &#38; &#34;co&#34;</title><meta name="description" content="최근 24시간 응답 12,340번 · 이번 주 4,560명이 썼어요" /><meta property="og:title" content="헤이젤 나우 · 대화 1위 GPT &#60;5&#62; &#38; &#34;co&#34;" /><meta property="og:description" content="최근 24시간 응답 12,340번 · 이번 주 4,560명이 썼어요" /><meta property="og:image" content="https://hazelle.app/og.png" />',
    );
    for (const answer of [() => Promise.resolve({ starts: 0, at: 0, board: null }), () => Promise.reject(new Error('down'))]) {
      pulse = answer;
      expect(await page()).toBe(html);
    }
    writeFileSync(join(dir, 'index.html'), '<!doctype html>page');
  });

  it('answers a real 404 for a missing asset even on a page load, and for a missing file nobody loads as a page', async () => {
    for (const [path, headers] of [
      ['/assets/gone-h9.js', PAGE],
      ['/assets/gone-h9.js', ANY],
      ['/favicon.ico', { accept: 'image/avif,image/webp,*/*;q=0.8' }],
    ] as const) {
      const response = await client.request(path, { headers });
      expect([path, response.status, response.headers.get('cache-control')]).toEqual([path, 404, null]);
      expect(response.headers.get('content-security-policy')).toBe(CSP);
    }
  });
});


it('serves the opaque tool document with a classic script and its own CSP, never the app policy', async () => {
  const response = await client.request('/sandbox.html?role=background', { headers: PAGE });
  const html = await response.text();
  expect(response.status).toBe(200);
  expect(response.headers.get('content-security-policy')).toBe(SANDBOX_CSP);
  expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  expect(response.headers.get('referrer-policy')).toBe('no-referrer');
  expect(response.headers.get('cache-control')).toBe('no-cache');
  expect(html).toContain('<script src="/sandbox/host.js"></script>');
  expect(html).not.toMatch(/type\s*=\s*['"]module['"]/i);
  expect(SANDBOX_CSP).toContain('sandbox allow-scripts');
  expect(SANDBOX_CSP).toContain("connect-src 'none'");
  expect(SANDBOX_CSP).toContain("frame-src 'none'");
  expect(CSP).toContain("frame-src 'self'");
  expect(CSP).not.toContain('sandbox allow-scripts');
  expect((await client.request('/', { headers: PAGE })).headers.get('content-security-policy')).toBe(CSP);
});

it('serves a frame with network consent pictures, fonts and stylesheets from outside, and never a connection', async () => {
  const policy = async (query: string) => (await client.request(`/sandbox.html?${query}`, { headers: PAGE })).headers.get('content-security-policy');
  const wide = await policy('role=frame&network=1');
  expect(wide).toBe(SANDBOX_NETWORK_CSP);
  expect(wide).toContain('img-src data: blob: https:;');
  expect(wide).toContain("font-src 'self' data: https:;");
  expect(wide).toContain("connect-src 'none'");
  expect(wide).toContain("frame-ancestors 'self'");
  for (const query of ['role=frame', 'role=frame&network=yes', 'role=page']) expect(await policy(query)).toBe(SANDBOX_CSP);
  expect(SANDBOX_CSP).not.toContain('https:');
});
