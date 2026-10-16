import { expect, it } from 'vitest';
import { startChat } from './chat-log';
import { answerable, testServer } from './testing';
import { forecastSend, wouldSend } from './turn-context';

const server = testServer();

it('tells the composer why a draft cannot go when its CBS runs away, and its other callers only that it cannot', () => server.withSession(async (session) => {
  await answerable(session);
  const chat = crypto.randomUUID();
  await server.hold(session.store, chat);
  await startChat(session.store, chat, { title: null, character: null, models: {} }, null);
  const text = '{{settempvar::x::abcdefghijklmnop}}' + '{{settempvar::x::{{gettempvar::x}}{{gettempvar::x}}}}'.repeat(22);
  expect(await forecastSend(session, chat, { kind: 'send', text })).toEqual({ kind: 'runaway' });
  expect(await wouldSend(session, chat, { kind: 'send', text })).toBeNull();
}));
