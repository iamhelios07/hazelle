import { afterEach, expect, it, vi } from 'vitest';
import { display } from '../engine/display';
import type { ChatScope } from '../engine/render';
import { Evaluation, EvaluationStopped } from './evaluation';
import { Evaluator, type EvaluationDown, type EvaluationUp } from './evaluation-core';

const scope: ChatScope = { card: null, packs: [], persona: null, prompt: null, note: null, lore: [], messages: [], variables: [], greeting: null, toggle: () => null, model: null, clock: { now: 0, timeZone: 'UTC' }, assets: [], modules: [], faces: { char: null, user: null }, screen: null, pick: 'chat' };
const message = (id: string, text: string) => ({ id, seed: id, role: 'user' as const, text, time: 0 });

afterEach(() => vi.unstubAllGlobals());

it('replays old tail reads and forward variables after a history delta, and matches the engine', async () => {
  const evaluation = new Evaluation();
  const first = { ...scope, messages: [message('old', '{{setvar::hp::7}}tail={{lastmessage}}'), message('tail', '{{getvar::hp}} old')] };
  expect(await evaluation.display('screen', first, new Set())).toEqual(display(first));
  const next = { ...first, messages: [first.messages[0]!, message('tail', '{{getvar::hp}} new')] };
  const result = await evaluation.display('screen', next, new Set());
  expect(result).toEqual(display(next));
  expect(result.texts).toEqual(['tail=7 new', '7 new']);
  evaluation.close();
});

it('coalesces queued revisions, settles cancellations and retains the active slot until its reply', async () => {
  const requests: Extract<EvaluationDown, { id: number }>[] = [];
  const engine = new Evaluator();
  let receive!: (data: EvaluationUp) => void;
  vi.stubGlobal('Worker', class {
    onmessage: ((event: { data: EvaluationUp }) => void) | null = null;
    constructor() { receive = (data) => this.onmessage?.({ data }); }
    postMessage(data: EvaluationDown) { if ('input' in data) requests.push(data); }
    terminate() {}
  });
  const evaluation = new Evaluation();
  const stop = new AbortController();
  const first = evaluation.display('screen', { ...scope, messages: [message('a', 'first')] }, new Set(), stop.signal);
  const cancelled = expect(first).rejects.toBeInstanceOf(EvaluationStopped);
  stop.abort();
  await cancelled;
  const old = evaluation.display('screen', { ...scope, messages: [message('a', 'obsolete')] }, new Set());
  const obsolete = expect(old).rejects.toBeInstanceOf(EvaluationStopped);
  const latest = evaluation.display('screen', { ...scope, messages: [message('a', 'latest')] }, new Set());
  await obsolete;
  expect(requests).toHaveLength(1);
  receive({ id: requests[0]!.id, result: await engine.run(requests[0]!.input) });
  expect(requests).toHaveLength(2);
  receive({ id: requests[1]!.id, result: await engine.run(requests[1]!.input) });
  expect((await latest).texts).toEqual(['latest']);
  const closing = evaluation.display('screen', scope, new Set());
  const closed = expect(closing).rejects.toBeInstanceOf(EvaluationStopped);
  evaluation.close();
  await closed;
});
