import { ChangeSignal } from '../change-signal';
import { agentNotes, keepsMemory, parseAgentAnswer } from '../engine/agent';
import type { RanAway } from '../engine/pipeline';
import { restore, type ProtectInvalid } from '../engine/protect';
import type { ChatScope } from '../engine/render';
import { fold, shown, type AgentRun, type Chat, type Message, type Receipt } from '../model/chat';
import { live } from '../model/library';
import type { AgentStage } from '../model/prompt';
import { EMPTY_SETTINGS, SETTINGS_ID } from '../model/settings';
import type { ApiFailure, ApiResult } from './api';
import type { RouteFailure } from './assignment';
import { scopeOf } from './chat-context';
import { appendPolished } from './chat-log';
import { evaluatingTask } from './evaluation';
import { featuresOf, type FeatureOwner } from './features';
import { switched } from './modules';
import { taskWriter } from './profiles';
import { chatPrompt, ofSort, type StoredPrompt } from './prompts';
import type { Session } from './session';
import type { ObjectStore } from './store';
import { pageAnswer } from './talk';
import { chatPlace, keepRow } from './usage';

// 에이전트 (design §6.16): the lists on the ladder 공용 → 프롬프트 → 캐릭터 → 채팅, which stack; the pre agents a turn runs
// before its prompt is assembled (runtime/turn prepare); the post agents run on a reply once it is saved (receiveReply).

type Reader = Pick<ObjectStore, 'get'>;
type Place = Pick<Chat, 'character' | 'prompt' | 'features' | 'agents'>;
export type AgentOwner = FeatureOwner;
type Agent = StoredPrompt<'agent'>;

// One layer's own list, as stored, in the order added.
export function agentsAt(store: Reader, owner: AgentOwner): string[] {
  if (owner.kind === 'settings') return store.get('settings', SETTINGS_ID)?.value.agents ?? [];
  if (owner.kind === 'prompt') {
    const prompt = store.get('prompt', owner.id)?.value;
    return prompt?.task === undefined ? (prompt?.agents ?? []) : [];
  }
  return store.get(owner.kind, owner.id)?.value.agents ?? [];
}

function layers(store: Reader, chat: Place): string[][] {
  const prompt = chatPrompt(store, chat);
  return [
    store.get('settings', SETTINGS_ID)?.value.agents ?? [],
    prompt.kind === 'prompt' ? (prompt.prompt.value.agents ?? []) : [],
    chat.character === null ? [] : (store.get('character', chat.character)?.value.agents ?? []),
    chat.agents ?? [],
  ];
}

// Farthest layer first, each in the order added; one on two layers runs once, at its first place. One gone, in 휴지통
// or of another sort reads as absent, as a module does.
function stacked(store: Reader, lists: string[][]): Agent[] {
  const ids = [...new Set(lists.flat())];
  return ids.flatMap((id) => {
    const prompt = live(store.get('prompt', id));
    return prompt && ofSort(prompt, 'agent') ? [prompt] : [];
  });
}

// What a chat runs, by stage: none while its 에이전트 기능 is off.
export function agentsOf(store: Reader, chat: Place): Record<AgentStage, Agent[]> {
  const all = featuresOf(store, chat).agents ? stacked(store, layers(store, chat)) : [];
  return { pre: all.filter(({ value }) => value.stage === 'pre'), post: all.filter(({ value }) => value.stage === 'post') };
}

// What a layer's list shows as already on: each agent the layers past it hold, by the farthest that holds it. A
// character's are what a new chat of it gets through the default prompt.
export function inheritedAgents(store: Reader, owner: Exclude<AgentOwner, { kind: 'settings' }>): Map<string, Exclude<AgentOwner['kind'], 'chat'>> {
  const chat = owner.kind === 'chat' ? store.get('chat', owner.id)?.value : undefined;
  const [shared, prompt, character] = layers(store, chat ?? { character: null });
  const past = owner.kind === 'prompt' ? [shared!] : owner.kind === 'character' ? [shared!, prompt!] : [shared!, prompt!, character!];
  const kinds = ['settings', 'prompt', 'character'] as const;
  const held = new Map<string, Exclude<AgentOwner['kind'], 'chat'>>();
  past.forEach((list, at) => {
    for (const id of list) if (!held.has(id)) held.set(id, kinds[at]!);
  });
  return held;
}

