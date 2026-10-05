import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { clientFiles, CSP } from './static';

let dir: string;
let client: ReturnType<typeof clientFiles>;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'hazelle-client-'));
  mkdirSync(join(dir, 'assets'));
  for (const [name, body] of [
    ['index.html', '<!doctype html>page'],
    ['assets/main-h1.js', 'main'],
    ['assets/evaluation-worker-h2.js', 'worker'],
    ['assets/tokenizer-h3.wasm', 'wasm'],
    ['license.txt', 'license'],
    ['source.tar.gz', 'source'],
  ]) {
    writeFileSync(join(dir, name!), body!);
  }
  client = clientFiles(dir);
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
    }
  });

  it('answers a page load of any path that is no file with the page, dotted model routes included', async () => {
    for (const path of ['/terms', '/privacy', '/models/c1/vendor/model-4.5', '/chats/abc']) {
      const response = await client.request(path, { headers: PAGE });
      expect([path, response.status, response.headers.get('cache-control'), await response.text()]).toEqual([path, 200, 'no-cache', '<!doctype html>page']);
      expect(response.headers.get('content-security-policy')).toBe(CSP);
    }
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
