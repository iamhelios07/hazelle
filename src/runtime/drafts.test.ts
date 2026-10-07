import { expect, it } from 'vitest';
import { draftKey, Drafts } from './drafts';
import type { Session } from './session';
import { testServer } from './testing';

const server = testServer();

it('ends with its session, so the next account in the same tab finds no text', async () => {
  const key = draftKey(null, null);
  let closed: Session;
  await server.withSession(async (session) => {
    closed = session;
    session.drafts.set(key, '남의 글');
  });
  expect(closed!.drafts.text(key)).toBe('');
  await server.wipe();
  await server.withSession(async (session) => expect(session.drafts.text(key)).toBe(''));
});

it('puts a failed send back before what was typed since', () => {
  const drafts = new Drafts();
  drafts.set('chat', '그동안 쓴 말');
  drafts.putBack('chat', '보낸 말');
  expect(drafts.text('chat')).toBe('보낸 말\n그동안 쓴 말');
});

it("moves a new chat's text under the id it was saved as", () => {
  const drafts = new Drafts();
  const fresh = draftKey(null, 'character');
  drafts.set(fresh, '쓰던 말');
  drafts.move(fresh, 'chat');
  expect([drafts.text(fresh), drafts.text(draftKey('chat', 'character'))]).toEqual(['', '쓰던 말']);
});

it('notifies after every set, even for the same text, but clearing the session stays silent', () => {
  const drafts = new Drafts();
  const reads: string[] = [];
  drafts.subscribe(() => reads.push(drafts.text('chat')));
  drafts.set('chat', 'same');
  drafts.set('chat', 'same');
  drafts.close();
  expect(reads).toEqual(['same', 'same']);
  expect(drafts.text('chat')).toBe('');
});
