import { afterEach, expect, it, vi } from 'vitest';
import { display } from '../engine/display';
import type { ChatScope } from '../engine/render';
import { Evaluation, EvaluationFailed, EvaluationStopped, EvaluationStuck, type Verdicts } from './evaluation';
import { Evaluator, type EvaluationDown, type EvaluationUp } from './evaluation-core';
import { changedTail, sameHistory } from './history-delta';

const scope: ChatScope = { card: null, cast: [], packs: [], persona: null, prompt: null, note: null, lore: [], messages: [], variables: [], greeting: null, toggles: new Map(), model: null, clock: { now: 0, timeZone: 'UTC' }, assets: [], modules: [], faces: { char: null, user: null }, screen: null, pick: '' };
const message = (id: string, text: string) => ({ id, seed: id, role: 'user' as const, text, time: 0 });
const none: Verdicts = { verdict: () => false, judged: () => {} };
const screen = (chat = 'c') => ({ asker: 'screen', chat }) as const;

type Fake = { posted: EvaluationDown[]; ended: boolean; receive(data: EvaluationUp): void };
function fakeWorkers(log: string[] = []) {
  const workers: Fake[] = [];
  vi.stubGlobal('Worker', class implements Fake {
    onmessage: ((event: { data: EvaluationUp }) => void) | null = null;
    posted: EvaluationDown[] = [];
    ended = false;
    constructor() { workers.push(this); }
    postMessage(data: EvaluationDown) {
      this.posted.push(data);
      if ('input' in data) log.push(`posted ${data.input.lane}`);
    }
    terminate() { this.ended = true; }
    receive(data: EvaluationUp) { this.onmessage?.({ data }); }
  });
  const jobs = (worker: Fake) => worker.posted.flatMap((data) => 'input' in data ? [data] : []);
  return { workers, jobs };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it('replays old tail reads and forward variables after a history delta, and matches the engine', async () => {
  const evaluation = new Evaluation(none);
  const first = { ...scope, messages: [message('old', '{{setvar::hp::7}}tail={{lastmessage}}'), message('tail', '{{getvar::hp}} old')] };
  expect((await evaluation.display(screen(), first, new Set())).display).toEqual(display(first));
  const next = { ...first, messages: [first.messages[0]!, message('tail', '{{getvar::hp}} new')] };
  const result = await evaluation.display(screen(), next, new Set());
  expect(result.display).toEqual(display(next));
  expect(result.display.texts).toEqual(['tail=7 new', '7 new']);
  evaluation.close();
});

it('coalesces queued revisions, settles cancellations and retains the active slot until its reply', async () => {
  const { workers, jobs } = fakeWorkers();
  const engine = new Evaluator();
  const evaluation = new Evaluation(none);
  const stop = new AbortController();
  const first = evaluation.display(screen(), { ...scope, messages: [message('a', 'first')] }, new Set(), stop.signal);
  const cancelled = expect(first).rejects.toBeInstanceOf(EvaluationStopped);
  stop.abort();
  await cancelled;
  const old = evaluation.display(screen(), { ...scope, messages: [message('a', 'obsolete')] }, new Set());
  const obsolete = expect(old).rejects.toBeInstanceOf(EvaluationStopped);
  const latest = evaluation.display(screen(), { ...scope, messages: [message('a', 'latest')] }, new Set());
  await obsolete;
  const requests = () => jobs(workers[0]!);
  expect(requests()).toHaveLength(1);
  workers[0]!.receive({ id: requests()[0]!.id, result: await engine.run(requests()[0]!.input, () => {}) });
  expect(requests()).toHaveLength(2);
  workers[0]!.receive({ id: requests()[1]!.id, result: await engine.run(requests()[1]!.input, () => {}) });
  expect((await latest).display.texts).toEqual(['latest']);
  const closing = evaluation.display(screen(), scope, new Set());
  const closed = expect(closing).rejects.toBeInstanceOf(EvaluationStopped);
  evaluation.close();
  await closed;
});

it('does not let an older Lua patch cancel a newer whole-input revision', async () => {
  const evaluation = new Evaluation(none);
  const first = await evaluation.display(screen(), { ...scope, messages: [message('a', 'one')] }, new Set(), undefined, { revision: 1, generation: 1, waits: true });
  const item = first.work!.items[0]!;
  const next = evaluation.display(screen(), { ...scope, messages: [message('a', 'two')] }, new Set(), undefined, { revision: 2, generation: 2, waits: true });
  const old = evaluation.patch(screen(), 1, 1, [{ version: 'a', text: item.text, stamp: item.stamp, shown: 'obsolete' }]);
  expect((await next).display.texts).toEqual(['']);
  expect(await old).toBeNull();
  evaluation.close();
});

it('ends a worker that cannot answer before its job starts, failing every job and judging no chat', async () => {
  vi.useFakeTimers();
  const { workers } = fakeWorkers();
  const judged = vi.fn();
  const evaluation = new Evaluation({ verdict: () => false, judged });
  const loading = expect(evaluation.display(screen(), scope, new Set())).rejects.toBeInstanceOf(EvaluationFailed);
  const queued = expect(evaluation.display(screen('d'), scope, new Set())).rejects.toBeInstanceOf(EvaluationFailed);
  await vi.advanceTimersByTimeAsync(19_000);
  expect(workers[0]!.ended).toBe(false);
  await vi.advanceTimersByTimeAsync(6_000);
  await loading;
  await queued;
  expect(workers[0]!.ended).toBe(true);
  expect(judged).not.toHaveBeenCalled();
  evaluation.close();
});

it('keeps a started job alive while it gives signs of life, and through a beat that came late', async () => {
  vi.useFakeTimers();
  const { workers, jobs } = fakeWorkers();
  const evaluation = new Evaluation(none);
  const running = evaluation.display(screen(), scope, new Set());
  const worker = workers[0]!;
  const { id } = jobs(worker)[0]!;
  worker.receive({ started: id });
  for (let second = 0; second < 6; second++) {
    await vi.advanceTimersByTimeAsync(1_000);
    worker.receive({ progress: true });
  }
  await vi.advanceTimersByTimeAsync(1_000);
  // The page held for five seconds: the answer to the ping it sent waits behind that, so it pings again, not judges.
  vi.setSystemTime(Date.now() + 5_000);
  await vi.advanceTimersByTimeAsync(1_000);
  worker.receive({ pong: true });
  await vi.advanceTimersByTimeAsync(1_000);
  expect(worker.ended).toBe(false);
  worker.receive({ id, result: await new Evaluator().run(jobs(worker)[0]!.input, () => {}) });
  expect((await running).display.texts).toEqual([]);
  evaluation.close();
});

it('kills only a started job that goes silent, judges its chat before the next is posted, and goes on afresh', async () => {
  vi.useFakeTimers();
  const log: string[] = [];
  const { workers, jobs } = fakeWorkers(log);
  const engine = new Evaluator();
  const evaluation = new Evaluation({ verdict: () => false, judged: (chat) => log.push(`judged ${chat}`) });
  const messages = [message('a', 'one'), message('b', 'two')];
  const before = evaluation.display(screen('d'), { ...scope, messages }, new Set());
  const old = workers[0]!;
  old.receive({ id: jobs(old)[0]!.id, result: await engine.run(jobs(old)[0]!.input, () => {}) });
  await before;
  const stuck = expect(evaluation.display({ asker: 'projection', chat: 'c' }, scope, new Set())).rejects.toMatchObject({ constructor: EvaluationStuck, regex: true });
  old.receive({ started: jobs(old)[1]!.id });
  const next = { ...scope, messages: [...messages, message('c', 'three')] };
  const waiting = evaluation.display(screen('d'), next, new Set());
  await vi.advanceTimersByTimeAsync(5_000);
  await stuck;
  expect(old.ended).toBe(true);
  expect(log.slice(-2)).toEqual(['judged c', 'posted screen:d']);
  const fresh = workers[1]!;
  const job = jobs(fresh)[0]!;
  expect('history' in job.input && job.input.history).toEqual(changedTail([], next.messages, sameHistory));
  // Timed from its own start, not from the ping the killed job left unanswered.
  await vi.advanceTimersByTimeAsync(17_000);
  expect(fresh.ended).toBe(false);
  fresh.receive({ started: job.id });
  await vi.advanceTimersByTimeAsync(2_000);
  expect(fresh.ended).toBe(false);
  fresh.receive({ id: job.id, result: await new Evaluator().run(job.input, () => {}) });
  expect((await waiting).display.texts).toEqual(['one', 'two', 'three']);
  evaluation.close();
});

it('judges a started job that goes silent in a hidden tab, whose every beat comes late', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('document', { visibilityState: 'hidden' });
  const { workers, jobs } = fakeWorkers();
  const evaluation = new Evaluation(none);
  const running = expect(evaluation.display(screen(), scope, new Set())).rejects.toBeInstanceOf(EvaluationStuck);
  const worker = workers[0]!;
  worker.receive({ started: jobs(worker)[0]!.id });
  await vi.advanceTimersByTimeAsync(1_000);
  vi.setSystemTime(Date.now() + 60_000);
  await vi.advanceTimersByTimeAsync(1_000);
  await running;
  expect(worker.ended).toBe(true);
  evaluation.close();
});

