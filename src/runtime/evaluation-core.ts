import { DisplayPass, type Display, type DisplayPatch, type DisplayWork } from '../engine/display';
import { standing, type Standing } from '../engine/memory';
import { activeLore, assemble, assembleMemory, assembleTranslation, rewritten, type Assembled, type MemoryTaskInput, type PromptInput, type RanAway, type TranslationInput } from '../engine/pipeline';
import type { RegexScript } from '../engine/import/types';
import { trySample } from '../engine/regex/scripts';
import { renderChat, type ChatScope } from '../engine/render';
import type { Memory, Source } from '../model/memory';
import { applyTail, type Tail } from './history-delta';
import { tokenizer } from './tokenizer';

export type LuaText = { text: string; stamp: string; shown: string };
const stamped = (generation: number, stamp: string) => `${generation}/${stamp}`;
export type ScopeData = Omit<ChatScope, 'lua' | 'messages'>;
export type EvaluationJob =
  | { kind: 'display'; take: ReadonlySet<number>; lua?: { generation: number; revision: number; waits: boolean } }
  | { kind: 'prompt'; input: Omit<PromptInput, 'scope' | 'countTokens'> }
  | { kind: 'rewrite'; prompt: Assembled; messages: Parameters<typeof rewritten>[1]; budget: number | null }
  | { kind: 'translation'; input: Omit<TranslationInput, 'scope' | 'countTokens'> }
  | { kind: 'memory'; input: Omit<MemoryTaskInput, 'scope' | 'countTokens'> }
  | { kind: 'read'; memory: { memory: Memory; shown: Source[]; budget: number } | null }
  | { kind: 'lore'; seed: string; limit: number };
export type LuaResult = LuaText & { version: string };
export type EvaluationInput =
  | { lane: string; scope: ScopeData; history: Tail<ChatScope['messages'][number]>; job: EvaluationJob }
  | { lane: string; patch: { revision: number; generation: number; items: LuaResult[] } }
  | { lane: string; count: string[] }
  | { lane: string; sample: { script: Omit<RegexScript, 'id'>; text: string } };
export type DisplayEvaluation = { display: Display; work: DisplayWork | null };
// Every count is made here, in the worker, the only realm that loads the tokenizer.
export type Counted<T> = T | { kind: 'tokenizer' };
export type EvaluatedPrompt = Counted<ReturnType<typeof assemble>>;
export type ChatTexts = { texts: string[]; tokens: number[]; standing: Standing | null };
export type EvaluationResult =
  | DisplayEvaluation
  | DisplayPatch
  | EvaluatedPrompt
  | Counted<ReturnType<typeof assembleTranslation> | ReturnType<typeof assembleMemory> | ChatTexts | { role: 'system' | 'user' | 'assistant'; text: string }[] | RanAway | number[]>
  | { sampled: string }
  | null;
export type EvaluationDown = { id: number; input: EvaluationInput } | { forget: string } | { warm: true } | { ping: true };
export type EvaluationUp = { id: number; result: EvaluationResult } | { id: number; error: string } | { pong: true };

export class Evaluator {
  private readonly displays = new Map<string, { revision: number; pass: DisplayPass }>();
  private readonly held = new Map<string, Map<string, LuaText>>();
  private readonly histories = new Map<string, ChatScope['messages']>();

  forget(lane: string) { this.histories.delete(lane); this.displays.delete(lane); this.held.delete(lane); }

  async run(input: EvaluationInput): Promise<EvaluationResult> {
    if ('patch' in input) {
      const current = this.displays.get(input.lane);
      if (!current) return null;
      const held = this.held.get(input.lane)!;
      for (const item of input.patch.items) held.set(item.version, { text: item.text, stamp: stamped(input.patch.generation, item.stamp), shown: item.shown });
      if (current.revision !== input.patch.revision) return null;
      const patch = current.pass.patch(input.patch.items.map(({ version, shown }) => ({ version, text: shown })));
      if (!patch.pass) this.displays.delete(input.lane);
      return patch;
    }
    if ('count' in input) {
      const countTokens = await tokenizer().catch(() => null);
      return countTokens ? input.count.map(countTokens) : { kind: 'tokenizer' };
    }
    if ('sample' in input) return { sampled: trySample(input.sample.script, input.sample.text) };
    const { lane, scope: data, history, job } = input;
    const messages = applyTail(this.histories.get(lane) ?? [], history);
    this.histories.set(lane, messages);
    const scope: ChatScope = { ...data, messages };
    if (job.kind !== 'display') {
      const countTokens = await tokenizer().catch(() => null);
      if (!countTokens) return { kind: 'tokenizer' };
      switch (job.kind) {
        case 'rewrite':
          return rewritten(job.prompt, job.messages, countTokens, job.budget);
        case 'prompt':
          return assemble({ ...job.input, scope: scope as PromptInput['scope'], countTokens });
        case 'translation':
          return assembleTranslation({ ...job.input, scope, countTokens });
        case 'memory':
          return assembleMemory({ ...job.input, scope, countTokens });
        case 'read': {
          const { texts } = renderChat('prompt', scope);
          const sent = job.memory && standing(job.memory.memory, { shown: job.memory.shown, roles: messages.map(({ role }) => role), texts }, job.memory.budget, countTokens);
          return { texts, tokens: texts.map((text) => countTokens(text.trim())), standing: sent };
        }
        case 'lore': {
          const lore = activeLore(scope, job.seed, countTokens);
          if ('kind' in lore) return lore;
          let total = 0;
          const fitting: typeof lore = [];
          for (const entry of lore) {
            total += countTokens(entry.text);
            if (total > job.limit) break;
            fitting.push(entry);
          }
          return fitting;
        }
      }
    }
    const lua = job.lua;
    const held = this.held.get(lane) ?? new Map<string, LuaText>();
    if (lua) this.held.set(lane, held);
    if (lua) scope.lua = (version, text, stamp) => {
      const had = held.get(version);
      return had ? { text: had.shown, fresh: had.text === text && had.stamp === stamped(lua.generation, stamp) } : lua.waits ? null : { text, fresh: false };
    };
    // CBS can read later messages and threads variables forward: always display the whole chat, never only its tail.
    const pass = new DisplayPass(scope, job.take);
    if (lua && pass.work) this.displays.set(lane, { revision: lua.revision, pass });
    else this.displays.delete(lane);
    if (!lua) this.held.delete(lane);
    return { display: pass.value, work: pass.work };
  }
}
