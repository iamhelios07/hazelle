import { expect, it, vi } from 'vitest';
import { pictured } from '../engine/assets';
import { toBase64 } from '../vault/aead';
import { setDefaultModel } from './assignment';
import { startChat } from './chat-log';
import { keepPictures } from './inlays';
import { png, saying, stubRelay, testConnection, testModel, testServer } from './testing';
import { takeTurn } from './turn';

// The browser draws pictures; here one passes as it is, as one already within what a model is sent does.
vi.mock('./picture', () => ({ sentPicture: async (picture: unknown) => picture }));

const server = testServer();

it("sends a new chat's first message with its attached picture, its row written before the turn, to a model that reads pictures", () =>
  server.withSession(async (session) => {
    const { store, files } = session;
    const connection = await store.create('connection', { ...testConnection, starred: [{ ...testModel, input: ['text', 'image'] }] });
    if (!connection.ok) throw new Error(connection.error);
    await setDefaultModel(store, 'main', { connection: connection.data.id, model: testModel.id });
    const log = stubRelay(() => saying('보여.'));
    const bytes = png();
    const saved = await files.save([bytes]);
    if (!saved.ok) throw new Error(saved.error);
    const picture = { name: crypto.randomUUID(), type: 'image/png', size: bytes.length, file: saved.data[0]!, attached: true as const };
    const chat = crypto.randomUUID();
    const start = { greeting: null, saved: startChat(store, chat, { title: null, character: null, models: {} }, null) };
    expect(await start.saved).toBeNull();
    expect(await keepPictures(store, chat, [picture])).toEqual({ ok: true, data: null });
    expect(await takeTurn(session, chat, { kind: 'send', text: pictured([picture.name], '이거 봐') }, start)).toBeNull();
    const last = (JSON.parse(log.at(-1)!.sent.body!) as { messages: { content: unknown }[] }).messages.at(-1)!;
    expect(last.content).toEqual([{ type: 'image_url', image_url: { url: `data:image/png;base64,${toBase64(bytes)}` } }, { type: 'text', text: '이거 봐' }]);
  }));
