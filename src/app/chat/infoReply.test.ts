import { describe, expect, it } from 'vitest';
import type { Shown } from '../../runtime/talk';
import { infoReply, pickStarted } from './infoReply';

const message = (id: string, role: 'user' | 'assistant'): Shown => ({ id, role, at: 0, versions: [], selected: 0, live: null });

describe('the reply 답장 정보 shows', () => {
  it('follows the latest unless a reply was picked, and a reply started while held is picked only when it is not the latest', () => {
    const messages = [message('a', 'assistant'), message('u', 'user'), message('b', 'assistant')];
    const replies = messages.filter((each) => each.role === 'assistant');
    expect(infoReply(replies, null)?.id).toBe('b');
    expect(infoReply(replies, 'a')?.id).toBe('a');
    expect(infoReply(replies, 'gone')?.id).toBe('b');
    expect(pickStarted(messages, 'b')).toBeNull();
    expect(pickStarted(messages, 'a')).toBe('a');
  });
});