// on false takes it off this layer only: a list never removes what another layer holds (design §6.16).
export function setAgentAt(store: ObjectStore, owner: AgentOwner, id: string, on: boolean): Promise<ApiResult<unknown>> {
  const set = <T extends { agents?: string[] }>(current: T): T => ({ ...current, agents: switched(current.agents, id, on) });
  if (owner.kind === 'settings') return store.upsert('settings', (current = EMPTY_SETTINGS) => set(current));
  if (owner.kind === 'prompt') return store.update('prompt', owner.id, (current) => (current.task === undefined ? set(current) : current));
  if (owner.kind === 'character') return store.update('character', owner.id, set);
  return store.update('chat', owner.id, set);
}

// An agent's memory as the messages before a reply leave it: the user's own at the nearest version that has one, else
// what the nearest call kept. '' for none yet.
export function memoryOf(messages: readonly Message[], agent: string): string {
  for (let at = messages.length - 1; at >= 0; at--) {
    const version = shown(messages[at]!);
    const own = version.memories?.[agent];
    if (own !== undefined) return own;
    const kept = version.receipt?.agents?.findLast((run) => run.agent === agent && run.memory !== undefined);
    if (kept) return kept.memory!;
  }
  return '';
}

// failed: the call failed, or answered nothing. lost: a post agent's answer dropped tokens of its 보호 패턴.
export type AgentFailure =
  | RouteFailure
  | { kind: 'profile-missing'; own: boolean }
  | { kind: 'tokenizer' }
  | RanAway
  | ProtectInvalid
  | { kind: 'stopped' }
  | { kind: 'failed'; receipt: Receipt }
  | { kind: 'lost'; receipt: Receipt; count: number }
  | { kind: 'unsaved'; failure: ApiFailure };
// name: the agent's, which the failure is told by.
export type AgentFailed = { name: string; failure: Exclude<AgentFailure, { kind: 'stopped' }> };

type Deps = Pick<Session, 'store' | 'tokens' | 'credentials' | 'log'>;

// One call of one agent, and what it answered past its memory block. text: a post agent's input, absent for a pre
// agent.
async function call(session: Deps, chat: string, stored: Chat, { id, value: prompt }: Agent, scope: ChatScope, index: number, memory: string, text: string | undefined, signal: AbortSignal): Promise<{ run: AgentRun; text: string } | AgentFailure> {
  const { store } = session;
  const writer = taskWriter(store, stored, prompt.model);
  if ('kind' in writer) return writer;
  const lane = { asker: text === undefined ? ('agent' as const) : ('polish' as const), chat };
  const assembled = await evaluatingTask(store.evaluation.agent(lane, { scope, prompt, index, ...(text !== undefined && { text }), memory, seed: crypto.randomUUID() }, signal));
  if ('kind' in assembled) return assembled;
  const answer = await pageAnswer(session, writer, 'agent', chat, assembled.messages, signal);
  if ('kind' in answer) return answer;
  const { receipt } = answer;
  await keepRow(store, receipt, Date.now(), chatPlace(store, chat));
  const parsed = keepsMemory(prompt) ? parseAgentAnswer(answer.text) : { text: answer.text.trim(), memory: null };
  const restored = restore(parsed.text, assembled.spans);
  if (restored.missing) return { kind: 'lost', receipt, count: restored.missing };
  const made = restored.text.trim();
  if (!made) return { kind: 'failed', receipt };
  return { run: { agent: id, name: prompt.name, stage: prompt.stage, receipt, ...(text === undefined && { note: made }), ...(parsed.memory !== null && { memory: parsed.memory }) }, text: made };
}

// A turn's pre agents, all at once, over the chat as the turn sends it. again: the versions of the message the reply
// takes the place of or is made beside (다시 시도, 다시 생성), newest first, whose notes are used again (user ruling,
// 2026-10-15). messages: the chat's, before the reply. Any failure fails the turn (user ruling, 2026-10-21).
export async function preAgents(session: Deps, chat: string, stored: Chat, scope: ChatScope, messages: readonly Message[], again: readonly Message['versions'][number][], signal: AbortSignal): Promise<{ runs: AgentRun[]; notes: string } | AgentFailed | { kind: 'stopped' }> {
  const { pre } = agentsOf(session.store, stored);
  if (pre.length === 0 || scope.messages.length === 0) return { runs: [], notes: '' };
  const earlier = again.flatMap((version) => version.receipt?.agents ?? []);
  const ran = await Promise.all(
    pre.map(async (agent): Promise<AgentRun | AgentFailed | { kind: 'stopped' }> => {
      const kept = earlier.find((run) => run.agent === agent.id && run.stage === 'pre' && run.note !== undefined);
      if (kept) return { ...kept, name: agent.value.name, reused: true };
      const made = await call(session, chat, stored, agent, scope, scope.messages.length - 1, memoryOf(messages, agent.id), undefined, signal);
      if (!('kind' in made)) return made.run;
      return made.kind === 'stopped' ? made : { name: agent.value.name, failure: made };
    }),
  );
  const failed = ran.find((each) => 'kind' in each || 'failure' in each);
  if (failed) return failed as AgentFailed | { kind: 'stopped' };
  const runs = ran as AgentRun[];
  return { runs, notes: agentNotes(runs.map(({ name, note }) => ({ name, note: note! }))) };
}

