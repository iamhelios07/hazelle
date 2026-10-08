import { spawn, type ChildProcess } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, watch, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { buildSync } from 'esbuild';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MAX_FILE_BYTES } from './files';
import { CSP } from './static';
import { sessionCookie, signupBody } from './testing';

// The emitted server over real sockets: start, health, session, the page, a second owner refused, a drain on SIGTERM,
// uploads cut by one.
let dir: string;
let bundle: string;
let client: string;
const children: ChildProcess[] = [];

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'hazelle-node-'));
  // The bundle keeps undici external as build:server does, so it must sit where node_modules resolves.
  mkdirSync('node_modules/.cache', { recursive: true });
  bundle = join('node_modules', '.cache', `hazelle-node-${process.pid}.js`);
  client = join(dir, 'client');
  mkdirSync(client);
  writeFileSync(join(client, 'index.html'), 'page');
  buildSync({ entryPoints: ['src/server/node.ts'], bundle: true, platform: 'node', format: 'esm', target: 'node24', outfile: bundle, external: ['undici'], logLevel: 'silent' });
}, 60_000);
afterAll(() => {
  for (const child of children) child.kill('SIGKILL');
  rmSync(dir, { recursive: true, force: true });
  rmSync(bundle, { force: true });
});

const freePort = () =>
  new Promise<number>((resolve) => {
    const probe = createServer().listen(0, () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => resolve(port));
    });
  });

