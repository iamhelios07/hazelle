import { describe, expect, it, vi } from 'vitest';
import type { ConnectionType } from '../connectors/types';
import { fold, shown } from '../model/chat';
import { setIllustrate } from './characters';
import { appendUserMessage, startChat } from './chat-log';
import type { Session } from './session';
import { answerable, inTurn, saying, stubRelay, testCard, testServer } from './testing';
import { placeMark } from '../model/illustration';
import { takeTurn } from './turn';
import { removeIllustration, restoreIllustration } from './illustrate';

const { PAINTER } = vi.hoisted(() => {
  const PAINTER: ConnectionType = {
    id: 'fake-draws',
    label: 'Painter',
    group: 'maker',
    description: '',
    endpoint: { baseUrl: 'https://image.example', protocol: 'chat-completions' },
    draws: {
      request: (picture) => ({ url: 'https://image.example/generate', method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(picture) }),
      authHeaders: (secret) => ({ authorization: `Bearer ${secret}` }),
      parse: async (bytes, type) => (type === 'image/png' ? { bytes, type } : null),
    },
  };
  return { PAINTER };
});

vi.mock('../connectors/registry', async (importOriginal) => {
  const real = await importOriginal<typeof import('../connectors/registry')>();
  return { ...real, resolveConnection: (connection: Parameters<typeof real.resolveConnection>[0]) => (connection.type === PAINTER.id ? { ...real.resolveConnection({ ...connection, type: 'openrouter' })!, type: PAINTER } : real.resolveConnection(connection)) };
});

const server = testServer();

const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
const picture = () => new Response(PNG, { headers: { 'x-relay': 'upstream', 'content-type': 'image/png' } });
const scene = { after: 2, shape: 'portrait', setting: '1girl, indoors, night', framing: 'cowboy shot', characters: [{ name: 'Ari', look: 'girl, silver hair', outfit: 'white dress', action: 'smile', x: 0.5, y: 0.5 }] };
const REPLY = 'She opened the door.\nThe room was dark.\n\nShe smiled.';
const SCENE = { paragraph: 0, shape: 'square' as const, setting: '', framing: '', characters: [] };

async function painted(session: Session, starred = true) {
  await answerable(session);
  const model = { id: 'v5', name: 'V5', input: ['text' as const], output: ['image' as const], contextLength: null, maxOutput: null, reasoning: null, tools: null, protocol: null, takes: { settings: null, reasoning: null } };
  await session.store.create('connection', { type: PAINTER.id, label: 'Painter', baseUrl: null, protocol: null, accounts: [{ id: 'key', secret: 'pk-secret' }], turns: null, starred: starred ? [model] : [] });
  const chat = crypto.randomUUID();
  await server.hold(session.store, chat);
  await startChat(session.store, chat, { title: null, character: null, models: {} }, null);
  await appendUserMessage(session.store, chat, { id: crypto.randomUUID(), text: 'Go on' });
  return chat;
}

