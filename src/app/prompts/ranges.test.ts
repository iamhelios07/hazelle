import { describe, expect, it } from 'vitest';
import type { Block, ChatRange } from '../../model/prompt';
import { chatWarning } from './ranges';

const chat = (from: number, to: number | null): Block => ({ id: `${from}:${to}`, name: null, kind: 'slot', slot: 'chat', range: { from, to } satisfies ChatRange });

describe('chatWarning', () => {
  it('is quiet when every message goes once', () => {
    expect(chatWarning([chat(0, -1), chat(-1, null)])).toBeNull();
    expect(chatWarning([chat(0, null)])).toBeNull();
    expect(chatWarning([chat(0, -2), chat(-2, null)])).toBeNull();
  });

  it('says when there is no chat slot or two slots send a message twice', () => {
    expect(chatWarning([])).toBe('‘채팅’ 자리가 없어서 주고받은 메시지가 하나도 들어가지 않아요.');
    expect(chatWarning([chat(0, null), chat(-1, null)])).toBe('같은 메시지가 두 번 들어가요. ‘채팅’ 자리들의 범위가 겹쳐요.');
  });

  it('names what no slot sends', () => {
    expect(chatWarning([chat(-1, null)])).toBe('앞부분이(가) 어느 ‘채팅’ 자리에도 들어가지 않아요.');
    expect(chatWarning([chat(0, -1)])).toBe('마지막 메시지이(가) 어느 ‘채팅’ 자리에도 들어가지 않아요.');
    expect(chatWarning([chat(0, -2), chat(-1, null)])).toBe('끝에서 2번째 메시지이(가) 어느 ‘채팅’ 자리에도 들어가지 않아요.');
    expect(chatWarning([chat(2, null)])).toBe('앞부분이(가) 어느 ‘채팅’ 자리에도 들어가지 않아요.');
    expect(chatWarning([chat(0, 3)])).toBe('뒷부분이(가) 어느 ‘채팅’ 자리에도 들어가지 않아요.');
  });
});
