import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ExecutionContext } from 'hono';
import { ACCOUNT_HEADER } from '../contracts/http';
import { serviceReads } from './account-store';
import { alerts } from './alerts';
import { backups } from './backup/backups';
import { accountRegistry } from './db/account-db';
import { migrate } from './db/migrate';
import { openDatabase, serviceDb } from './db/service-db';
import { diskBucket } from './files/disk-bucket';
import { sha256Hex, type Services } from './http';
import { tokenBucket, visitorLimits } from './limits';
import { reconcile } from './reconcile';
import type { Upstream } from './relay';
import { streamRegistry } from './stream-registry';
import { streamStore } from './db/streams-db';
import app from './worker';

// The server in process over the production adapters on a temp directory (node.ts builds the same Services on /data).
// upstream answers the provider calls the relay and the streams make. clock stamps the stores' snapshots.
export async function testApp(upstream: Upstream = () => Promise.reject(new TypeError('This test gave the streams no upstream.'))) {
  const dir = mkdtempSync(join(tmpdir(), 'hazelle-test-'));
  const raw = openDatabase(join(dir, 'service.sqlite'));
  migrate(raw, 'migrations');
  const db = serviceDb(raw);
  const clock = { now: () => Date.now() };
  const registry = () => accountRegistry(dir, db, serviceReads(db), () => clock.now());
  const disk = { freePercent: 50 };
  const outbound: Upstream = (url, init) => upstream(url, init);
  const env: Services = {
    db,
    files: diskBucket(dir),
    stores: registry(),
    streams: streamRegistry(streamStore(join(dir, 'streams.sqlite')), outbound),
    outbound,
    localProviders: new Set(),
    limits: { calls: tokenBucket(240), botCalls: tokenBucket(20), visitors: visitorLimits() },
    backups: backups(dir, 3, alerts('https://alerts.test/hook'), async () => disk.freePercent),
  };

  const pending: Promise<unknown>[] = [];
  const ctx = { waitUntil: (work: Promise<unknown>) => void pending.push(work), passThroughOnException: () => {}, props: {} } as ExecutionContext;
  const settle = async () => {
    while (pending.length) await Promise.all(pending.splice(0));
  };

  // As a page holding the cookie's account sends it: stating that account (server/session). raw states only what it is
  // given. A Uint8Array body goes as bytes.
  const holding = async (cookie: string): Promise<Record<string, string>> => {
    const account = await env.db.prepare('SELECT account_id FROM sessions WHERE token_hash = ?').bind(await sha256Hex(cookie.split('=')[1]!)).first<string>('account_id');
    return account ? { cookie, [ACCOUNT_HEADER]: account } : { cookie };
  };
  const send = async (method: string, path: string, body?: unknown, cookie?: string) => {
    const bytes = body instanceof Uint8Array;
    return app.request(
      `/api/${path}`,
      {
        method,
        headers: { ...(method === 'GET' ? {} : { 'content-type': bytes ? 'application/octet-stream' : 'application/json' }), ...(cookie ? await holding(cookie) : {}) },
        body: body === undefined ? undefined : bytes ? (body as Uint8Array<ArrayBuffer>) : JSON.stringify(body),
      },
      env,
      ctx,
    );
  };
  const timeline = async (cookie: string) => ((await (await send('GET', 'objects?since=0', undefined, cookie)).json()) as { timeline: string }).timeline;

  return {
    env,
    dir,
    clock,
    disk,
    get stores() {
      return env.stores;
    },
    dispose: () => {
      env.stores.close();
      env.streams.close();
      raw.close();
      rmSync(dir, { recursive: true, force: true });
    },
    reset: async () => {
      await settle();
      await env.streams.expire(Number.MAX_SAFE_INTEGER);
      clock.now = () => Date.now();
      env.stores.close();
      await env.db.batch([
        ...['share_files', 'share_versions', 'shares', 'file_blocks', 'restores', 'account_files', 'notices', 'vaults', 'sessions', 'accounts', 'reports', 'admin_log', 'snapshots', 'backup_runs', 'alerts_sent'].map((table) => env.db.prepare(`DELETE FROM ${table}`)),
        env.db.prepare('UPDATE installation SET operator_account = NULL'),
        env.db.prepare('UPDATE service SET signup_cap = 1, account_bytes_cap = NULL, account_file_bytes_cap = NULL'),
      ]);
      for (const sub of ['accounts', 'files', 'snapshots', 'backup']) rmSync(join(dir, sub), { recursive: true, force: true });
      env.stores = registry();
    },
    get: (path: string, cookie?: string) => send('GET', path, undefined, cookie),
    post: (path: string, body?: unknown, cookie?: string) => send('POST', path, body, cookie),
    put: (path: string, body?: unknown, cookie?: string) => send('PUT', path, body, cookie),
    delete: (path: string, body?: unknown, cookie?: string) => send('DELETE', path, body, cookie),
    raw: (path: string, init: RequestInit) => app.request(`/api/${path}`, init, env, ctx),
    settle,
    timeline,
    reconcile: (now = Date.now()) => reconcile(dir, env.db, env.files, now),
    // The account's row changed in the service, then its store restarted, as every lifecycle change is made
    // (server/lifecycle).
    lifecycle: async (accountId: string, set: string) => {
      const incarnation = await env.db.prepare(`UPDATE accounts SET ${set} WHERE id = ? RETURNING incarnation`).bind(accountId).first<string>('incarnation');
      await env.stores.getByName(incarnation!).restart(incarnation!).catch(() => {});
    },
    batch: async (writes: unknown[], cookie: string) => send('POST', 'objects/batch', { timeline: await timeline(cookie), writes }, cookie),
    // The daily job at a time, with the stores' clock set to it so the baselines it takes carry that time.
    daily: async (now: number) => {
      clock.now = () => now;
      return env.backups.daily(env, now);
    },
    // The registry as a new process would start it over the same directory: every open account file closed, nothing
    // remembered. The service connection and the other services stay as they are.
    restartProcess: () => {
      env.stores.close();
      env.stores = registry();
    },
  };
}

export const sessionCookie = (response: Response) => response.headers.get('set-cookie')!.split(';')[0]!;

// A proof as the client would send it: 32 bytes in base64. The server never learns how it was derived.
export const proof = (seed: string) => btoa(seed.repeat(32).slice(0, 32));

export const signupBody = (username = 'jin') => ({
  accountId: crypto.randomUUID(),
  username,
  passwordProof: proof('password'),
  recoveryProof: proof('recovery'),
  passwordWrap: 'cGFzc3dvcmQgd3JhcA==',
  recoveryWrap: 'cmVjb3Zlcnkgd3JhcA==',
});
