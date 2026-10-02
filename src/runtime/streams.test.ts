import { describe, expect, it, vi } from 'vitest';
import { fetchApi } from './api';
import { fold, shown } from '../model/chat';
import { appendUserMessage, startChat } from './chat-log';
import { openSession, type Session } from './session';
import { answerable, inTurn, saying, stubRelay, testServer } from './testing';
import { takeTurn } from './turn';

const server = testServer();
const encode = (text: string) => new TextEncoder().encode(text);
const delta = (text: string) => encode(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`);
const ending = encode('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');

// Two page loads of one account: a reload, or another device.
async function pages() {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('document', { visibilityState: 'hidden' });
  const { accountId, vaultKey } = await server.account();
  const open = async () => {
    const opened = await openSession(accountId, vaultKey, 'jin', new AbortController().signal);
    if (!opened.ok) throw new Error(opened.error);
    opened.data.startBackground();
    return opened.data;
  };
  return open;
}

// A chat whose reply streams from a provider the test writes to.
async function streaming(session: Session) {
  await answerable(session);
  const chat = crypto.randomUUID();
  await server.hold(session.store, chat);
  await startChat(session.store, chat, { title: null, character: null, models: {} }, null);
  const provider = new TransformStream<Uint8Array, Uint8Array>();
  stubRelay(inTurn([new Response(provider.readable, { headers: { 'x-relay': 'upstream' } })]));
  return { chat, writer: provider.writable.getWriter() };
}

const messages = (session: Session, chat: string) => fold(session.store.children('entry', chat));

describe('a detached call', () => {
  it('goes on after its page closes, and the next load saves the whole reply and drops the call', async () => {
    const open = await pages();
    const first = await open();
    const { chat, writer } = await streaming(first);
    const turn = takeTurn(first, chat, { kind: 'send', text: 'Hi' });
    await writer.write(delta('Hello, '));
    await vi.waitFor(() => expect(first.talk.snapshot()?.text).toBe('Hello, '));
    await vi.waitFor(() => expect(first.store.list('stream')).toHaveLength(1));
    first.close();
    expect(await turn).toBeNull();
    expect(first.store.projection(chat)).toBeNull();

    await writer.write(delta('traveler.'));
    await writer.write(ending);
    const second = await open();
    await server.hold(second.store, chat);
    try {
      await vi.waitFor(() => expect(shown(messages(second, chat)[1]!)).toMatchObject({ text: 'Hello, traveler.', receipt: { state: 'done', firstTextMs: null } }));
      await vi.waitFor(() => expect(second.store.list('stream')).toEqual([]));
    } finally {
      second.close();
    }
  });

  it('writes its marker only once the server holds the call, so no pick-up reads a call not started yet', () =>
    server.withSession(async (session) => {
      const { chat, writer } = await streaming(session);
      const served = globalThis.fetch;
      const order: string[] = [];
      let marked = () => {};
      const marking = new Promise<void>((resolve) => (marked = resolve));
      vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
        if (url === '/api/objects/batch' && (JSON.parse(init!.body as string) as { writes: { kind: string }[] }).writes.some(({ kind }) => kind === 'stream')) {
          order.push('marker');
          marked();
        }
        if (!url.startsWith('/api/streams/') || init?.method !== 'POST') return served(url, init);
        // The start is held until the marker is sent, or long enough that one sent before it would have been.
        await Promise.race([marking, new Promise((resolve) => setTimeout(resolve, 300))]);
        order.push('started');
        return served(url, init);
      });
      const turn = takeTurn(session, chat, { kind: 'send', text: 'Hi' });
      await writer.write(delta('Hello.'));
      await writer.write(ending);
      expect(await turn).toBeNull();
      expect(order.slice(0, 2)).toEqual(['started', 'marker']);
    }));

  it('keeps reading a call it picked up when its own first try cannot reach the server', async () => {
    const open = await pages();
    const first = await open();
    const { chat, writer } = await streaming(first);
    const turn = takeTurn(first, chat, { kind: 'send', text: 'Hi' });
    await writer.write(delta('Hello, '));
    await vi.waitFor(() => expect(first.store.list('stream')).toHaveLength(1));
    first.close();
    expect(await turn).toBeNull();

    const served = globalThis.fetch;
    let reads = 0;
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      if (url.startsWith('/api/streams/') && !init?.method && reads++ === 0) throw new TypeError('Failed to fetch');
      return served(url, init);
    });
    const second = await open();
    await server.hold(second.store, chat);
    try {
      await vi.waitFor(() => expect(second.talk.snapshot()?.text).toBe('Hello, '), { timeout: 3000 });
      await writer.write(delta('traveler.'));
      await writer.write(ending);
      await vi.waitFor(() => expect(shown(messages(second, chat)[1]!)).toMatchObject({ text: 'Hello, traveler.', receipt: { state: 'done' } }));
      expect(reads).toBe(2);
    } finally {
      second.close();
    }
  });

  it('ends on the server too when 멈추기 stops it, saving the text so far as cut', () =>
    server.withSession(async (session) => {
      const { chat, writer } = await streaming(session);
      const turn = takeTurn(session, chat, { kind: 'send', text: 'Hi' });
      await writer.write(delta('Hello'));
      await vi.waitFor(() => expect(session.talk.snapshot()?.text).toBe('Hello'));
      await vi.waitFor(() => expect(session.store.list('stream')).toHaveLength(1));
      const [call] = session.store.list('stream');
      session.talk.stop();
      expect(await turn).toBeNull();
      expect(shown(messages(session, chat)[1]!)).toMatchObject({ text: 'Hello', receipt: { state: 'cut', cut: 'stopped' } });
      await vi.waitFor(async () => expect((await fetchApi(`streams/${call!.id}`)).status).toBe(404));
      await vi.waitFor(() => expect(session.store.list('stream')).toEqual([]));
    }));

  it('reads again from where it was when the page’s connection breaks', () =>
    server.withSession(async (session) => {
      const { chat, writer } = await streaming(session);
      const served = globalThis.fetch;
      // The first answer to the call breaks after its first chunk, as a phone putting the tab to sleep would.
      vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
        const response = await served(url, init);
        if (!url.startsWith('/api/streams/') || init?.method !== 'POST') return response;
        const reader = response.body!.getReader();
        let read = false;
        const broken = new ReadableStream<Uint8Array>({
          pull: async (controller) => {
            if (read) return controller.error(new TypeError('network changed'));
            read = true;
            const { value } = await reader.read();
            controller.enqueue(value!);
          },
        });
        return new Response(broken, { headers: response.headers });
      });
      const turn = takeTurn(session, chat, { kind: 'send', text: 'Hi' });
      await writer.write(delta('Hello, '));
      await writer.write(delta('traveler.'));
      await writer.write(ending);
      expect(await turn).toBeNull();
      expect(shown(messages(session, chat)[1]!)).toMatchObject({ text: 'Hello, traveler.', receipt: { state: 'done' } });
      await vi.waitFor(() => expect(session.store.list('stream')).toEqual([]));
    }));
});

describe('a send', () => {
  it('pulls first, so its prompt has what another device wrote since this page last pulled', async () => {
    const open = await pages();
    const here = await open();
    await answerable(here);
    const chat = crypto.randomUUID();
    await startChat(here.store, chat, { title: null, character: null, models: {} }, null);
    const there = await open();
    try {
      await appendUserMessage(there.store, chat, { id: crypto.randomUUID(), text: 'Written there' });
      const log = stubRelay(inTurn([saying('Hello')]));
      expect(await takeTurn(here, chat, { kind: 'send', text: 'Hi' })).toBeNull();
      expect(log[0]!.sent.body).toContain('Written there');
    } finally {
      here.close();
      there.close();
    }
  });
});
