import { Runaway } from '../engine/cbs/evaluate';
import type { DisplayPatch } from '../engine/display';
import { readToggles } from '../engine/import/toggles';
import type { PromptInput } from '../engine/pipeline';
import type { ChatScope } from '../engine/render';
import { chatToggles } from '../model/toggles';
import type { DisplayEvaluation, EvaluatedPrompt, EvaluationDown, EvaluationInput, EvaluationJob, EvaluationResult, EvaluationUp, LuaResult } from './evaluation-core';
import { changedTail, sameHistory } from './history-delta';
import { moduleWorker } from './worker';
import workerUrl from './evaluation-worker?worker&url';

export class EvaluationStopped extends Error {}
export class EvaluationFailed extends Error {}
type Work = { lane: string; scope: ChatScope | null; job: EvaluationJob | { kind: 'patch'; owner: string; revision: number; generation: number; items: LuaResult[] }; resolve: (result: EvaluationResult) => void; reject: (error: Error) => void; stop: () => void; signal?: AbortSignal };

export class Evaluation {
  private worker: Worker | null = null;
  private active: { id: number; work: Work } | null = null;
  private readonly waiting = new Map<string, Work>();
  private readonly histories = new Map<string, ChatScope['messages']>();
  private ids = 0;
  private closed = false;

  display(lane: string, scope: ChatScope, take: ReadonlySet<number>, signal?: AbortSignal, lua?: Extract<EvaluationJob, { kind: 'display' }>['lua']): Promise<DisplayEvaluation> {
    return this.run(lane, scope, { kind: 'display', take, ...(lua && { lua }) }, signal) as Promise<DisplayEvaluation>;
  }

  patch(lane: string, revision: number, generation: number, items: LuaResult[], signal?: AbortSignal): Promise<DisplayPatch | null> {
    return this.run(`patch:${lane}`, null, { kind: 'patch', owner: lane, revision, generation, items }, signal) as Promise<DisplayPatch | null>;
  }

  prompt(lane: string, input: Omit<PromptInput, 'countTokens'>, signal?: AbortSignal): Promise<EvaluatedPrompt> {
    const { scope, ...rest } = input;
    return this.run(lane, scope, { kind: 'prompt', input: rest }, signal) as Promise<EvaluatedPrompt>;
  }

  rewrite(lane: string, scope: ChatScope, input: Omit<Extract<EvaluationJob, { kind: 'rewrite' }>, 'kind'>, signal?: AbortSignal): Promise<EvaluatedPrompt> {
    return this.run(lane, scope, { kind: 'rewrite', ...input }, signal) as Promise<EvaluatedPrompt>;
  }

  forget(lane: string) {
    for (const key of [lane, `patch:${lane}`]) {
      const waiting = this.waiting.get(key);
      if (waiting) { this.waiting.delete(key); waiting.stop(); waiting.reject(new EvaluationStopped()); }
      if (this.active?.work.lane === key) this.active.work.reject(new EvaluationStopped());
      this.histories.delete(key);
    }
    this.worker?.postMessage({ forget: lane } satisfies EvaluationDown);
  }

  close() {
    this.closed = true;
    this.end(new EvaluationStopped());
  }

  private run(lane: string, scope: ChatScope | null, job: Work['job'], signal?: AbortSignal): Promise<EvaluationResult> {
    return new Promise((resolve, reject) => {
      if (this.closed || signal?.aborted) return reject(new EvaluationStopped());
      if (this.active?.work.lane === lane) this.active.work.reject(new EvaluationStopped());
      const old = this.waiting.get(lane);
      if (old) { old.stop(); old.reject(new EvaluationStopped()); }
      const abort = () => {
        if (this.waiting.get(lane) === work) this.waiting.delete(lane);
        reject(new EvaluationStopped());
      };
      const work: Work = { lane, scope, job, resolve, reject, signal, stop: () => signal?.removeEventListener('abort', abort) };
      signal?.addEventListener('abort', abort, { once: true });
      this.waiting.set(lane, work);
      this.dispatch();
    });
  }

  private dispatch() {
    // Cancelling an executing synchronous pass cannot preempt it; keep its slot until the worker answers.
    if (this.active || this.closed) return;
    const work = [...this.waiting.values()].find((work) => work.lane.startsWith('send:')) ?? this.waiting.values().next().value;
    if (!work) return;
    this.waiting.delete(work.lane);
    const id = ++this.ids;
    this.active = { id, work };
    try {
      if (!this.worker) {
        const worker = moduleWorker(workerUrl);
        worker.onmessage = ({ data }: MessageEvent<EvaluationUp>) => this.receive(data);
        worker.onerror = worker.onmessageerror = () => this.end(new EvaluationFailed('Evaluation worker failed'));
        this.worker = worker;
      }
      let input: EvaluationInput;
      if (work.job.kind === 'patch') input = { lane: work.job.owner, patch: { revision: work.job.revision, generation: work.job.generation, items: work.job.items } };
      else {
        const { toggle, messages, ...scope } = work.scope!;
        delete scope.lua;
        const keys = chatToggles(scope.prompt?.toggles ?? [], scope.packs.flatMap((pack) => readToggles(pack.toggles).toggles));
        const previous = this.histories.get(work.lane) ?? [];
        input = { lane: work.lane, scope: { ...scope, toggle: keys.map(({ key }) => [key, toggle(key)]) }, history: changedTail(previous, messages, sameHistory), job: work.job };
        this.histories.set(work.lane, messages);
      }
      this.worker.postMessage({ id, input } satisfies EvaluationDown);
    } catch (error) { this.end(new EvaluationFailed(String(error))); }
  }

  private receive(data: EvaluationUp) {
    const active = this.active;
    if (!active || data.id !== active.id) return;
    this.active = null;
    active.work.stop();
    if ('error' in data) active.work.reject(new EvaluationFailed(data.error));
    else {
      // Structured cloning preserves Error but not a custom prototype; callers classify the engine's Runaway.
      if (data.result && 'stopped' in data.result && data.result.stopped) data.result.stopped = new Runaway();
      if (data.result && 'display' in data.result && data.result.display.stopped) data.result.display.stopped = new Runaway();
      active.work.resolve(data.result);
    }
    this.dispatch();
  }

  private end(error: Error) {
    this.worker?.terminate();
    this.worker = null;
    const work = [...this.waiting.values(), ...(this.active ? [this.active.work] : [])];
    this.waiting.clear();
    this.active = null;
    this.histories.clear();
    for (const each of work) { each.stop(); each.reject(error); }
  }
}
