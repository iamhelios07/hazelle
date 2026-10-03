import { Runaway } from '../engine/cbs/evaluate';
import type { DisplayPatch } from '../engine/display';
import type { assembleMemory, assembleTranslation, MemoryTaskInput, PromptInput, RanAway, TranslationInput } from '../engine/pipeline';
import type { ChatScope } from '../engine/render';
import type { ApiFailure } from './api';
import type { ChatTexts, Counted, DisplayEvaluation, EvaluatedPrompt, EvaluationDown, EvaluationInput, EvaluationJob, EvaluationResult, EvaluationUp, LuaResult } from './evaluation-core';
import { changedTail, sameHistory } from './history-delta';
import { Heartbeat, moduleWorker } from './worker';
import workerUrl from './evaluation-worker?worker&url';

export class EvaluationStopped extends Error {}
export class EvaluationFailed extends Error {}

// What an evaluation that did not finish tells its caller: it was stopped with that caller, or the worker failed.
export function evaluationFailure(error: unknown): ApiFailure {
  if (error instanceof EvaluationStopped) return { ok: false, error: 'stopped' };
  if (error instanceof EvaluationFailed) return { ok: false, error: 'evaluation-unavailable' };
  throw error;
}

// No pass over a real chat comes near this (the longest one measured, 217 messages, opens in about a second,
// 2026-10-03); a bot's regex that never ends does, and nothing in the engine stops it.
const STUCK_MS = 20_000;

type LooseJob = { kind: 'patch'; owner: string; revision: number; generation: number; items: LuaResult[] } | { kind: 'count'; texts: string[] };
type Work = { lane: string; scope: ChatScope | null; job: EvaluationJob | LooseJob; resolve: (result: EvaluationResult) => void; reject: (error: Error) => void; stop: () => void; signal?: AbortSignal };

// A lane holds one job: a newer one on the same lane stops the one waiting or running. A lane's history is kept until
// it is forgotten, so its next job sends the worker only what changed.
export class Evaluation {
  private worker: Worker | null = null;
  private active: { id: number; work: Work } | null = null;
  private readonly waiting = new Map<string, Work>();
  private readonly histories = new Map<string, ChatScope['messages']>();
  private readonly heart = new Heartbeat(STUCK_MS, () => this.worker?.postMessage({ ping: true } satisfies EvaluationDown), () => this.end(new EvaluationFailed('Evaluation worker stuck')));
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

  memory(lane: string, input: Omit<MemoryTaskInput, 'countTokens'>): Promise<Counted<ReturnType<typeof assembleMemory>>> {
    const { scope, ...rest } = input;
    return this.run(lane, scope, { kind: 'memory', input: rest }) as Promise<Counted<ReturnType<typeof assembleMemory>>>;
  }

  read(lane: string, scope: ChatScope, memory: Extract<EvaluationJob, { kind: 'read' }>['memory']): Promise<Counted<ChatTexts>> {
    return this.run(lane, scope, { kind: 'read', memory }) as Promise<Counted<ChatTexts>>;
  }

  // A translation's, and a bot's lorebook read, may run beside others of the same chat: each has a lane of its own,
  // forgotten once it answers.
  translation(input: Omit<TranslationInput, 'countTokens'>, signal?: AbortSignal): Promise<Counted<ReturnType<typeof assembleTranslation>>> {
    const { scope, ...rest } = input;
    return this.once('translation', scope, { kind: 'translation', input: rest }, signal) as Promise<Counted<ReturnType<typeof assembleTranslation>>>;
  }

  lore(scope: ChatScope, seed: string, limit: number): Promise<Counted<{ role: 'system' | 'user' | 'assistant'; text: string }[] | RanAway>> {
    return this.once('lore', scope, { kind: 'lore', seed, limit }) as Promise<Counted<{ role: 'system' | 'user' | 'assistant'; text: string }[] | RanAway>>;
  }

  count(texts: string[]): Promise<Counted<number[]>> {
    return this.run(`count:${++this.ids}`, null, { kind: 'count', texts }) as Promise<Counted<number[]>>;
  }

  // The tokenizer is loaded ahead of the first job that counts.
  warm() {
    if (!this.closed) this.open().postMessage({ warm: true } satisfies EvaluationDown);
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

  private once(kind: string, scope: ChatScope, job: EvaluationJob, signal?: AbortSignal): Promise<EvaluationResult> {
    const lane = `${kind}:${++this.ids}`;
    return this.run(lane, scope, job, signal).finally(() => this.forget(lane));
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

  private open(): Worker {
    if (this.worker) return this.worker;
    const worker = moduleWorker(workerUrl);
    worker.onmessage = ({ data }: MessageEvent<EvaluationUp>) => this.receive(data);
    worker.onerror = worker.onmessageerror = () => this.end(new EvaluationFailed('Evaluation worker failed'));
    this.worker = worker;
    return worker;
  }

  private dispatch() {
    // Cancelling an executing synchronous pass cannot preempt it; keep its slot until the worker answers.
    if (this.active || this.closed) return;
    const work = [...this.waiting.values()].find((work) => work.lane.startsWith('send:')) ?? this.waiting.values().next().value;
    if (!work) return this.heart.rest();
    this.waiting.delete(work.lane);
    const id = ++this.ids;
    this.active = { id, work };
    try {
      const worker = this.open();
      let input: EvaluationInput;
      if (work.job.kind === 'patch') input = { lane: work.job.owner, patch: { revision: work.job.revision, generation: work.job.generation, items: work.job.items } };
      else if (work.job.kind === 'count') input = { lane: work.lane, count: work.job.texts };
      else {
        const { messages, ...scope } = work.scope!;
        delete scope.lua;
        input = { lane: work.lane, scope, history: changedTail(this.histories.get(work.lane) ?? [], messages, sameHistory), job: work.job };
        this.histories.set(work.lane, messages);
      }
      worker.postMessage({ id, input } satisfies EvaluationDown);
      this.heart.start();
    } catch (error) { this.end(new EvaluationFailed(String(error))); }
  }

  private receive(data: EvaluationUp) {
    if ('pong' in data) return this.heart.answered();
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
    this.heart.rest();
    const work = [...this.waiting.values(), ...(this.active ? [this.active.work] : [])];
    this.waiting.clear();
    this.active = null;
    this.histories.clear();
    for (const each of work) { each.stop(); each.reject(error); }
  }
}
