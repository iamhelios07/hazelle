import { getPlatformProxy } from 'wrangler';
import app from './worker';

const migrations = import.meta.glob<string>('../../migrations/*.sql', { query: '?raw', import: 'default', eager: true });

// An in-memory local D1 with every migration applied, and a client that calls the app in-process.
export async function testApp() {
  const proxy = await getPlatformProxy<Env>({ persist: false, remoteBindings: false });
  const env = proxy.env;
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
    dispose: () => proxy.dispose(),
    reset: () => env.DB.batch(['objects', 'vaults', 'sessions', 'accounts'].map((table) => env.DB.prepare(`DELETE FROM ${table}`))),
    get: (path: string, cookie?: string) => send('GET', path, undefined, cookie),
    post: (path: string, body?: unknown, cookie?: string) => send('POST', path, body, cookie),
    put: (path: string, body?: unknown, cookie?: string) => send('PUT', path, body, cookie),
    delete: (path: string, body?: unknown, cookie?: string) => send('DELETE', path, body, cookie),
    raw: (path: string, init: RequestInit) => app.request(`/api/${path}`, init, env),
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
