import { afterAll, afterEach, beforeAll, beforeEach, vi } from 'vitest';
import type { HttpRequest } from '../connectors/types';
import { sessionCookie, signupBody, testApp } from '../server/testing';
import { randomBytes } from '../vault/aead';
import type { VaultKey } from '../vault/keys';
import { api } from './api';
import type { OpenVault } from './blobs';
import { ObjectStore } from './store';

type App = Awaited<ReturnType<typeof testApp>>;
// The relay's answer to the upstream request it carries. null is a connection that dropped.
type Relay = (sent: HttpRequest) => Response | null;

let server: { app: App; cookie: string | null } | null = null;
let relay: Relay | null = null;

// The browser's fetch in runtime tests: /api/relay answers as the test says, and every other API route
// is the real server, in process, over an in-memory D1 and R2 (server/testing).
function stubFetch() {
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    if (url === '/api/relay') {
      if (!relay) throw new Error('This test gave the relay no answers.');
      const answer = relay(JSON.parse(init.body as string) as HttpRequest);
      if (!answer) throw new TypeError('Failed to fetch');
      return answer;
    }
    if (!server) throw new Error(`This test has no server for ${url}.`);
    const headers = { ...(init.headers as Record<string, string>), ...(server.cookie ? { cookie: server.cookie } : {}) };
    return server.app.raw(url.slice('/api/'.length), { ...init, headers });
  });
}

// Every relay call gets answer's reply. The log holds what each call sent upstream, and when, in
// seconds after the stub was set.
export function stubRelay(answer: Relay): { at: number; sent: HttpRequest }[] {
  const log: { at: number; sent: HttpRequest }[] = [];
  const start = Date.now();
  relay = (sent) => {
    log.push({ at: (Date.now() - start) / 1000, sent });
    return answer(sent);
  };
  stubFetch();
  return log;
}

// A provider's answer as the relay passes it on.
export const upstream = (status: number, body: unknown) => Response.json(body, { status, headers: { 'x-relay': 'upstream' } });

export const inTurn = (answers: (Response | null)[]): Relay => () => answers.shift() ?? null;

// Gives each test in the file a server with no accounts. account() signs one up; each open() is one
// more device of it, and another vault key stands for a device that cannot read what it wrote.
export function testServer() {
  let app: App;
  beforeAll(async () => {
    app = await testApp();
  });
  afterAll(() => app.dispose());
  beforeEach(async () => {
    await app.reset();
    server = { app, cookie: null };
    relay = null;
    stubFetch();
  });
  afterEach(() => vi.unstubAllGlobals());

  return {
    async account() {
      const body = signupBody();
      server!.cookie = sessionCookie(await app.post('signup', body));
      const vault: OpenVault = { accountId: body.accountId, vaultKey: randomBytes(32), request: api };
      const open = (vaultKey: VaultKey = vault.vaultKey) => ObjectStore.open(vault.accountId, vaultKey, api);
      // The sealed bytes R2 holds under an id.
      const blobs = {
        get: async (id: string) => {
          const object = await app.env.BLOBS.get(`${vault.accountId}/${id}`);
          return object && new Uint8Array(await object.arrayBuffer());
        },
        put: (id: string, bytes: Uint8Array<ArrayBuffer>) => app.env.BLOBS.put(`${vault.accountId}/${id}`, bytes),
      };
      return { vault, store: await open(), open, blobs };
    },
  };
}
