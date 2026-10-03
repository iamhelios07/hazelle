import { DisplayPass, type Display, type DisplayPatch, type DisplayWork } from '../engine/display';
import { assemble, rewritten, type Assembled, type PromptInput } from '../engine/pipeline';
import type { ChatScope } from '../engine/render';
import { applyTail, type Tail } from './history-delta';
import { tokenizer } from './tokenizer';

// What a version's text became in the bot's editDisplay pass, with the text and state it was run on.
export type LuaText = { text: string; stamp: string; shown: string };
const stamped = (generation: number, stamp: string) => `${generation}/${stamp}`;
export type ScopeData = Omit<ChatScope, 'toggle' | 'lua' | 'messages'> & { toggle: [string, string | null][] };
export type EvaluationJob =
  | { kind: 'display'; take: ReadonlySet<number>; lua?: { generation: number; revision: number; waits: boolean } }
  | { kind: 'prompt'; input: Omit<PromptInput, 'scope' | 'countTokens'> }
  | { kind: 'rewrite'; prompt: Assembled; messages: Parameters<typeof rewritten>[1]; budget: number | null };
export type LuaResult = LuaText & { version: string };
export type EvaluationInput = { lane: string; scope: ScopeData; history: Tail<ChatScope['messages'][number]>; job: EvaluationJob } | { lane: string; patch: { revision: number; generation: number; items: LuaResult[] } };
export type DisplayEvaluation = { display: Display; work: DisplayWork | null };
export type EvaluatedPrompt = ReturnType<typeof assemble> | { kind: 'tokenizer' };
export type EvaluationResult = DisplayEvaluation | DisplayPatch | EvaluatedPrompt | null;
export type EvaluationDown = { id: number; input: EvaluationInput } | { forget: string };
export type EvaluationUp = { id: number; result: EvaluationResult } | { id: number; error: string };

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
    const { lane, scope: data, history, job } = input;
    const messages = applyTail(this.histories.get(lane) ?? [], history);
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
