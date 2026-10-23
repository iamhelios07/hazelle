import { describe, expect, it } from 'vitest';
import type { Receipt } from '../../model/chat';
import type { LogEntry } from '../../runtime/request-log';
import { usageNotice } from './calls';

const usage = { inputTokens: 12_345, cachedInputTokens: null, cacheWriteInputTokens: null, outputTokens: 678, reasoningTokens: null };
const receipt = { state: 'done', usage, cost: { unit: 'usd', amount: 0.0123, source: 'reported' } } as Receipt;
const entry = (purpose: LogEntry['purpose'], change: Partial<LogEntry> = {}, made: Partial<Receipt> = {}) =>
  ({ chat: 'c', purpose, at: 0, picked: false, request: null, response: null, ...change, receipt: { ...receipt, ...made } }) as LogEntry;

describe('사용량 알림', () => {
  it('says a chosen kind of call with its tokens and cost, an unreported usage as unknown, and nothing for a failed, picked or unchosen call', () => {
    expect(usageNotice(entry('reply'), ['reply'])).toEqual({ message: '응답 · 입력 12,345 · 출력 678', detail: '비용 $0.0123' });
    expect(usageNotice(entry('input', {}, { usage: null, cost: 'pending' }), ['translate'])).toEqual({ message: '입력 번역 · 사용량 알 수 없음', detail: '비용 확인하는 중…' });
    expect(usageNotice(entry('reply', {}, { state: 'failed' }), ['reply'])).toBeNull();
    expect(usageNotice(entry('reply', { picked: true }), ['reply'])).toBeNull();
    expect(usageNotice(entry('memory'), ['reply'])).toBeNull();
  });
});