it('says a display that went silent without the regex ran without it', async () => {
  vi.useFakeTimers();
  const { workers, jobs } = fakeWorkers();
  const evaluation = new Evaluation({ verdict: () => true, judged: () => {} });
  const running = expect(evaluation.display({ asker: 'projection', chat: 'c' }, scope, new Set())).rejects.toMatchObject({ constructor: EvaluationStuck, regex: false });
  const worker = workers[0]!;
  worker.receive({ started: jobs(worker)[0]!.id });
  await vi.advanceTimersByTimeAsync(5_000);
  await running;
  evaluation.close();
});

it('holds a job to its chat\'s verdict as it is posted: a passive one is refused, a display leaves the regex out, a press runs', async () => {
  const { workers, jobs } = fakeWorkers();
  const stuck = new Set<string>();
  const evaluation = new Evaluation({ verdict: (chat) => stuck.has(chat), judged: () => {} });
  const packs = [{ regex: [{ name: 'x', find: 'a', replace: 'b', stage: 'display' as const, flags: null }], triggers: [], toggles: '' }];
  const ahead = evaluation.display(screen('x'), scope, new Set());
  const queued = evaluation.display({ asker: 'projection', chat: 'c' }, { ...scope, packs }, new Set());
  const asked = evaluation.read({ asker: 'view', chat: 'c' }, scope, null);
  stuck.add('c');
  const worker = workers[0]!;
  worker.receive({ id: jobs(worker)[0]!.id, result: null });
  await ahead;
  const posted = jobs(worker);
  expect('scope' in posted[1]!.input && posted[1]!.input.scope.packs).toEqual([{ ...packs[0], regex: [] }]);
  worker.receive({ id: posted[1]!.id, result: null });
  await queued;
  await expect(asked).rejects.toBeInstanceOf(EvaluationStuck);
  const translation = { scope, take: new Set<number>(), prompt: { name: '', blocks: [], toggles: [], task: 'translate' as const }, translations: [], notes: '', request: { kind: 'input' as const, text: 'hi' }, language: 'Korean', seed: 's' };
  await expect(evaluation.translation({ asker: 'auto-translation', chat: 'c' }, translation)).rejects.toBeInstanceOf(EvaluationStuck);
  const pressed = evaluation.translation({ asker: 'translation', chat: 'c' }, translation);
  expect(jobs(worker).map(({ input }) => input.lane)).toEqual(['screen:x', 'projection:c', expect.stringMatching(/^translation:/)]);
  evaluation.close();
  await expect(pressed).rejects.toBeInstanceOf(EvaluationStopped);
});
