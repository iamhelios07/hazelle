import { display, type Display } from '../engine/display';
import { assemble, rewritten, type Assembled, type PromptInput } from '../engine/pipeline';
import type { ChatScope } from '../engine/render';
import { tokenizer } from './tokenizer';

export type LuaText = { text: string; stamp: string; shown: string };
export type ScopeData = Omit<ChatScope, 'toggle' | 'lua' | 'messages'> & { toggle: [string, string | null][] };
export type EvaluationJob =
  | { kind: 'display'; take: ReadonlySet<number>; lua?: { held: Map<string, LuaText>; generation: number; waits: boolean } }
  | { kind: 'prompt'; input: Omit<PromptInput, 'scope' | 'countTokens'> }
  | { kind: 'rewrite'; prompt: Assembled; messages: Parameters<typeof rewritten>[1]; budget: number | null };
export type EvaluationInput = { lane: string; scope: ScopeData; history: { from: number; messages: ChatScope['messages']; length: number }; job: EvaluationJob };
export type EvaluatedPrompt = ReturnType<typeof assemble> | { kind: 'tokenizer' };
export type EvaluationResult = Display | EvaluatedPrompt;
export type EvaluationDown = { id: number; input: EvaluationInput } | { forget: string };
export type EvaluationUp = { id: number; result: EvaluationResult } | { id: number; error: string };

export class Evaluator {
  private readonly histories = new Map<string, ChatScope['messages']>();

  forget(lane: string) { this.histories.delete(lane); }

  async run({ lane, scope: data, history, job }: EvaluationInput): Promise<EvaluationResult> {
    const messages = this.histories.get(lane) ?? [];
    messages.length = history.from;
    for (const message of history.messages) messages.push(message);
    messages.length = history.length;
    this.histories.set(lane, messages);
    const toggles = new Map(data.toggle);
    const scope: ChatScope = { ...data, messages, toggle: (key) => toggles.get(key) ?? null };
    if (job.kind !== 'display') {
      const countTokens = await tokenizer().catch(() => null);
      if (!countTokens) return { kind: 'tokenizer' };
      if (job.kind === 'rewrite') return rewritten(job.prompt, job.messages, countTokens, job.budget);
      return assemble({ ...job.input, scope: scope as PromptInput['scope'], countTokens });
    }
    const lua = job.lua;
    if (lua) scope.lua = (version, text, stamp) => {
      const had = lua.held.get(version);
      return had ? { text: had.shown, fresh: had.text === text && had.stamp === `${lua.generation}/${stamp}` } : lua.waits ? null : { text, fresh: false };
    };
    // CBS can read later messages and threads variables forward: always display the whole chat, never only its tail.
    return display(scope, job.take);
  }
}