function start(dataDir: string, port: number, extra: Record<string, string> = {}) {
  const child = spawn(process.execPath, [bundle], {
    env: { ...process.env, HAZELLE_DATA: dataDir, PORT: String(port), HAZELLE_DRAIN_SECONDS: '2', HAZELLE_MIGRATIONS: 'migrations', HAZELLE_CLIENT: client, ...extra },
    cwd: process.cwd(),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(child);
  let out = '';
  child.stdout!.on('data', (chunk: Buffer) => (out += chunk.toString()));
  child.stderr!.on('data', (chunk: Buffer) => (out += chunk.toString()));
  const exited = new Promise<number | null>((resolve) => child.on('exit', (code) => resolve(code)));
  const listening = new Promise<void>((resolve, reject) => {
    const started = Date.now();
    const poll = async () => {
      if (child.exitCode !== null) return reject(new Error(`exited early: ${out}`));
      try {
        if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) return resolve();
      } catch {
        // not up yet
      }
      if (Date.now() - started > 15_000) return reject(new Error(`never listened: ${out}`));
      setTimeout(poll, 100);
    };
    void poll();
  });
  // A process expected to exit never listens; its rejection is read only when a test awaits it.
  listening.catch(() => {});
  return { child, exited, listening, log: () => out };
}

describe('the server process', () => {
  it('starts on an empty directory, migrates, answers health and session, and refuses a second process on the directory', async () => {
    const data = join(dir, 'data');
    const port = await freePort();
    const server = start(data, port);
    await server.listening;
    expect(await (await fetch(`http://127.0.0.1:${port}/api/health`)).json()).toEqual({ ok: true, liveCalls: 0, backupAgeHours: null, diskFreePercent: expect.any(Number) });
    expect(await (await fetch(`http://127.0.0.1:${port}/api/session`)).json()).toEqual({ session: null, signupOpen: true });
    const unknown = await fetch(`http://127.0.0.1:${port}/api/nowhere`, { headers: { accept: 'text/html' } });
    expect([unknown.status, unknown.headers.get('content-security-policy')]).toEqual([404, null]);
    const page = await fetch(`http://127.0.0.1:${port}/models/c1/vendor/model-4.5`, { headers: { accept: 'text/html' } });
    expect([page.status, page.headers.get('content-security-policy'), await page.text()]).toEqual([200, CSP, 'page']);
    expect(server.log()).toContain('"migrationsApplied":["0001_baseline.sql","0002_call_counts.sql"]');

    const second = start(data, await freePort());
    expect(await second.exited).toBe(1);
    expect(second.log()).toContain('another process holds');

    server.child.kill('SIGTERM');
    expect(await server.exited).toBe(0);
    expect(server.log()).toContain('"event":"stopped"');
  }, 30_000);

  it('takes a variable left empty as its default, refuses one that is no number, and captures a generation on SIGUSR2 without stopping', async () => {
    const refused = start(join(dir, 'data-bad-env'), await freePort(), { HAZELLE_SNAPSHOT_HOUR: '24' });
    expect(await refused.exited).toBe(1);
    expect(refused.log()).toContain('HAZELLE_SNAPSHOT_HOUR must be a whole number from 0 to 23');

    const data = join(dir, 'data-signal');
    const port = await freePort();
    // An empty drain would be zero seconds: the SIGTERM below must still report a drain, not a timeout at once.
    const server = start(data, port, { HAZELLE_SNAPSHOT_HOUR: '', HAZELLE_DRAIN_SECONDS: '' });
    await server.listening;
    server.child.kill('SIGUSR2');
    const captured = async () => {
      for (let attempt = 0; attempt < 100; attempt++) {
        const made = readdirSync(join(data, 'backup'), { withFileTypes: true }).filter((entry) => entry.isDirectory() && entry.name !== 'files');
        if (made.some((entry) => readdirSync(join(data, 'backup', entry.name)).includes('manifest.json'))) return true;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      return false;
    };
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(await captured()).toBe(true);
    // The line follows the manifest by the listing the handler makes for the id.
    for (let attempt = 0; attempt < 100 && !server.log().includes('backup finished'); attempt++) await new Promise((resolve) => setTimeout(resolve, 20));
    expect(server.log()).toMatch(/"event":"backup finished","snapshots":"ok","generation":"ok","id":"\d+-/);
    expect((await fetch(`http://127.0.0.1:${port}/api/health`)).status).toBe(200);
    server.child.kill('SIGTERM');
    expect(await server.exited).toBe(0);
    expect(server.log()).toMatch(/"drainMs":60000/);
  }, 30_000);

  it('answers the request in flight on SIGTERM, refuses new connections, and exits 0 once drained', async () => {
    const data = join(dir, 'data-drain');
    const port = await freePort();
    const server = start(data, port);
    await server.listening;
    // A request in flight when the signal comes: its body arrives after the drain began.
    const slow = new Promise<number>((resolve, reject) => {
      const sending = request({ host: '127.0.0.1', port, method: 'POST', path: '/api/session', headers: { 'content-type': 'application/json', 'content-length': 2 } }, (response) => {
        response.resume();
        response.on('end', () => resolve(response.statusCode!));
      });
      sending.on('error', reject);
      setTimeout(() => sending.end('{}'), 300);
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    server.child.kill('SIGTERM');
    // Until the signal is handled the server still answers 200; on a slow runner that takes longer than a fetch.
    for (let attempt = 0; attempt < 100 && !server.log().includes('"event":"draining"'); attempt++) await new Promise((resolve) => setTimeout(resolve, 20));
    // server.close drops idle connections and refuses new ones at once, so health's 503 is for a request already on
    // the wire; a new connection during the drain is refused.
    let refused = false;
    for (let attempt = 0; attempt < 20 && !refused && server.child.exitCode === null; attempt++) {
      await fetch(`http://127.0.0.1:${port}/api/health`).then(
        (response) => expect(response.status).toBe(503),
        () => (refused = true),
      );
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(await slow).toBe(404);
    expect(await server.exited).toBe(0);
    expect(refused).toBe(true);
    expect(server.log()).toMatch(/"outcome":"drained"/);
  }, 30_000);

  it('finishes a 25 MiB upload signalled while its body arrives or while its bytes are written, with one charge and no temp file after a restart', async () => {
    const data = join(dir, 'data-upload');
    let port = await freePort();
    let server = start(data, port);
    await server.listening;
    const body = signupBody();
    const cookie = sessionCookie(await fetch(`http://127.0.0.1:${port}/api/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }));
    const service = new DatabaseSync(join(data, 'service.sqlite'), { readOnly: true });
    const incarnation = service.prepare('SELECT incarnation FROM accounts WHERE id = ?').get(body.accountId)!.incarnation as string;
    service.close();
    const pictures = join(data, 'files', incarnation);
    const pictureOf = () => {
      const bytes = randomBytes(MAX_FILE_BYTES);
      return { bytes, id: createHash('sha256').update(bytes).digest('hex') };
    };
    // Sent as a browser sends a picture: with its length, here in 1 MiB pieces, `afterPiece` called after each.
    const upload = (picture: ReturnType<typeof pictureOf>, afterPiece: (piece: number) => Promise<void>) =>
      new Promise<number>((resolve, reject) => {
        const sending = request(
          {
            host: '127.0.0.1',
            port,
            method: 'PUT',
            path: `/api/files/${picture.id}`,
            headers: { cookie, 'x-account': body.accountId, 'content-type': 'application/octet-stream', 'content-length': picture.bytes.length },
          },
          (response) => {
            response.resume();
            response.on('end', () => resolve(response.statusCode!));
          },
        );
        sending.on('error', reject);
        void (async () => {
          const piece = 1024 * 1024;
          for (let at = 0; at < picture.bytes.length; at += piece) {
            sending.write(picture.bytes.subarray(at, at + piece));
            await afterPiece(at / piece);
          }
          sending.end();
        })();
      });

    const receiving = pictureOf();
    const receivingStatus = upload(receiving, async (piece) => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      if (piece === 4) server.child.kill('SIGTERM');
    });
    expect(await receivingStatus).toBe(204);
    expect(await server.exited).toBe(0);
    expect(server.log()).toMatch(/"outcome":"drained"/);

    port = await freePort();
    server = start(data, port);
    await server.listening;
    const publishing = pictureOf();
    let signalled = false;
    const watching = watch(pictures, (_, name) => {
      if (signalled || !name?.startsWith('.tmp-')) return;
      signalled = true;
      server.child.kill('SIGTERM');
    });
    try {
      expect(await upload(publishing, async () => {})).toBe(204);
    } finally {
      watching.close();
    }
    expect(signalled).toBe(true);
    expect(await server.exited).toBe(0);
    expect(server.log()).toMatch(/"outcome":"drained"/);

    port = await freePort();
    server = start(data, port);
    await server.listening;
    expect(await upload(receiving, async () => {})).toBe(204);
    for (const { id } of [receiving, publishing]) {
      const read = await fetch(`http://127.0.0.1:${port}/api/files/${id}`, { headers: { cookie, 'x-account': body.accountId } });
      expect(createHash('sha256').update(new Uint8Array(await read.arrayBuffer())).digest('hex')).toBe(id);
    }
    server.child.kill('SIGTERM');
    expect(await server.exited).toBe(0);
    const after = new DatabaseSync(join(data, 'service.sqlite'), { readOnly: true });
    expect(after.prepare('SELECT file_bytes FROM accounts WHERE incarnation = ?').get(incarnation)).toEqual({ file_bytes: 2 * MAX_FILE_BYTES });
    expect(after.prepare('SELECT id, size, stored FROM account_files WHERE incarnation = ? ORDER BY id').all(incarnation)).toEqual(
      [receiving.id, publishing.id].sort().map((id) => ({ id, size: MAX_FILE_BYTES, stored: 1 })),
    );
    after.close();
    expect(readdirSync(pictures).sort()).toEqual([receiving.id, publishing.id].sort());
  }, 30_000);
});
