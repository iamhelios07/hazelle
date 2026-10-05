import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildSync } from 'esbuild';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// The emitted server over real sockets: start, health, session, a second owner refused, a drain on SIGTERM.
let dir: string;
let bundle: string;
const children: ChildProcess[] = [];

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'hazelle-node-'));
  bundle = join(dir, 'node.js');
  buildSync({ entryPoints: ['src/server/node.ts'], bundle: true, platform: 'node', format: 'esm', target: 'node24', outfile: bundle, external: ['undici'], logLevel: 'silent' });
}, 60_000);
afterAll(() => {
  for (const child of children) child.kill('SIGKILL');
  rmSync(dir, { recursive: true, force: true });
});

const freePort = () =>
  new Promise<number>((resolve) => {
    const probe = createServer().listen(0, () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => resolve(port));
    });
  });

function start(dataDir: string, port: number) {
  const child = spawn(process.execPath, [bundle], {
    env: { ...process.env, HAZELLE_DATA: dataDir, PORT: String(port), HAZELLE_DRAIN_SECONDS: '2', HAZELLE_MIGRATIONS: 'migrations' },
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
    expect((await fetch(`http://127.0.0.1:${port}/api/nowhere`)).status).toBe(404);
    expect(server.log()).toContain('"migrationsApplied":["0001_baseline.sql"]');

    const second = start(data, await freePort());
    expect(await second.exited).toBe(1);
    expect(second.log()).toContain('another process holds');

    server.child.kill('SIGTERM');
    expect(await server.exited).toBe(0);
    expect(server.log()).toContain('"event":"stopped"');
  }, 30_000);

  it('answers 503 on health while draining and finishes background work before it stops', async () => {
    const data = join(dir, 'data-drain');
    const port = await freePort();
    const server = start(data, port);
    await server.listening;
    // A request in flight when the signal comes: a slow upload body, answered after the drain began.
    const slow = fetch(`http://127.0.0.1:${port}/api/session`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: new ReadableStream({ start: (body) => void setTimeout(() => body.close(), 300) }), duplex: 'half' } as RequestInit);
    await new Promise((resolve) => setTimeout(resolve, 50));
    server.child.kill('SIGTERM');
    const codes: number[] = [];
    for (let attempt = 0; attempt < 20 && server.child.exitCode === null; attempt++) {
      try {
        codes.push((await fetch(`http://127.0.0.1:${port}/api/health`)).status);
      } catch {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect((await slow).status).toBe(404);
    expect(await server.exited).toBe(0);
    expect(codes.every((code) => code === 503)).toBe(true);
    expect(server.log()).toMatch(/"outcome":"drained"/);
  }, 30_000);
});
