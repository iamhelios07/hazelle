import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { EXIT } from './relay';
import { proof, sessionCookie, signupBody, testApp } from './testing';

let t: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => {
  t = await testApp(async () => Response.json({ data: [] }));
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
    expect(await signup.json()).toEqual({ accountId: body.accountId, username: 'jin', admin: false, suspended: false, storage: { bytes: 0, bytesCap: null, fileBytes: 0, fileBytesCap: null } });
    const cookie = signup.headers.get('set-cookie')!;
    expect(cookie).toMatch(/^__Host-session=[0-9a-f]{64};/);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Strict');

    const session = await get('session', sessionCookie(signup));
    expect(await session.json()).toEqual({
      session: { accountId: body.accountId, username: 'jin', admin: false, suspended: false, storage: { bytes: 0, bytesCap: null, fileBytes: 0, fileBytesCap: null } },
      vault: { passwordWrap: body.passwordWrap, recoveryWrap: body.recoveryWrap },
    });

    expect(await (await get('session')).json()).toEqual({ session: null, signupOpen: false });
    const second = await post('signup', signupBody('other'));
    expect(second.status).toBe(403);
    expect(await second.json()).toEqual({ error: 'signup-closed' });
  });

  it('gives the last place under the cap to one of two signups sent at once, with no vault or session for the other', async () => {
    const answers = await Promise.all([post('signup', signupBody('one')), post('signup', signupBody('two'))]);
    expect(answers.map(({ status }) => status).sort()).toEqual([201, 403]);
    const rows = (table: string) => t.env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first('n');
    expect([await rows('accounts'), await rows('vaults'), await rows('sessions')]).toEqual([1, 1, 1]);
  });

  it('admits accounts up to the cap the operator stored, and tells a taken username from a closed signup', async () => {
    await t.env.DB.prepare('UPDATE service SET signup_cap = 2').run();
    await post('signup', signupBody());
    expect(await (await get('session')).json()).toEqual({ session: null, signupOpen: true });
    const taken = await post('signup', signupBody());
    expect(taken.status).toBe(409);
    expect(await taken.json()).toEqual({ error: 'username-taken' });
    expect((await post('signup', signupBody('other'))).status).toBe(201);
    expect(await (await post('signup', signupBody('third'))).json()).toEqual({ error: 'signup-closed' });
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
        session: { accountId: body.accountId, username: 'jin', admin: false, suspended: false, storage: { bytes: 0, bytesCap: null, fileBytes: 0, fileBytesCap: null } },
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

  it('deletes an account for its own proof, with its sessions, vault and objects, and leaves its stored files', async () => {
    const body = signupBody();
    const cookie = sessionCookie(await post('signup', body));
    const file = 'a'.repeat(64);
    await t.env.DB.prepare('INSERT INTO files (id, size, created_at) VALUES (?, 1, 0)').bind(file).run();
    await post('objects/batch', { writes: [{ id: crypto.randomUUID(), kind: 'asset', parent: null, body: 'sealed', baseRev: null, file }] }, cookie);

    expect((await t.delete('account', { method: 'password', proof: proof('wrong') }, cookie)).status).toBe(401);
    expect((await get('objects?since=0', cookie)).status).toBe(200);

    const gone = await t.delete('account', { method: 'password', proof: body.passwordProof }, cookie);
    expect(gone.status).toBe(204);
    expect(gone.headers.get('set-cookie')).toMatch(/^__Host-session=;.*Max-Age=0/);
    expect((await post('login', { username: 'jin', method: 'password', proof: body.passwordProof })).status).toBe(401);
    const rows = (table: string) => t.env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first('n');
    expect([await rows('accounts'), await rows('sessions'), await rows('vaults'), await rows('objects'), await rows('files')]).toEqual([0, 0, 0, 0, 1]);
  });

  it('ends a session once its expiry passes', async () => {
    const cookie = sessionCookie(await post('signup', signupBody()));
    await t.env.DB.prepare('UPDATE sessions SET expires_at = ?').bind(Date.now() - 1).run();
    expect(await (await get('session', cookie)).json()).toEqual({ session: null, signupOpen: false });
  });
});

describe('provider calls', () => {
  it('leave from a Durable Object placed at EXIT, for the relay and for a reply alike', async () => {
    const cookie = sessionCookie(await post('signup', signupBody()));
    t.placed.length = 0;
    const relayed = await post('relay', { url: 'https://api.example.com/models', method: 'GET', headers: {}, body: null }, cookie);
    expect(relayed.headers.get('x-relay')).toBe('upstream');
    expect(await relayed.json()).toEqual({ data: [] });
    await post(`streams/${crypto.randomUUID()}`, { key: 'k', request: null }, cookie);
    expect(t.placed).toEqual([EXIT, EXIT]);
  });
});

