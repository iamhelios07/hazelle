import { getPlatformProxy } from 'wrangler';
import { d1Reads } from './account-store';
import { sha256Hex } from './http';
import { createRelay, type Upstream } from './relay';
import { nodeStores } from './store-db-node';
import { StreamBox, type BoxStorage } from './stream-box';
import app from './worker';

const migrations = import.meta.glob<string>('../../migrations/*.sql', { query: '?raw', import: 'default', eager: true });

// An in-memory local D1 with every migration applied, a local R2, and a client that calls the app in-process. upstream
// answers the calls Relay and ReplyStream make (tech-spec §6, Detached replies). placed holds the options each Durable
// Object was got with. stores: the accounts' stores in process (store-db-node), whose bookmarks are stamped by clock.
export async function testApp(upstream: Upstream = () => Promise.reject(new TypeError('This test gave the streams no upstream.'))) {
  const proxy = await getPlatformProxy<Env>({ configPath: 'wrangler.test.jsonc', persist: false, remoteBindings: false });
  const placed: unknown[] = [];
  const clock = { now: () => Date.now() };
  const stores = nodeStores(d1Reads(proxy.env.DB), () => clock.now());
  // ADMIN_ACCOUNT: a test names its operator after signing it up, since nobody signs up as the operator's id.
  const env = {
    ...proxy.env,
    STREAMS: streamObjects(upstream, placed),
    RELAY: relayObjects(upstream, placed),
    STORES: stores as unknown as Env['STORES'],
    ADMIN_ACCOUNT: '' as string,
  };
  for (const name of Object.keys(migrations).sort()) {
    const statements = migrations[name]!.split(';').filter((s) => s.trim());
    await env.DB.batch(statements.map((s) => env.DB.prepare(s)));
  }

  // As a page holding the cookie's account sends it: stating that account (server/session). raw states only what it is
  // given. A Uint8Array body goes as bytes.
  const holding = async (cookie: string): Promise<Record<string, string>> => {
    const account = await env.DB.prepare('SELECT account_id FROM sessions WHERE token_hash = ?').bind(await sha256Hex(cookie.split('=')[1]!)).first<string>('account_id');
    return account ? { cookie, 'x-account': account } : { cookie };
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
    );
  };

  return {
    env,
    placed,
    stores,
    clock,
    dispose: () => proxy.dispose(),
    reset: async () => {
      env.ADMIN_ACCOUNT = '';
      clock.now = () => Date.now();
      await env.DB.batch([
        ...['objects', 'files', 'file_blocks', 'restores', 'account_files', 'vaults', 'sessions', 'accounts', 'reports', 'admin_log'].map((table) => env.DB.prepare(`DELETE FROM ${table}`)),
        env.DB.prepare('UPDATE service SET signup_cap = 1, account_bytes_cap = NULL, account_file_bytes_cap = NULL'),
      ]);
      for (let listed = await env.BLOBS.list(); listed.objects.length; listed = await env.BLOBS.list()) {
        await env.BLOBS.delete(listed.objects.map(({ key }) => key));
      }
    },
    get: (path: string, cookie?: string) => send('GET', path, undefined, cookie),
    post: (path: string, body?: unknown, cookie?: string) => send('POST', path, body, cookie),
    put: (path: string, body?: unknown, cookie?: string) => send('PUT', path, body, cookie),
    delete: (path: string, body?: unknown, cookie?: string) => send('DELETE', path, body, cookie),
    raw: (path: string, init: RequestInit) => app.request(`/api/${path}`, init, env),
  };
}

// ReplyStream's namespace, in process: one StreamBox per name over a map, which is all its Durable Object adds.
function streamObjects(upstream: Upstream, placed: unknown[]) {
  const boxes = new Map<string, StreamBox>();
  const storage = (): BoxStorage => {
    const held = new Map<string, unknown>();
    return {
      get: async (key) => held.get(key),
      put: async (key, value) => void held.set(key, value),
      list: async ({ start, end, limit }) => new Map([...held].filter(([key]) => key >= start && key < end).sort(([a], [b]) => (a < b ? -1 : 1)).slice(0, limit)),
      deleteAll: async () => held.clear(),
      setAlarm: async () => {},
    };
  };
  const box = (name: string) => boxes.get(name) ?? boxes.set(name, new StreamBox(storage(), upstream)).get(name)!;
  return {
    idFromName: (name: string) => name,
    get: (name: string, options: unknown) => {
      placed.push(options);
      return { fetch: (input: string, init?: RequestInit) => box(name).handle(new Request(input, init)) };
    },
  } as unknown as Env['STREAMS'];
}

function relayObjects(upstream: Upstream, placed: unknown[]) {
  const relay = createRelay(upstream);
  return {
    newUniqueId: () => crypto.randomUUID(),
    get: (_id: string, options: unknown) => {
      placed.push(options);
      return { fetch: (request: Request) => relay(request) };
    },
  } as unknown as Env['RELAY'];
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
