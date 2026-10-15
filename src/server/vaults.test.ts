import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ACCOUNT_HEADER, VISITOR_HEADER } from '../contracts/http';
import { proof, sessionCookie, signupBody, testApp } from './testing';

let t: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => {
  t = await testApp();
});
afterAll(() => t.dispose());
beforeEach(() => t.reset());

const login = (method: string, value: string) => t.post('login', { username: 'jin', method, proof: value });

describe('password change', () => {
  it('replaces the login proof and the password wrap together, and keeps the recovery key working', async () => {
    const body = signupBody();
    const cookie = sessionCookie(await t.post('signup', body));
    const change = { method: 'recovery', proof: body.recoveryProof, passwordProof: proof('new password'), passwordWrap: 'bmV3IHdyYXA=' };

    expect((await t.put('vault/password', change, cookie)).status).toBe(204);
    expect((await login('password', body.passwordProof)).status).toBe(401);
    const loggedIn = await login('password', change.passwordProof);
    expect(((await loggedIn.json()) as { vault: unknown }).vault).toEqual({ passwordWrap: 'bmV3IHdyYXA=', recoveryWrap: body.recoveryWrap });
    expect((await login('recovery', body.recoveryProof)).status).toBe(200);
  });

  it('keys authenticated proof failures by visitor and account, sharing backoff with login but not another address', async () => {
    const body = signupBody();
    const cookie = sessionCookie(await t.post('signup', body));
    const change = (visitor: string, value: string) => t.raw('vault/password', {
      method: 'PUT', headers: { 'content-type': 'application/json', cookie, [ACCOUNT_HEADER]: body.accountId, [VISITOR_HEADER]: visitor },
      body: JSON.stringify({ method: 'recovery', proof: value, passwordProof: proof('new password'), passwordWrap: 'bmV3IHdyYXA=' }),
    });
    for (let i = 0; i < 5; i++) expect((await change('203.0.113.30', proof('wrong'))).status).toBe(401);
    expect((await change('203.0.113.30', body.recoveryProof)).status).toBe(429);
    const login = await t.raw('login', {
      method: 'POST', headers: { 'content-type': 'application/json', [VISITOR_HEADER]: '203.0.113.30' },
      body: JSON.stringify({ username: body.username, method: 'password', proof: body.passwordProof }),
    });
    expect(login.status).toBe(429);
    expect(await login.json()).toEqual({ error: 'too-many-attempts', retryAfter: 60 });
    expect((await change('203.0.113.31', body.recoveryProof)).status).toBe(204);
  });

  it('needs the current password or recovery key, not only a session', async () => {
    const body = signupBody();
    const cookie = sessionCookie(await t.post('signup', body));
    const change = { method: 'password', proof: proof('guess'), passwordProof: proof('new password'), passwordWrap: 'bmV3IHdyYXA=' };

    expect((await t.put('vault/password', change, cookie)).status).toBe(401);
    expect((await t.put('vault/password', { ...change, proof: body.passwordProof })).status).toBe(401);
    expect((await t.put('vault/password', { ...change, passwordWrap: 42 }, cookie)).status).toBe(400);
    expect((await login('password', body.passwordProof)).status).toBe(200);
  });
});
