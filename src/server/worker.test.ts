import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Upstream } from './relay';
import { proof, sessionCookie, signupBody, testApp } from './testing';

let t: Awaited<ReturnType<typeof testApp>>;
const answer: Upstream = async () => Response.json({ data: [] });
let upstream = answer;
beforeAll(async () => {
  t = await testApp((url, init) => upstream(url, init));
});
afterAll(() => t.dispose());
beforeEach(() => {
  upstream = answer;
  return t.reset();
});

const get = (path: string, cookie?: string) => t.get(path, cookie);
const post = (path: string, body?: unknown, cookie?: string) => t.post(path, body, cookie);
// The first signup of an installation is its operator, and a second signup needs a second place under the cap.
const operator = async () => {
  await t.env.db.prepare('UPDATE service SET signup_cap = 2').run();
  return sessionCookie(await post('signup', signupBody('operator')));
};

describe('accounts', () => {
  it('signs up the first account as the operator with its vault in one request, then closes signup', async () => {
    expect(await (await get('session')).json()).toEqual({ session: null, signupOpen: true });
    const body = signupBody();
    const signup = await post('signup', body);
    expect(signup.status).toBe(201);
    const described = { accountId: body.accountId, username: 'jin', admin: true, suspended: false, state: 'active', incarnation: expect.stringMatching(/^[0-9a-f]{32}$/), storage: { bytes: 0, bytesCap: null, fileBytes: 0, fileBytesCap: null }, unreadNotices: 0 };
    expect(await signup.json()).toEqual(described);
    const cookie = signup.headers.get('set-cookie')!;
    expect(cookie).toMatch(/^__Host-session=[0-9a-f]{64};/);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Strict');

    const session = await get('session', sessionCookie(signup));
    expect(await session.json()).toEqual({
      session: described,
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
    const rows = (table: string) => t.env.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first('n');
    expect([await rows('accounts'), await rows('vaults'), await rows('sessions')]).toEqual([1, 1, 1]);
  });

  it('admits accounts up to the cap the operator stored, and tells a taken username from a closed signup', async () => {
    await t.env.db.prepare('UPDATE service SET signup_cap = 2').run();
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
        session: { accountId: body.accountId, username: 'jin', admin: true, suspended: false, state: 'active', incarnation: expect.any(String), storage: { bytes: 0, bytesCap: null, fileBytes: 0, fileBytesCap: null }, unreadNotices: 0 },
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

  it('deletes an account for its own proof: its rows, sessions, vault and store go', async () => {
    await operator();
    const body = signupBody('other');
    const cookie = sessionCookie(await post('signup', body));
    await t.batch([{ id: crypto.randomUUID(), kind: 'chat', parent: null, body: 'sealed', baseRev: null }], cookie);
    const incarnation = (await t.env.db.prepare('SELECT incarnation FROM accounts WHERE id = ?').bind(body.accountId).first<string>('incarnation'))!;

    expect((await t.delete('account', { method: 'password', proof: proof('wrong') }, cookie)).status).toBe(401);
    expect((await get('objects?since=0', cookie)).status).toBe(200);

    const gone = await t.delete('account', { method: 'password', proof: body.passwordProof }, cookie);
    expect(gone.status).toBe(204);
    expect(gone.headers.get('set-cookie')).toMatch(/^__Host-session=;.*Max-Age=0/);
    expect((await post('login', { username: 'other', method: 'password', proof: body.passwordProof })).status).toBe(401);
    const rows = (table: string) => t.env.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first('n');
    expect([await rows('accounts'), await rows('sessions'), await rows('vaults')]).toEqual([1, 1, 1]);
    expect(t.stores.inspect(incarnation).tables()).toEqual([]);
  });

  it('refuses a leaving account every route and its login, and admits its own 탈퇴, which finishes the deletion', async () => {
    await operator();
    const body = signupBody('other');
    const cookie = sessionCookie(await post('signup', body));
    // A deletion cut off after its intent.
    await t.env.db.prepare("UPDATE accounts SET state = 'leaving' WHERE id = ?").bind(body.accountId).run();

    expect(await (await get('session', cookie)).json()).toEqual({ session: null, signupOpen: false });
    for (const response of [await get('objects?since=0', cookie), await get('vault', cookie), await t.batch([], cookie)]) {
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: 'no-session' });
    }
    const login = await post('login', { username: 'other', method: 'password', proof: body.passwordProof });
    expect(login.status).toBe(403);
    expect(await login.json()).toEqual({ error: 'account-leaving' });

    expect((await t.delete('account', { method: 'password', proof: body.passwordProof }, cookie)).status).toBe(204);
    expect(await t.env.db.prepare('SELECT COUNT(*) AS n FROM accounts').first('n')).toBe(1);
  });

  it('refuses to delete the only operator, by its own 탈퇴 and by its own operator tools', async () => {
    const body = signupBody();
    const cookie = sessionCookie(await post('signup', body));
    for (const refused of [await t.delete('account', { method: 'password', proof: body.passwordProof }, cookie), await t.delete(`admin/accounts/${body.accountId}`, undefined, cookie)]) {
      expect(refused.status).toBe(403);
      expect(await refused.json()).toEqual({ error: 'sole-operator' });
    }
    expect(await (await get('session', cookie)).json()).toMatchObject({ session: { admin: true, state: 'active' } });
  });

  it('refuses 탈퇴 while the operator restores the account', async () => {
    await operator();
    const body = signupBody('other');
    const cookie = sessionCookie(await post('signup', body));
    await t.lifecycle(body.accountId, "state = 'restoring'");
    const refused = await t.delete('account', { method: 'password', proof: body.passwordProof }, cookie);
    expect(refused.status).toBe(409);
    expect(await refused.json()).toEqual({ error: 'account-busy' });
    expect(await (await get('session', cookie)).json()).toMatchObject({ session: { state: 'restoring', storage: { bytes: null } } });
  });

  it('ends a session once its expiry passes', async () => {
    const cookie = sessionCookie(await post('signup', signupBody()));
    await t.env.db.prepare('UPDATE sessions SET expires_at = ?').bind(Date.now() - 1).run();
    expect(await (await get('session', cookie)).json()).toEqual({ session: null, signupOpen: false });
  });
});

describe('provider calls', () => {
  it('relay a call to the upstream and answer with its reply', async () => {
    const cookie = sessionCookie(await post('signup', signupBody()));
    const relayed = await post('relay', { url: 'https://api.example.com/models', method: 'GET', headers: {}, body: null }, cookie);
    expect(relayed.headers.get('x-relay')).toBe('upstream');
    expect(await relayed.json()).toEqual({ data: [] });
  });

  it('keep a detached call running when its reader goes, give its frames to another reader, and end it on stop', async () => {
    const seen = { aborted: false };
    upstream = async (_url, { signal }) => {
      signal.addEventListener('abort', () => (seen.aborted = true));
      return new Response(
        new ReadableStream({
          start: (body) => {
            body.enqueue(new TextEncoder().encode('data: one\n\n'));
            signal.addEventListener('abort', () => body.error(signal.reason));
          },
        }),
      );
    };
    const cookie = sessionCookie(await post('signup', signupBody()));
    const pair = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
    const key = btoa(String.fromCharCode(...new Uint8Array((await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer)));
    const live = () => t.env.streams.live();
    const id = crypto.randomUUID();
    const started = await post(`streams/${id}`, { key, request: { url: 'https://api.example.com/v1/chat', method: 'POST', headers: {}, body: '{}' } }, cookie);
    expect(started.status).toBe(200);
    await started.body?.cancel();
    expect(live()).toBe(1);
    // Another tab resumes: hello, then the head and the data the call went on to write without a reader.
    const resumed = (await get(`streams/${id}?from=1`, cookie)).body!.getReader();
    const types: number[] = [];
    while (types.length < 3) {
      const { value } = await resumed.read();
      for (let at = 0; at < value!.byteLength; at += 4 + new DataView(value!.buffer, value!.byteOffset + at).getUint32(0)) types.push(value![at + 4]!);
    }
    expect(types).toEqual([0, 1, 2]);
    expect(seen.aborted).toBe(false);
    await post(`streams/${id}/stop`, undefined, cookie);
    expect(seen.aborted).toBe(true);
    await vi.waitFor(() => expect(live()).toBe(0));
    await resumed.cancel();
  });
});

describe('a suspended account', () => {
  it('reads, and is refused every write, upload and provider call', async () => {
    const cookie = sessionCookie(await post('signup', signupBody()));
    await t.env.db.prepare('UPDATE accounts SET suspended_at = 1').run();
    expect(await (await get('session', cookie)).json()).toMatchObject({ session: { suspended: true } });
    expect((await get('objects?since=0', cookie)).status).toBe(200);

    const refused = [
      await t.batch([{ id: crypto.randomUUID(), kind: 'chat', parent: null, body: 'sealed', baseRev: null }], cookie),
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
    const timeline = await t.timeline(cookie);
    const send = (account: string) =>
      t.raw('objects/batch', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie, 'x-account': account },
        body: JSON.stringify({ timeline, writes: [{ id: crypto.randomUUID(), kind: 'chat', parent: null, body: 'sealed', baseRev: null }] }),
      });
    const other = await send(crypto.randomUUID());
    expect(other.status).toBe(409);
    expect(await other.json()).toEqual({ error: 'account-mismatch' });
    expect(await (await get('objects?since=0', cookie)).json()).toMatchObject({ changes: [] });
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
    const large = await t.batch([{ id: crypto.randomUUID(), kind: 'chat', parent: null, body: 'x'.repeat(200_000), baseRev: null }], cookie);
    expect(large.status).toBe(200);
  });

  it('refuses a chunked body before reading it, however the header is spelled, since the bound trusts Content-Length', async () => {
    for (const spelling of ['chunked', 'Chunked', 'gzip, Chunked']) {
      const response = await t.raw('login', { method: 'POST', headers: { 'content-type': 'application/json', 'transfer-encoding': spelling }, body: '{}' });
      expect(response.status).toBe(411);
      expect(await response.json()).toEqual({ error: 'length-required' });
    }
  });

  it('throttles an account that has spent its provider calls, on the relay and on a new stream', async () => {
    const body = signupBody();
    const cookie = sessionCookie(await post('signup', body));
    const call = () => post('relay', { url: 'https://api.example.com/models', method: 'GET', headers: {}, body: null }, cookie);
    expect((await call()).status).toBe(200);
    // The rest of the minute's calls, spent on the bucket itself: 240 requests would take seconds.
    for (let i = 0; i < 239; i++) t.env.limits.calls.limit(body.accountId);
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
    for (let i = 0; i < 20; i++) t.env.limits.botCalls.limit(`${body.accountId}:${chat}`);
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
