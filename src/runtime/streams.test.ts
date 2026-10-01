import { describe, expect, it, vi } from 'vitest';
import { fold, shown } from '../model/chat';
import { startChat } from './chat-log';
import { openSession, type Session } from './session';
import { answerable, inTurn, stubRelay, testServer } from './testing';
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
    return opened.data;
  };
  return open;
}

// A chat whose reply streams from a provider the test writes to.
async function streaming(session: Session) {
  await answerable(session);
  const chat = crypto.randomUUID();
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
    expect(messages(first, chat)).toHaveLength(1);

    await writer.write(delta('traveler.'));
    await writer.write(ending);
    const second = await open();
    try {
      await vi.waitFor(() => expect(shown(messages(second, chat)[1]!)).toMatchObject({ text: 'Hello, traveler.', receipt: { state: 'done', firstTextMs: null } }));
      await vi.waitFor(() => expect(second.store.list('stream')).toEqual([]));
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
      await vi.waitFor(async () => expect((await fetch(`/api/streams/${call!.id}`)).status).toBe(404));
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