// By the reply polished: failure null while its agents run, else why the last run stopped short, kept for the session.
export type Polishing = ReadonlyMap<string, { chat: string; message: string; failure: AgentFailed | null }>;

// The post agents of a saved reply, one after another, each given the text the last one left, which it rewrites or
// adds to (AgentPrompt place). What they made is saved as a version in the reply's place that keeps the raw text
// (design §6.16, user ruling 2026-10-21), the calls before a failure included.
export class Polisher {
  private closed = false;
  private state: Polishing = new Map();
  private readonly aborts = new Set<AbortController>();
  private readonly changes = new ChangeSignal();

  constructor(private readonly deps: Deps) {}

  readonly subscribe = this.changes.subscribe;

  readonly snapshot = () => this.state;

  private change(version: string, entry: { chat: string; message: string; failure: AgentFailed | null } | null) {
    const next = new Map(this.state);
    if (entry) next.set(version, entry);
    else next.delete(version);
    this.state = next;
    this.changes.notify();
  }

  // reply: the version Talk saved, which the bot's onOutput may have edited since. Resolves once the edit is saved or
  // nothing is, so what reads the reply after (응답 번역, 삽화, 마스코트) reads the edited one. Its chat must stay loaded
  // until this returns (session).
  async polish(chat: string, message: string, reply: string): Promise<void> {
    if (this.closed) return;
    const { store } = this.deps;
    const stored = live(store.get('chat', chat));
    if (!stored || agentsOf(store, stored.value).post.length === 0) return;
    const abort = new AbortController();
    this.aborts.add(abort);
    this.change(reply, { chat, message, failure: null });
    try {
      const failure = await this.run(chat, stored.value, message, reply, abort.signal);
      this.change(reply, failure ? { chat, message, failure } : null);
    } catch (error) {
      this.change(reply, null);
      throw error;
    } finally {
      this.aborts.delete(abort);
    }
  }

  close() {
    this.closed = true;
    for (const abort of this.aborts) abort.abort();
  }

  private async run(chat: string, stored: Chat, id: string, reply: string, signal: AbortSignal): Promise<AgentFailed | null> {
    const { store } = this.deps;
    const standing = () => {
      const messages = fold(store.children('entry', chat));
      const index = messages.findIndex((message) => message.id === id);
      const version = index === -1 ? null : shown(messages[index]!);
      return version && (version.id === reply || version.earlier?.includes(reply)) ? { messages, index, version } : null;
    };
    const start = standing();
    if (!start?.version.text.trim()) return null;
    const { messages, index, version } = start;
    const scope = scopeOf({ store }, chat, stored, messages.slice(0, index + 1));
    const runs: AgentRun[] = [];
    let text = version.text;
    let failed: AgentFailed | null = null;
    for (const agent of agentsOf(store, stored).post) {
      const made = await call(this.deps, chat, stored, agent, scope, index, memoryOf(messages.slice(0, index), agent.id), text, signal);
      if ('kind' in made) {
        if (made.kind !== 'stopped') failed = { name: agent.value.name, failure: made };
        break;
      }
      const { place } = agent.value;
      text = place === undefined ? made.text : place === 'before' ? `${made.text}\n\n${text}` : `${text}\n\n${made.text}`;
      runs.push(made.run);
    }
    // The user may have edited, switched or deleted it meanwhile: the edit stands only on the version it was made from.
    const now = standing();
    if (runs.length === 0 || !now || now.version.id !== version.id) return failed;
    const saved = await appendPolished(store, chat, now.messages[now.index]!, text, runs);
    return saved.ok ? failed : (failed ?? { name: runs.at(-1)!.name, failure: { kind: 'unsaved', failure: saved } });
  }
}
