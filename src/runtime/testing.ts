import { afterAll, afterEach, beforeAll, beforeEach, vi } from 'vitest';
import type { Card } from '../engine/import/types';
import type { HttpRequest } from '../connectors/types';
import { Lua } from '../engine/lua/run';
export { BATCH_LIMITS } from '../server/objects';
import type { Upstream } from '../server/relay';
import { sessionCookie, signupBody, testApp } from '../server/testing';
import { randomBytes } from '../vault/aead';
import type { VaultKey } from '../vault/keys';
import { api, holdAccount } from './api';
import { setDefaultModel } from './assignment';
import { Files } from './files';
import { openSession, type Session } from './session';
import { ObjectStore } from './store';

// The bot scripts run in the test's own thread: node has no Worker to load them into. Made before withSession stubs
// window, which the VM's loader would read as a browser.
const lua = Lua.create();

export const testCard = (name: string): Card => ({
  name, nickname: null, description: '', personality: '', scenario: '', greetings: [], exampleDialogue: '', systemPrompt: '', postHistoryInstructions: '',
  creatorNotes: '', creator: '', version: '', tags: [], variables: [], toggles: '', utility: false, bias: [], regex: [], triggers: [],
  loreSettings: { scanDepth: null, tokenBudget: null, recursive: null, fullWordMatching: null },
});

type App = Awaited<ReturnType<typeof testApp>>;
// The relay's answer to the upstream request it carries. null is a connection that dropped.
type Relay = (sent: HttpRequest) => Response | null;

let server: { app: App; cookie: string | null } | null = null;
let relay: Relay | null = null;
// The server's answers not given yet, which a test waits for before its server goes: a call's marker and its drop
// are written after the result, while the test may already be done.
const answered = new Set<Promise<Response>>();

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
    const answering = Promise.resolve(server.app.raw(url.slice('/api/'.length), { ...init, headers }));
    answered.add(answering);
    void answering.finally(() => answered.delete(answering)).catch(() => {});
    return abortable(await answering, init.signal);
  });
}

// What ReplyStream calls upstream gets the relay's answers too, so a test says once what the provider answers.
const viaStreams: Upstream = async (url, { method, headers, body, signal }) => {
  if (!relay) throw new Error('This test gave the relay no answers.');
  const answer = relay({ url: url.toString(), method: method as HttpRequest['method'], headers: Object.fromEntries(headers), body });
  if (!answer) throw new TypeError('Failed to fetch');
  return abortable(answer, signal);
};

// An abort errors a response's body, as it does a real fetch's.
function abortable(response: Response, signal: AbortSignal | null | undefined): Response {
  if (!response.body || !signal) return response;
  const reader = response.body.getReader();
  const aborted = new Promise<never>((_, reject) => signal.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError'))));
  aborted.catch(() => reader.cancel());
  const read = new ReadableStream<Uint8Array>({
    pull: async (controller) => {
      const { done, value } = await Promise.race([reader.read(), aborted]);
      if (done) controller.close();
      else controller.enqueue(value);
    },
  });
  return new Response(read, { status: response.status, statusText: response.statusText, headers: response.headers });
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
  const held: (() => void)[] = [];
  beforeAll(async () => {
    app = await testApp(viaStreams);
  });
  afterAll(() => app.dispose());
  beforeEach(async () => {
    await app.reset();
    holdAccount(null);
    server = { app, cookie: null };
    relay = null;
    stubFetch();
  });
  afterEach(async () => {
    for (const release of held.splice(0)) release();
    while (answered.size) await Promise.allSettled([...answered]);
    vi.unstubAllGlobals();
  });

  const harness = {
    async hold(store: ObjectStore, ...chats: string[]) {
      for (const chat of chats) {
        const lease = store.retainChat(chat);
        held.push(lease.release);
        const failure = await lease.ready;
        if (failure) throw new Error(failure.error);
      }
    },
    // The page holds the account it signed up, as AccountFlow does, so every request states it.
    async account() {
      const body = signupBody();
      server!.cookie = sessionCookie(await app.post('signup', body));
      const { accountId } = body;
      holdAccount(accountId);
      const vaultKey = randomBytes(32);
      const open = (key: VaultKey = vaultKey) => ObjectStore.open(accountId, key, api);
      return { accountId, vaultKey, store: await open(), files: new Files(api), open };
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
      const opened = await openSession(accountId, vaultKey, 'jin', new AbortController().signal, undefined, undefined, () => lua);
      if (!opened.ok) throw new Error(opened.error);
      try {
        await test(opened.data);
      } finally {
        opened.data.close();
      }
    },
    // The password proof account() signs up with, for what asks for the password again, such as 탈퇴.
    passwordProof: { method: 'password', proof: signupBody().passwordProof } as const,
    // An account the Worker names as its operator.
    async operator() {
      const opened = await harness.account();
      app.env.ADMIN_ACCOUNT = opened.accountId;
      return opened;
    },
  };
  return harness;
}
