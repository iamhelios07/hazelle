import { describe, expect, it } from 'vitest';
import type { Card } from '../engine/import/types';
import { startChat } from './chat-log';
import { answerable, saying, stubRelay, testServer } from './testing';
import { takeTurn } from './turn';

const server = testServer();

const luna = { name: '루나', nickname: null, description: '', personality: '', scenario: '', exampleDialogue: '', systemPrompt: '', postHistoryInstructions: '' } as Card;

describe('a new chat', () => {
  it('is saved as the chat, its greetings as written with the shown one selected, then the first message; names are filled where shown and sent', () =>
    server.withSession(async (session) => {
      const { store } = session;
      await answerable(session);
      const character = await store.create('character', { card: luna, folder: null, loreFolders: [] });
      const log = stubRelay(() => saying('왔구나.'));

      const started = await startChat(store, { title: null, character: character.ok ? character.data.id : null, models: {} }, { texts: ['어서 와, {{user}}.', '또 왔네, {{char}}야.'], selected: 0 });
      const chat = started.ok ? started.id : '';
      expect(session.views().chatById.get(chat)?.preview).toBe('어서 와, jin.');
      expect(await takeTurn(session, chat, { kind: 'send', text: '안녕' })).toBeNull();

      const entries = store.children('entry', chat).sort((a, b) => a.rev - b.rev);
      expect(entries[0]!.rev).toBeGreaterThan(store.get('chat', chat)!.rev);
      expect(entries.map(({ value }) => (value.type === 'message' || value.type === 'version' ? [value.type, value.text] : [value.type]))).toEqual([
        ['message', '어서 와, {{user}}.'],
        ['version', '또 왔네, {{char}}야.'],
        ['select'],
        ['message', '안녕'],
        ['message', '왔구나.'],
      ]);
      const sent = JSON.parse(log[0]!.sent.body!) as { messages: { role: string; content: string }[] };
      expect(sent.messages.slice(1)).toEqual([
        { role: 'assistant', content: '어서 와, jin.' },
        { role: 'user', content: '안녕' },
      ]);
    }));
});
