import { describe, expect, it } from 'vitest';
import { bareModel } from '../connectors/chat-completions';
import { RELAY_HEADER } from '../contracts/http';
import { fold, shown } from '../model/chat';
import { EMPTY_SETTINGS } from '../model/settings';
import { setDefaultModel } from './assignment';
import { appendUserMessage, startChat } from './chat-log';
import { featuresOf, setFeatureAt } from './features';
import { setPreread } from './preread';
import { addDefaults } from './prompts';
import type { Session } from './session';
import { answerable, inTurn, saying, stubRelay, testConnection, testServer, upstream } from './testing';
import { takeTurn } from './turn';

const server = testServer();

const SAID = ['The knight swore an oath.', 'She hid the key.', 'Go on'];

// batch 0 shortens whatever there is, so short messages make a call.
async function chatted(session: Session, { lab = true, batch = 0, texts = SAID }: { lab?: boolean; batch?: number; texts?: string[] } = {}) {
  await answerable(session);
  if (lab) await session.store.upsert('settings', (current = EMPTY_SETTINGS) => ({ ...current, labs: ['preread'] }));
  await addDefaults(session.store);
  await setFeatureAt(session.store, { kind: 'settings' }, 'preread', true);
  await setPreread(session.store, { recent: 0, batch });
  const chat = crypto.randomUUID();
  await server.hold(session.store, chat);
  await startChat(session.store, chat, { title: null, character: null, models: {} }, null);
  for (const text of texts) await appendUserMessage(session.store, chat, { id: crypto.randomUUID(), text });
  return chat;
}

const bodyOf = (log: ReturnType<typeof stubRelay>, at: number) => log[at]!.sent.body!;
const lastReply = (session: Session, chat: string) => shown(fold(session.store.children('entry', chat)).at(-1)!);

