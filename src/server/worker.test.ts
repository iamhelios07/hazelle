import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getPlatformProxy } from 'wrangler';
import app from './worker';

const migrations = import.meta.glob<string>('../../migrations/*.sql', { query: '?raw', import: 'default', eager: true });

let proxy: Awaited<ReturnType<typeof getPlatformProxy<Env>>>;
let env: Env;

beforeAll(async () => {
  proxy = await getPlatformProxy<Env>({ persist: false, remoteBindings: false });
  env = proxy.env;
  for (const name of Object.keys(migrations).sort()) {
    const statements = migrations[name]!.split(';').filter((s) => s.trim());
    await env.DB.batch(statements.map((s) => env.DB.prepare(s)));
  }
});

afterAll(() => proxy.dispose());

beforeEach(async () => {
  await env.DB.batch([env.DB.prepare('DELETE FROM sessions'), env.DB.prepare('DELETE FROM accounts')]);
});

const post = (path: string, body?: unknown, cookie?: string) =>
  app.request(
    `/api/${path}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    env,
  );

const get = (path: string, cookie?: string) => app.request(`/api/${path}`, { headers: cookie ? { cookie } : {} }, env);

const sessionCookie = (response: Response) => response.headers.get('set-cookie')!.split(';')[0]!;

describe('accounts', () => {
  it('signs up the first account, keeps its session, then closes signup', async () => {
    expect(await (await get('signup')).json()).toEqual({ open: true });
    const signup = await post('signup', { username: 'Jin', password: 'correct horse' });
    expect(signup.status).toBe(201);
    expect(await signup.json()).toEqual({ username: 'jin' });
    const cookie = signup.headers.get('set-cookie')!;
    expect(cookie).toMatch(/^__Host-session=[0-9a-f]{64};/);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Strict');

    const session = await get('session', sessionCookie(signup));
    expect(await session.json()).toEqual({ username: 'jin' });

    expect(await (await get('signup')).json()).toEqual({ open: false });
    const second = await post('signup', { username: 'other', password: 'correct horse' });
    expect(second.status).toBe(403);
    expect(await second.json()).toEqual({ error: 'signup-closed' });
  });

  it('refuses a malformed username or a short password', async () => {
    expect(await (await post('signup', { username: 'a b', password: 'correct horse' })).json()).toEqual({ error: 'bad-username' });
    expect(await (await post('signup', { username: 'jin', password: 'short' })).json()).toEqual({ error: 'short-password' });
  });

  it('accepts a Korean password typed in either Unicode form', async () => {
    await post('signup', { username: 'jin', password: '한글비밀번호입니다'.normalize('NFD') });
    const login = await post('login', { username: 'jin', password: '한글비밀번호입니다'.normalize('NFC') });
    expect(login.status).toBe(200);
  });

  it('locks the account after five wrong passwords, even against the right one', async () => {
    await post('signup', { username: 'jin', password: 'correct horse' });
    for (let i = 0; i < 5; i++) {
      expect((await post('login', { username: 'jin', password: 'wrong horse' })).status).toBe(401);
    }
    const locked = await post('login', { username: 'jin', password: 'correct horse' });
    expect(locked.status).toBe(429);
    const body = (await locked.json()) as { error: string; retryAfter: number };
    expect(body.error).toBe('too-many-attempts');
    expect(body.retryAfter).toBeGreaterThan(0);
    expect(body.retryAfter).toBeLessThanOrEqual(60);
  });

  it('logs out by deleting the session', async () => {
    const cookie = sessionCookie(await post('signup', { username: 'jin', password: 'correct horse' }));
    const logout = await post('logout', undefined, cookie);
    expect(logout.status).toBe(204);
    expect(logout.headers.get('set-cookie')).toMatch(/^__Host-session=;.*Max-Age=0/);
    expect((await get('session', cookie)).status).toBe(401);
  });

  it('ends a session once its expiry passes', async () => {
    const cookie = sessionCookie(await post('signup', { username: 'jin', password: 'correct horse' }));
    await env.DB.prepare('UPDATE sessions SET expires_at = ?').bind(Date.now() - 1).run();
    expect((await get('session', cookie)).status).toBe(401);
  });
});

describe('guards', () => {
  it('answers the relay without a session with a 401 that carries no x-relay header', async () => {
    const response = await post('relay', { url: 'https://api.example.com/', method: 'GET', headers: {}, body: null });
    expect(response.status).toBe(401);
    expect(response.headers.get('x-relay')).toBeNull();
    expect(await response.json()).toEqual({ error: 'no-session' });
  });

  it('refuses a state-changing request without a JSON content type', async () => {
    const response = await app.request('/api/login', { method: 'POST', body: 'username=jin' }, env);
    expect(response.status).toBe(415);
  });
});
