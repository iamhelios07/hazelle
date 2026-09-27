import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sessionCookie, testApp } from './testing';

let t: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => {
  t = await testApp();
});
afterAll(() => t.dispose());
beforeEach(() => t.reset());

const get = (path: string, cookie?: string) => t.get(path, cookie);
const post = (path: string, body?: unknown, cookie?: string) => t.post(path, body, cookie);

describe('accounts', () => {
  it('signs up the first account, keeps its session, then closes signup', async () => {
    expect(await (await get('session')).json()).toEqual({ session: null, signupOpen: true });
    const signup = await post('signup', { username: 'Jin', password: 'correct horse' });
    expect(signup.status).toBe(201);
    expect(await signup.json()).toEqual({ accountId: expect.any(String), username: 'jin' });
    const cookie = signup.headers.get('set-cookie')!;
    expect(cookie).toMatch(/^__Host-session=[0-9a-f]{64};/);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Strict');

    const session = await get('session', sessionCookie(signup));
    expect(await session.json()).toEqual({ session: { accountId: expect.any(String), username: 'jin' }, vault: null });

    expect(await (await get('session')).json()).toEqual({ session: null, signupOpen: false });
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
    expect(await (await get('session', cookie)).json()).toEqual({ session: null, signupOpen: false });
  });

  it('ends a session once its expiry passes', async () => {
    const cookie = sessionCookie(await post('signup', { username: 'jin', password: 'correct horse' }));
    await t.env.DB.prepare('UPDATE sessions SET expires_at = ?').bind(Date.now() - 1).run();
    expect(await (await get('session', cookie)).json()).toEqual({ session: null, signupOpen: false });
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
    const response = await t.raw('login', { method: 'POST', body: 'username=jin' });
    expect(response.status).toBe(415);
  });
});