describe('토큰 절약', () => {
  it('sends the chat model the brief in place of the older messages, keeps the latest user message, and reuses the brief on 다시 생성', () =>
    server.withSession(async (session) => {
      const chat = await chatted(session);
      const log = stubRelay(inTurn([saying('NOTES: an oath, a key.'), saying('The reply.'), saying('Another reply.')]));
      expect(await takeTurn(session, chat, { kind: 'answer' })).toBeNull();
      expect(log).toHaveLength(2);
      expect(bodyOf(log, 0)).toContain('You prepare reading notes');
      expect(bodyOf(log, 0)).toContain('[chat · user]\\nThe knight swore an oath.');
      expect(bodyOf(log, 0)).not.toContain('Go on');
      expect(bodyOf(log, 1)).toContain('NOTES: an oath, a key.');
      expect(bodyOf(log, 1)).toContain('Go on');
      expect(bodyOf(log, 1)).not.toContain('The knight swore an oath.');
      const first = lastReply(session, chat).receipt!.preread!;
      expect(first).toMatchObject({ receipt: { state: 'done' } });
      expect(first.material).toBeGreaterThan(first.brief);
      expect(first.reused).toBeUndefined();
      const ledger = await session.usage.read(new AbortController().signal);
      expect(ledger.ok && ledger.data.some(({ call }) => call.id === first.receipt.id)).toBe(true);

      const reply = fold(session.store.children('entry', chat)).at(-1)!;
      expect(await takeTurn(session, chat, { kind: 'regenerate', message: reply.id })).toBeNull();
      expect(log).toHaveLength(3);
      expect(bodyOf(log, 2)).toContain('NOTES: an oath, a key.');
      expect(lastReply(session, chat).receipt!.preread).toMatchObject({ receipt: { id: first.receipt.id }, reused: true });
    }));

  it('reuses the brief on later turns while what it does not cover stays under the batch, sending that raw', () =>
    server.withSession(async (session) => {
      const [oath, key, moon] = ['The knight swore an oath. '.repeat(5), 'She hid the key. '.repeat(6), 'The moon rose. '.repeat(6)];
      const chat = await chatted(session, { batch: 40, texts: [oath, key, moon] });
      const log = stubRelay(inTurn([saying('NOTES'), saying('The reply.'), saying('Another reply.')]));
      expect(await takeTurn(session, chat, { kind: 'answer' })).toBeNull();
      await appendUserMessage(session.store, chat, { id: crypto.randomUUID(), text: 'Next' });
      expect(await takeTurn(session, chat, { kind: 'answer' })).toBeNull();
      expect(log).toHaveLength(3);
      expect(bodyOf(log, 2)).toContain('NOTES');
      expect(bodyOf(log, 2)).toContain('The moon rose.');
      expect(bodyOf(log, 2)).toContain('The reply.');
      expect(bodyOf(log, 2)).not.toContain('The knight swore');
      expect(lastReply(session, chat).receipt!.preread).toMatchObject({ reused: true });
    }));

  it('sends the request as it is, with no call, while the material is under the batch', () =>
    server.withSession(async (session) => {
      const chat = await chatted(session, { batch: 4000 });
      const log = stubRelay(inTurn([saying('The reply.')]));
      expect(await takeTurn(session, chat, { kind: 'answer' })).toBeNull();
      expect(log).toHaveLength(1);
      expect(bodyOf(log, 0)).toContain('The knight swore an oath.');
      expect(lastReply(session, chat).receipt!.preread).toBeUndefined();
    }));

  it('fails the turn unsent when the brief call fails, never sending the whole prompt', () =>
    server.withSession(async (session) => {
      const chat = await chatted(session);
      const log = stubRelay(inTurn([upstream(400, { error: { message: 'bad request' } })]));
      expect(await takeTurn(session, chat, { kind: 'answer' })).toMatchObject({ kind: 'preread', failure: { kind: 'failed' } });
      expect(log).toHaveLength(1);
      expect(fold(session.store.children('entry', chat))).toHaveLength(3);
    }));

  it('packs the material into a PDF on a route that takes one, the instruction left out of it', () =>
    server.withSession(async (session) => {
      const chat = await chatted(session);
      const flash = { ...bareModel('gemini-flash'), name: 'Flash', input: ['text' as const, 'file' as const] };
      const google = await session.store.create('connection', { ...testConnection, type: 'google', label: 'Google', accounts: [{ id: 'key', secret: 'g-x' }], starred: [flash] });
      if (!google.ok) throw new Error(google.error);
      await setDefaultModel(session.store, 'aux', { connection: google.data.id, model: flash.id });
      const brief = { candidates: [{ content: { parts: [{ text: 'NOTES' }], role: 'model' }, finishReason: 'STOP' }] };
      const log = stubRelay(inTurn([new Response(`data: ${JSON.stringify(brief)}\n\n`, { headers: { [RELAY_HEADER]: 'upstream' } }), saying('The reply.')]));
      expect(await takeTurn(session, chat, { kind: 'answer' })).toBeNull();
      const sent = JSON.parse(bodyOf(log, 0)) as { systemInstruction: { parts: { text: string }[] }; contents: { parts: { inlineData?: { mimeType: string } }[] }[] };
      expect(sent.systemInstruction.parts[0]!.text).toContain('You prepare reading notes');
      expect(sent.contents.flatMap(({ parts }) => parts).some((part) => part.inlineData?.mimeType === 'application/pdf')).toBe(true);
      expect(bodyOf(log, 0)).not.toContain('The knight swore an oath.');
      expect(lastReply(session, chat).receipt!.preread!.receipt.pdf).toBe(true);
    }));

  it('reads off while its 실험실 switch is off, whatever a layer set, and adds no default prompt', () =>
    server.withSession(async (session) => {
      const chat = await chatted(session, { lab: false });
      expect(featuresOf(session.store, session.store.get('chat', chat)!.value).preread).toBe(false);
      expect(session.store.list('prompt').some(({ value }) => value.task === 'preread')).toBe(false);
      const log = stubRelay(inTurn([saying('The reply.')]));
      expect(await takeTurn(session, chat, { kind: 'answer' })).toBeNull();
      expect(log).toHaveLength(1);
      expect(bodyOf(log, 0)).toContain('The knight swore an oath.');
    }));
});
