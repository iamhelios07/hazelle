import { describe, expect, it } from 'vitest';
import type { Card } from '../engine/import/types';
import { fold, shown } from '../model/chat';
import { appendUserMessage, startChat } from './chat-log';
import type { Session } from './session';
import { answerable, inTurn, saying, stubRelay, testServer, upstream } from './testing';
import { takeTurn } from './turn';

const server = testServer();

// A chat-completions stream that stops at its token limit after text, with what OpenRouter says it cost.
const cutAt = (text: string, cost: number) =>
  new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: text }, finish_reason: 'length' }], usage: { prompt_tokens: 10, completion_tokens: 5, cost } })}\n\ndata: [DONE]\n\n`, {
    headers: { 'x-relay': 'upstream' },
  });
const lastTwo = (body: string | null) => (JSON.parse(body!) as { messages: { role: string; content: string }[] }).messages.slice(-2);

// A chat whose reply was cut at its token limit.
async function cutReply(session: Session, answers: (Response | null)[]) {
  await answerable(session);
  const chat = crypto.randomUUID();
  await startChat(session.store, chat, { title: null, character: null, models: {} }, null);
  await appendUserMessage(session.store, chat, { id: crypto.randomUUID(), text: '이야기 하나 해 줘' });
  const log = stubRelay(inTurn([cutAt('옛날 옛적에', 0.002), ...answers]));
  await takeTurn(session, chat, { kind: 'answer' });
  const reply = () => fold(session.store.children('entry', chat))[1]!;
  return { chat, log, reply, cut: shown(reply()) };
}

const luna: Card = {
  name: '루나',
  nickname: null,
  description: '',
  personality: '',
  scenario: '',
  greetings: ['어서 와, {{user}}.', '또 왔네, {{char}}야.'],
  exampleDialogue: '',
  systemPrompt: '',
  postHistoryInstructions: '',
  creatorNotes: '',
  creator: '',
  version: '',
  tags: [],
  variables: [],
  toggles: '',
  utility: false,
  bias: [],
  regex: [],
  loreSettings: { scanDepth: null, tokenBudget: null, recursive: null, fullWordMatching: null },
};

describe('a new chat', () => {
  it('is saved as the chat, its greetings as written with the shown one selected, then the first message; names are filled where shown and sent', () =>
    server.withSession(async (session) => {
      const { store } = session;
      await answerable(session);
      const character = await store.create('character', { card: luna, folder: null, loreFolders: [] });
      const log = stubRelay(() => saying('왔구나.'));

      const chat = crypto.randomUUID();
      await startChat(store, chat, { title: null, character: character.ok ? character.data.id : null, models: {} }, { ids: [crypto.randomUUID(), crypto.randomUUID()], texts: luna.greetings, selected: 0 });
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
      // The starter prompt the session seeds: its texts, with the empty slots and notes left out, then the chat.
      expect(sent.messages.map(({ role }) => role)).toEqual(['system', 'system', 'system', 'system', 'system', 'assistant', 'user']);
      expect(sent.messages[4]!.content).toMatch(/^# Premise\nYou write 루나\. Your partner writes jin\./);
      expect(sent.messages.slice(-2)).toEqual([
        { role: 'assistant', content: '어서 와, jin.' },
        { role: 'user', content: '안녕' },
      ]);
    }));
});

describe('이어 쓰기', () => {
  it('sends the chat ending in the cut text with the continue instruction, and saves the joined text in the cut version’s place, keeping both calls and its rolls', () =>
    server.withSession(async (session) => {
      const { chat, log, reply, cut } = await cutReply(session, [saying(' 용이 살았어요.')]);
      expect(cut.receipt).toMatchObject({ state: 'cut', cut: 'length', cost: { unit: 'usd', amount: 0.002 } });

      expect(await takeTurn(session, chat, { kind: 'continue', message: reply().id, version: cut.id })).toBeNull();
      const [last, instruction] = lastTwo(log[1]!.sent.body);
      expect(last).toEqual({ role: 'assistant', content: '옛날 옛적에' });
      expect(instruction).toMatchObject({ role: 'user', content: expect.stringMatching(/^Your previous reply was cut off\./) });
      expect(reply().versions).toHaveLength(1);
      expect(shown(reply())).toMatchObject({ text: '옛날 옛적에 용이 살았어요.', receipt: { state: 'done', continues: cut.receipt }, seed: cut.seed });
    }));

  it('continues again on 다시 시도 after a continuation failed, so the cut text and every call stay', () =>
    server.withSession(async (session) => {
      const { chat, log, reply, cut } = await cutReply(session, [upstream(500, { error: { message: 'overloaded' } }), saying(' 끝.')]);
      await takeTurn(session, chat, { kind: 'continue', message: reply().id, version: cut.id });
      const failed = shown(reply());
      expect(failed).toMatchObject({ text: '옛날 옛적에', receipt: { state: 'failed', continues: cut.receipt } });

      expect(await takeTurn(session, chat, { kind: 'retry', message: reply().id, version: failed.id })).toBeNull();
      expect(lastTwo(log[2]!.sent.body)[0]).toEqual({ role: 'assistant', content: '옛날 옛적에' });
      expect(reply().versions).toHaveLength(1);
      expect(shown(reply())).toMatchObject({ text: '옛날 옛적에 끝.', receipt: { state: 'done', continues: failed.receipt } });
    }));
});