describe('a suspended account', () => {
  it('reads, and is refused every write, upload and provider call', async () => {
    const cookie = sessionCookie(await post('signup', signupBody()));
    await t.env.DB.prepare('UPDATE accounts SET suspended_at = 1').run();
    expect(await (await get('session', cookie)).json()).toMatchObject({ session: { suspended: true } });
    expect((await get('objects?since=0', cookie)).status).toBe(200);

    const refused = [
      await post('objects/batch', { writes: [{ id: crypto.randomUUID(), kind: 'chat', parent: null, body: 'sealed', baseRev: null }] }, cookie),
      await t.put(`files/${'a'.repeat(64)}`, new Uint8Array([1]), cookie),
      await post('relay', { url: 'https://api.example.com/models', method: 'GET', headers: {}, body: null }, cookie),
      await post(`streams/${crypto.randomUUID()}`, { key: 'k', request: null }, cookie),
    ];
    for (const response of refused) {
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: 'suspended' });
    }
  });
});

describe('guards', () => {
  it('refuses a request that states another account than the one its session names, and writes nothing', async () => {
    const body = signupBody();
    const cookie = sessionCookie(await post('signup', body));
    const send = (account: string) =>
      t.raw('objects/batch', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie, 'x-account': account },
        body: JSON.stringify({ writes: [{ id: crypto.randomUUID(), kind: 'chat', parent: null, body: 'sealed', baseRev: null }] }),
      });
    const other = await send(crypto.randomUUID());
    expect(other.status).toBe(409);
    expect(await other.json()).toEqual({ error: 'account-mismatch' });
    expect(await t.env.DB.prepare('SELECT rev FROM accounts').first('rev')).toBe(0);
    expect((await send(body.accountId)).status).toBe(200);
  });

  it('refuses a signed-in request that states no account', async () => {
    const cookie = sessionCookie(await post('signup', signupBody()));
    const response = await t.raw('objects?since=0', { headers: { cookie } });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'bad-input' });
  });

  it('refuses a body over the bound, signed in or not, and takes more only on the routes listed for it', async () => {
    const response = await post('signup', { ...signupBody(), passwordWrap: 'x'.repeat(100_000) });
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: 'too-large' });

    const cookie = sessionCookie(await post('signup', signupBody()));
    const large = await post('objects/batch', { writes: [{ id: crypto.randomUUID(), kind: 'chat', parent: null, body: 'x'.repeat(200_000), baseRev: null }] }, cookie);
    expect(large.status).toBe(200);
  });

  it('throttles an account that has spent its provider calls, on the relay and on a new stream', async () => {
    const body = signupBody();
    const cookie = sessionCookie(await post('signup', body));
    const call = () => post('relay', { url: 'https://api.example.com/models', method: 'GET', headers: {}, body: null }, cookie);
    expect((await call()).status).toBe(200);
    // The rest of the minute's calls, spent on the local binding itself: 240 requests would take seconds.
    await Promise.all(Array.from({ length: 239 }, () => t.env.CALLS.limit({ key: body.accountId })));
    const throttled = await call();
    expect(throttled.status).toBe(429);
    expect(throttled.headers.get('x-relay')).toBeNull();
    expect(await throttled.json()).toEqual({ error: 'too-many-calls' });
    expect((await post(`streams/${crypto.randomUUID()}`, { key: 'k', request: null }, cookie)).status).toBe(429);
  });

  it('limits a bot’s own calls per chat, and leaves other chats and the user’s calls alone', async () => {
    const body = signupBody();
    const cookie = sessionCookie(await post('signup', body));
    const chat = crypto.randomUUID();
    await Promise.all(Array.from({ length: 20 }, () => t.env.BOT_CALLS.limit({ key: `${body.accountId}:${chat}` })));
    const start = (bot?: string) => post(`streams/${crypto.randomUUID()}`, { key: 'k', request: null, ...(bot && { bot }) }, cookie);
    const refused = await start(chat);
    expect(refused.status).toBe(429);
    expect(await refused.json()).toEqual({ error: 'too-many-bot-calls' });
    expect((await start(crypto.randomUUID())).status).toBe(400);
    expect((await start()).status).toBe(400);
  });

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
