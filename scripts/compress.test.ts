import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import { clientFiles, CSP } from '../src/server/static';
import { compressClient } from './compress';

it('serves generated Brotli and gzip assets with their original type and cache policy, varying uncompressed replies too', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hazelle-compressed-'));
  try {
    await mkdir(join(dir, 'assets'));
    const body = 'export const greeting = "hello";\n'.repeat(200);
    await writeFile(join(dir, 'assets/main-h1.js'), body);
    await writeFile(join(dir, 'assets/font-h2.woff2'), body);
    await compressClient(dir);
    const client = clientFiles(dir, async () => null, () => Promise.reject(new Error('no pulse')));
    for (const [encoding, decode] of [['br', brotliDecompressSync], ['gzip', gunzipSync]] as const) {
      const response = await client.request('/assets/main-h1.js', { headers: { 'accept-encoding': encoding } });
      expect(response.headers.get('content-encoding')).toBe(encoding);
      expect(response.headers.get('content-type')).toBe('text/javascript; charset=utf-8');
      expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
      expect(response.headers.get('content-security-policy')).toBe(CSP);
      expect(response.headers.get('vary')).toBe('Accept-Encoding');
      expect(decode(new Uint8Array(await response.arrayBuffer())).toString()).toBe(body);
    }
    const plain = await client.request('/assets/main-h1.js');
    expect(plain.headers.get('content-encoding')).toBeNull();
    expect(plain.headers.get('vary')).toBe('Accept-Encoding');
    expect(await plain.text()).toBe(body);
    await expect(readFile(join(dir, 'assets/font-h2.woff2.br'))).rejects.toMatchObject({ code: 'ENOENT' });
    await writeFile(join(dir, 'assets/main-h1.js'), 'tiny');
    await compressClient(dir);
    const replaced = await client.request('/assets/main-h1.js', { headers: { 'accept-encoding': 'br, gzip' } });
    expect(replaced.headers.get('content-encoding')).toBeNull();
    expect(await replaced.text()).toBe('tiny');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
