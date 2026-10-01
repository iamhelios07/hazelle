import { describe, expect, it, vi } from 'vitest';
import { fold, shown } from '../model/chat';
import { fingerprint } from '../engine/memory';
import { memoryId } from '../model/memory';
import { appendUserMessage, editMessage, startChat } from './chat-log';
import { chatMemory, setDefaultMemory } from './memory';
import { answerable, inTurn, saying, stubRelay, testServer } from './testing';
import { takeTurn } from './turn';

const server = testServer();

const summary = (what: string, line: string) =>
  JSON.stringify({ records: [{ to: 1, when: null, where: 'the pier', who: ['Luna', 'jin'], what, lines: [{ speaker: 'jin', text: line }], outcome: '', state: [{ about: 'Luna', field: 'place', value: 'the pier' }], opens: ['They meet again tomorrow.'], closes: [] }] });

describe('Rememberer', () => {
  it('summarizes the messages past the window once a reply is saved, and drops a result whose messages changed while it was written, then summarizes them as they are now', () =>
    server.withSession(async (session) => {
      await answerable(session);
      // A window of one token holds only the last message, and a batch of one token summarizes one message at a time.
      await setDefaultMemory(session.store, { window: 1, batch: 1 });
      const chat = crypto.randomUUID();
      await startChat(session.store, chat, { title: null, character: null, models: {} }, null);
      const said = crypto.randomUUID();
      await appendUserMessage(session.store, chat, { id: said, text: 'We meet at the pier.' });
      const stream = new TransformStream<Uint8Array, Uint8Array>();
      const writer = stream.writable.getWriter();
      const log = stubRelay(inTurn([saying('Luna waves.'), new Response(stream.readable, { headers: { 'x-relay': 'upstream' } }), saying(summary('jin and Luna meet at the pier at dawn.', 'We meet at the pier at dawn.'))]));
      expect(await takeTurn(session, chat, { kind: 'answer' })).toBeNull();
      await vi.waitFor(() => expect(log).toHaveLength(2));
      expect(session.memory.snapshot().running.get(chat)).toMatchObject({ model: 'M' });

      const message = () => fold(session.store.children('entry', chat))[0]!;
      await editMessage(session.store, chat, message(), 'We meet at the pier at dawn.', null);
      const chunk = { choices: [{ delta: { content: summary('jin and Luna meet at the pier.', 'We meet at the pier.') }, finish_reason: 'stop' }] };
      await writer.write(new TextEncoder().encode(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`));
      await writer.close();

      await vi.waitFor(() => expect(chatMemory(session.store, chat).records).toHaveLength(1));
      expect(log).toHaveLength(3);
      const memory = chatMemory(session.store, chat);
      expect(memory.records[0]).toMatchObject({ what: 'jin and Luna meet at the pier at dawn.', sources: [{ message: said, version: shown(message()).id }], receipt: { state: 'done', model: 'm' } });
      expect(memory.state).toEqual([{ about: 'Luna', field: 'place', value: 'the pier', record: memory.records[0]!.id }]);
      expect(memory.threads.map(({ text, opened }) => [text, opened])).toEqual([['They meet again tomorrow.', memory.records[0]!.id]]);
      await vi.waitFor(() => expect(session.memory.snapshot().running.size).toBe(0));
      await vi.waitFor(() => expect(session.store.list('stream')).toEqual([]));
      expect(session.store.get('memory', memoryId(chat))?.parent).toBe(chat);
    }));
  it('removes a fact that no longer holds and closes a thread as changes the new record keeps, never by a silent cut', () =>
    server.withSession(async (session) => {
      await answerable(session);
      await setDefaultMemory(session.store, { window: 1, batch: 1 });
      const chat = crypto.randomUUID();
      await startChat(session.store, chat, { title: null, character: null, models: {} }, null);
      const said = crypto.randomUUID();
      const text = 'Luna waits at the pier.';
      await appendUserMessage(session.store, chat, { id: said, text });
      const earlier = { id: 'r0', sources: [{ message: said, version: said }], print: fingerprint([{ role: 'user', text }]), when: null, where: 'the pier', who: ['Luna'], what: 'Luna waits.', lines: [], outcome: '', state: [], opens: ['Luna waits for jin.'], closes: [], receipt: null, at: 0 };
      const thread = { id: crypto.randomUUID(), text: 'Luna waits for jin.', opened: 'r0' };
      await session.store.create(
        'memory',
        { records: [earlier], state: [{ about: 'Luna', field: 'place', value: 'the pier', record: 'r0' }, { about: 'Luna', field: 'mood', value: 'calm', record: 'r0' }], threads: [thread] },
        { id: memoryId(chat), parent: chat },
      );
      await appendUserMessage(session.store, chat, { id: crypto.randomUUID(), text: 'jin arrives, and they leave the pier together.' });
      const answer = JSON.stringify({
        records: [{ to: 1, when: null, where: 'the pier', who: ['Luna', 'jin'], what: 'jin arrives and they leave together.', lines: [], outcome: '', state: [{ about: 'Luna', field: 'place', value: null }], opens: [], closes: [`T-${thread.id.slice(0, 8)}`] }],
      });
      stubRelay(inTurn([saying('Luna smiles.'), saying(answer)]));
      expect(await takeTurn(session, chat, { kind: 'answer' })).toBeNull();
      await vi.waitFor(() => expect(chatMemory(session.store, chat).records).toHaveLength(2));
      const memory = chatMemory(session.store, chat);
      expect(memory.state).toEqual([{ about: 'Luna', field: 'mood', value: 'calm', record: 'r0' }]);
      expect(memory.threads).toEqual([]);
      expect(memory.records[1]).toMatchObject({ state: [{ about: 'Luna', field: 'place', value: null }], closes: ['Luna waits for jin.'] });
    }));
});
