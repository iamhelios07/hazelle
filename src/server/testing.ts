import { getPlatformProxy } from 'wrangler';
import { createRelay, type Upstream } from './relay';
import { StreamBox, type BoxStorage } from './stream-box';
import app from './worker';

const migrations = import.meta.glob<string>('../../migrations/*.sql', { query: '?raw', import: 'default', eager: true });

// An in-memory local D1 with every migration applied, and a client that calls the app in-process. upstream answers
// the calls Relay and ReplyStream make (tech-spec §6, Detached replies). placed holds the options each Durable Object
// was got with.
export async function testApp(upstream: Upstream = () => Promise.reject(new TypeError('This test gave the streams no upstream.'))) {
  const proxy = await getPlatformProxy<Env>({ configPath: 'wrangler.test.jsonc', persist: false, remoteBindings: false });
  const placed: unknown[] = [];
  const env = { ...proxy.env, STREAMS: streamObjects(upstream, placed), RELAY: relayObjects(upstream, placed) };
  for (const name of Object.keys(migrations).sort()) {
    const statements = migrations[name]!.split(';').filter((s) => s.trim());
    await env.DB.batch(statements.map((s) => env.DB.prepare(s)));
  }

  const send = (method: string, path: string, body?: unknown, cookie?: string) =>
    app.request(
      `/api/${path}`,
      {
        method,
        headers: { ...(method === 'GET' ? {} : { 'content-type': 'application/json' }), ...(cookie ? { cookie } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      },
      env,
    );

  return {
    env,
    placed,
    dispose: () => proxy.dispose(),
    reset: () => env.DB.batch(['objects', 'files', 'vaults', 'sessions', 'accounts'].map((table) => env.DB.prepare(`DELETE FROM ${table}`))),
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
      list: async ({ prefix }) => new Map([...held].filter(([key]) => key.startsWith(prefix))),
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