describe('Illustrator', () => {
  it('draws a reply received with auto on: one scene call, one image call, the picture stored for its version', () =>
    server.withSession(async (session) => {
      const chat = await painted(session);
      await setIllustrate(session.store, null, { auto: true });
      const log = stubRelay(inTurn([saying(REPLY), saying(JSON.stringify(scene)), picture()]));
      expect(await takeTurn(session, chat, { kind: 'answer' })).toBeNull();

      // The reply's save, the bot's onOutput, the scene's evaluation and both calls run in turn: more than waitFor's
      // default second on a loaded machine.
      await vi.waitFor(() => expect(session.store.children('illustration', chat)).toHaveLength(1), { timeout: 5000 });
      expect(session.illustrator.snapshot().size).toBe(0);
      const reply = fold(session.store.children('entry', chat))[1]!;
      const { value } = session.store.children('illustration', chat)[0]!;
      expect(value).toMatchObject({ message: reply.id, version: shown(reply).id, scene: { paragraph: 1, shape: 'portrait' }, receipt: { state: 'done' }, sent: { width: 832, height: 1216, characters: [{ center: { x: 0.5, y: 0.5 } }] }, type: 'image/png', size: PNG.byteLength });
      expect(log).toHaveLength(3);
      expect(log[1]!.sent.body).toContain('[2] The room was dark.');
      expect(log[2]!.sent).toMatchObject({ url: 'https://image.example/generate', headers: { authorization: 'Bearer pk-secret' } });
      expect(JSON.parse(log[2]!.sent.body!)).toMatchObject({ seed: value.sent.seed, prompt: expect.stringContaining('1girl, indoors, night, cowboy shot') });
      const read = await session.files.read(value.file);
      expect(read.ok && [...read.data]).toEqual([...PNG]);
    }));

  it('refuses before any call when no starred model draws, and keeps the failure for the slot', () =>
    server.withSession(async (session) => {
      const chat = await painted(session, false);
      const log = stubRelay(inTurn([saying(REPLY)]));
      await takeTurn(session, chat, { kind: 'answer' });
      const reply = fold(session.store.children('entry', chat))[1]!;
      session.illustrator.draw(chat, reply.id, shown(reply).id);
      await vi.waitFor(() => expect(session.illustrator.snapshot().get(reply.id)).toMatchObject({ stage: 'failed', failure: { kind: 'no-image-model' }, scene: null }));
      expect(log).toHaveLength(1);
      session.illustrator.dismiss(reply.id);
      expect(session.illustrator.snapshot().has(reply.id)).toBe(false);
    }));

  it('marks a picture’s paragraph in the text the screen displays, keeps the mark out of its texts, and loses it with a script that drops the line', () =>
    server.withSession(async (session) => {
      await answerable(session);
      const merging = { id: 'merge', name: 'merge', find: 'dark\\.\\n.*', replace: 'dark.', stage: 'display' as const, flags: null };
      const shownOn = async (regex: (typeof merging)[]) => {
        const made = await session.store.create('character', { card: { ...testCard('Ari'), regex }, folder: null, loreFolders: [] });
        if (!made.ok) throw new Error(made.error);
        const chat = crypto.randomUUID();
        await server.hold(session.store, chat);
        const opened = { title: null, character: made.data.id, models: {} };
        await startChat(session.store, chat, opened, null);
        await appendUserMessage(session.store, chat, { id: crypto.randomUUID(), text: 'Go on' });
        stubRelay(inTurn([saying(REPLY)]));
        await takeTurn(session, chat, { kind: 'answer' });
        const reply = fold(session.store.children('entry', chat))[1]!;
        const file = await session.files.save([PNG]);
        const sent = { prompt: '', negative: '', characters: [], width: 1024, height: 1024, seed: 1 };
        await session.store.create('illustration', { message: reply.id, version: shown(reply).id, scene: { ...SCENE, paragraph: 1 }, receipt: null, model: { connection: 'c', model: 'm' }, sent, file: file.ok ? file.data[0]! : { id: '', key: '' }, type: 'image/png', size: 1, at: 1 }, { parent: chat });
        const read = session.read.screen(chat, session.talk, session.illustrator, { chat: opened, messages: [] });
        const leave = read.subscribe(() => {});
        await vi.waitFor(() => expect(read.snapshot().display.texts[1]).toContain('She'));
        leave();
        return read.snapshot();
      };

      const plain = await shownOn([]);
      expect(plain.display.texts).toEqual(['Go on', REPLY]);
      expect(plain.placed).toEqual(new Map([[1, `She opened the door.\nThe room was dark.\n${placeMark(1)}\n\nShe smiled.`]]));
      const merged = await shownOn([merging]);
      expect([merged.display.texts[1], merged.placed.size]).toEqual(['She opened the door.\nThe room was dark.\n\nShe smiled.', 0]);
    }));

  it('deletes a picture at once and 되돌리기 brings it back under its id', () =>
    server.withSession(async (session) => {
      const chat = await painted(session);
      const saved = await session.files.save([PNG]);
      const file = saved.ok ? saved.data[0]! : { id: '', key: '' };
      const scene = { paragraph: 0, shape: 'square' as const, setting: '', framing: '', characters: [] };
      const sent = { prompt: '', negative: '', characters: [], width: 1024, height: 1024, seed: 1 };
      const made = await session.store.create('illustration', { message: 'm', version: 'v', scene, receipt: null, model: { connection: 'c', model: 'm' }, sent, file, type: 'image/png', size: PNG.byteLength, at: 1 }, { parent: chat });
      if (!made.ok) throw new Error(made.error);
      const removed = await removeIllustration(session.store, made.data.id);
      expect(session.store.children('illustration', chat)).toEqual([]);
      if (!removed.ok) throw new Error(removed.error);
      await restoreIllustration(session.store, removed.data);
      expect(session.store.children('illustration', chat).map(({ id, value }) => [id, value.file])).toEqual([[made.data.id, file]]);
    }));
});
