import { describe, expect, it } from 'vitest';
import type { Message, Receipt } from '../../model/chat';
import { describeFailedReply } from '../common/failure';
import { estimateRun, parseMessages, runMessages, stepOf, type Step } from './autopilot';

describe('parseMessages', () => {
  it('sends each line as one message and skips blank ones', () => {
    expect(parseMessages('  안녕\n\n문을 연다 \r\n\n')).toEqual(['안녕', '문을 연다']);
  });
});

describe('estimateRun', () => {
  it('prices each message as one call of the next input and the last reply, and leaves the cost unknown without a price or a reply', () => {
    const price = { input: 2, output: 10, cacheRead: null, cacheWrite: null, tiers: [] };
    const priced = estimateRun(3, 1000, 100, price, 'usd');
    expect(priced).toMatchObject({ input: 3000, output: 300, cost: { unit: 'usd', source: 'price-list' } });
    expect(priced.cost!.amount).toBeCloseTo(0.009);
    expect(estimateRun(3, 1000, 100, undefined, 'usd').cost).toBeNull();
    expect(estimateRun(3, 1000, null, price, 'usd')).toEqual({ input: 3000, output: null, cost: null });
  });
});

describe('stepOf', () => {
  it('fails on a failed reply with its error, stops on a stopped one, and fails when no reply came', () => {
    const reply = (receipt: Partial<Receipt>): Message => ({ id: 'r', role: 'assistant', at: 0, selected: 0, versions: [{ id: 'r', seed: 'r', text: '', edited: false, at: 0, receipt: { state: 'done', cut: null, error: null, ...receipt } as Receipt }] });
    expect(stepOf(null, reply({}), false)).toEqual({ kind: 'answered' });
    expect(stepOf(null, reply({ state: 'failed', error: { kind: 'offline' } }), false)).toEqual({ kind: 'failed', why: describeFailedReply({ kind: 'offline' }) });
    expect(stepOf(null, reply({ state: 'cut', cut: 'stopped' }), false)).toEqual({ kind: 'stopped' });
    expect(stepOf(null, undefined, false)).toEqual({ kind: 'failed', why: '응답을 받지 못했어요.' });
  });
});

describe('runMessages', () => {
  it('sends nothing after the first message that fails', async () => {
    const sent: string[] = [];
    const steps: Step[] = [{ kind: 'answered' }, { kind: 'failed', why: '실패' }, { kind: 'answered' }];
    const end = await runMessages(['하나', '둘', '셋'], async (text, at) => {
      sent.push(text);
      return steps[at]!;
    }, new AbortController().signal);
    expect(end).toEqual({ kind: 'failed', at: 1, text: '둘', why: '실패' });
    expect(sent).toEqual(['하나', '둘']);
  });
});
