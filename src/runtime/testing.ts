import { afterAll, afterEach, beforeAll, beforeEach, vi } from 'vitest';
import type { HttpRequest } from '../connectors/types';
export { BATCH_LIMITS } from '../server/objects';
import { sessionCookie, signupBody, testApp } from '../server/testing';
import { randomBytes } from '../vault/aead';
import type { VaultKey } from '../vault/keys';
import { api } from './api';
import { setDefaultModel } from './assignment';
import { Files } from './files';
import { openSession, type Session } from './session';
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
    if (init.signal?.aborted) throw new DOMException('The operation was aborted.', 'AbortError');
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

// A chat-completions stream that says text and ends.
export const saying = (text: string) =>
  new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: text }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`, { headers: { 'x-relay': 'upstream' } });

// An OpenRouter connection whose one starred model is 기본값's 대화 모델, so chats can be answered.
export async function answerable(session: Session): Promise<void> {
  const model = { id: 'm', name: 'M', input: null, output: null, contextLength: null, maxOutput: null, reasoning: null, tools: null, protocol: null };
  const connection = await session.store.create('connection', { type: 'openrouter', label: 'OpenRouter', baseUrl: null, protocol: null, secret: 'sk-or-x', starred: [model] });
  if (!connection.ok) throw new Error(connection.error);
  await setDefaultModel(session.store, 'main', { connection: connection.data.id, model: model.id });
}

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

  const harness = {
    async account() {
      const body = signupBody();
      server!.cookie = sessionCookie(await app.post('signup', body));
      const { accountId } = body;
      const vaultKey = randomBytes(32);
      const open = (key: VaultKey = vaultKey) => ObjectStore.open(accountId, key, api);
      // The sealed bytes R2 holds under an id.
      const blobs = {
        get: async (id: string) => {
          const object = await app.env.BLOBS.get(`${accountId}/${id}`);
          return object && new Uint8Array(await object.arrayBuffer());
        },
        put: (id: string, bytes: Uint8Array<ArrayBuffer>) => app.env.BLOBS.put(`${accountId}/${id}`, bytes),
      };
      return { accountId, vaultKey, store: await open(), files: await Files.open(accountId, vaultKey, api), open, blobs };
    },
    // The operator deletes the account on the server, which opens signup again (server/accounts): how a user
    // who lost both the password and the recovery key starts over.
    wipe: () => app.reset(),
    // A session on an account of its own, closed when test ends. keepSynced listens on the window and
    // pulls only while the tab is visible, so a hidden one never pulls on its own.
    async withSession(test: (session: Session) => Promise<void>) {
      vi.stubGlobal('window', new EventTarget());
      vi.stubGlobal('document', { visibilityState: 'hidden' });
      const { accountId, vaultKey } = await harness.account();
      const opened = await openSession(accountId, vaultKey, 'jin', new AbortController().signal);
      if (!opened.ok) throw new Error(opened.error);
      try {
        await test(opened.data);
      } finally {
        opened.data.close();
      }
    },
  };
  return harness;
}
