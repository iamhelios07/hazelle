import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { proof, sessionCookie, signupBody, testApp } from './testing';

let t: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => {
  t = await testApp();
});
afterAll(() => t.dispose());
beforeEach(() => t.reset());

const get = (path: string, cookie?: string) => t.get(path, cookie);
const post = (path: string, body?: unknown, cookie?: string) => t.post(path, body, cookie);

describe('accounts', () => {
  it('signs up the first account with its vault in one request, then closes signup', async () => {
    expect(await (await get('session')).json()).toEqual({ session: null, signupOpen: true });
    const body = signupBody();
    const signup = await post('signup', body);
    expect(signup.status).toBe(201);
    expect(await signup.json()).toEqual({ accountId: body.accountId, username: 'jin' });
    const cookie = signup.headers.get('set-cookie')!;
    expect(cookie).toMatch(/^__Host-session=[0-9a-f]{64};/);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Strict');

    const session = await get('session', sessionCookie(signup));
    expect(await session.json()).toEqual({
      session: { accountId: body.accountId, username: 'jin' },
      vault: { passwordWrap: body.passwordWrap, recoveryWrap: body.recoveryWrap },
    });

    expect(await (await get('session')).json()).toEqual({ session: null, signupOpen: false });
    const second = await post('signup', signupBody('other'));
    expect(second.status).toBe(403);
    expect(await second.json()).toEqual({ error: 'signup-closed' });
  });

  it('refuses a username the client did not put in canonical form, and a malformed proof', async () => {
    for (const username of ['a b', 'Jin', '진이'.normalize('NFD')]) {
      expect(await (await post('signup', signupBody(username))).json()).toEqual({ error: 'bad-username' });
    }
    expect((await post('signup', { ...signupBody(), passwordProof: 'short' })).status).toBe(400);
    expect(await (await get('session')).json()).toEqual({ session: null, signupOpen: true });
  });

  it('logs in with the password proof or the recovery proof and answers with the vault', async () => {
    const body = signupBody();
    await post('signup', body);
    for (const [method, value] of [['password', body.passwordProof], ['recovery', body.recoveryProof]]) {
      const login = await post('login', { username: 'jin', method, proof: value });
      expect(login.status).toBe(200);
      expect(await login.json()).toEqual({
        session: { accountId: body.accountId, username: 'jin' },
        vault: { passwordWrap: body.passwordWrap, recoveryWrap: body.recoveryWrap },
      });
    }
    expect((await post('login', { username: 'jin', method: 'password', proof: body.recoveryProof })).status).toBe(401);
    expect((await post('login', { username: 'nobody', method: 'password', proof: body.passwordProof })).status).toBe(401);
  });

  it('locks the account after five wrong proofs, even against the right one', async () => {
    const body = signupBody();
    await post('signup', body);
    for (let i = 0; i < 5; i++) {
      expect((await post('login', { username: 'jin', method: 'password', proof: proof('wrong') })).status).toBe(401);
    }
    const locked = await post('login', { username: 'jin', method: 'password', proof: body.passwordProof });
    expect(locked.status).toBe(429);
    const answer = (await locked.json()) as { error: string; retryAfter: number };
    expect(answer.error).toBe('too-many-attempts');
    expect(answer.retryAfter).toBeGreaterThan(0);
    expect(answer.retryAfter).toBeLessThanOrEqual(60);
  });

  it('logs out by deleting the session', async () => {
    const cookie = sessionCookie(await post('signup', signupBody()));
    const logout = await post('logout', undefined, cookie);
    expect(logout.status).toBe(204);
    expect(logout.headers.get('set-cookie')).toMatch(/^__Host-session=;.*Max-Age=0/);
    expect(await (await get('session', cookie)).json()).toEqual({ session: null, signupOpen: false });
  });

  it('ends a session once its expiry passes', async () => {
    const cookie = sessionCookie(await post('signup', signupBody()));
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
