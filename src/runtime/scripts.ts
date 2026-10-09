import { noOutcome, ToolLate, ToolStopped, ToolStuck, type Binding, type LuaRunner } from './script-binding';
import { live, type PackOwner } from '../model/library';
import { toolId, type ToolUnit } from '../model/tool';
import type { MemoryFill, PromptInput } from '../engine/pipeline';
import { saveToolChat, toolsOf, ToolRate, TOOL_NOTICES_PER_MINUTE } from './tools/store';
import { ChangeSignal } from '../change-signal';
import { Runaway } from '../engine/cbs/evaluate';
import type { Role } from '../connectors/assignment';
import type { ChatMessage } from '../connectors/types';
import { isRecord } from '../connectors/values';
import type { EmbedResult, Event, ToolEvent, Outcome, ScriptUnit, ModelResult, ModelRefusal } from '../engine/script-api';
import type { EmbedPurpose } from '../connectors/types';
import type { Host, ModelMessage, Question } from '../engine/script-api';
import type { ChatScope } from '../engine/render';
import { shown, type Receipt, type Writes } from '../model/chat';
import type { ApiFailure } from './api';
import { chatModel, embedModel } from './assignment';
import { embedTexts } from './embed';
import { setModels, setTakesMemory } from './pack';
import { memoryOwner } from './memory-read';
import { appendCall, appendScripted, appendUserMessage, type Written } from './chat-log';
import type { Costs } from './cost';
import type { Credentials } from './credential';
import { evaluationFailure, EvaluationStuck } from './evaluation';
import { generate } from './generate';
import type { ScriptOutcome } from './lua/event';
import { LuaStuck } from './lua/client';
import { modelProfile } from './profiles';
import type { ReadModels } from './read-model';
import type { ScriptDisplay } from './script-display';
import type { ObjectStore } from './store';
import { callOf, endCall, pageCall } from './streams';
import { receiptOf } from './talk';
import { packsOf, scopeOf } from './chat-context';
import type { Blocked, TurnContext } from './turn-context';

// said: the script's own words (alertNormal, alertError, showAlert, a tool's say). The others are the app's about it.
// no-model: a script called a model of a role the chat has none for. flood: it called models faster than the server
// lets a chat's scripts (server/streams). late: a tool missed the prompt deadline and the turn went without its slot.
// stuck: disabled once a tool stalled too often, until reload. memory-held: a tool the user let take the memory slot
// cannot, since another tool before it in the chat holds it.
// unsaved: what a run did to the chat could not be saved. runaway: the script's commands were stopped for making too
// much text.
type Note =
  | { kind: 'said'; tone: 'normal' | 'error'; text: string }
  | { kind: 'failed'; message: string }
  | { kind: 'missing'; names: string[] }
  | { kind: 'stuck'; disabled?: true }
  | { kind: 'no-model'; role: Role }
  | { kind: 'late' }
  | { kind: 'memory-held'; by: string }
  | { kind: 'stale-reply' }
  | { kind: 'flood' }
  | { kind: 'unsaved'; failure: ApiFailure }
  | { kind: 'runaway' };
export type ScriptNote = { id: number; chat: string; from: PackOwner | null } & Note;
// Consent is saved on the spender, not the chat's character: 'yes' allows it and 'no' refuses it.
// A dismissal leaves it to be asked again. memory: a tool's claim on the memory slot, saved on its module.
export type ScriptQuestion = { id: number; chat: string; from: PackOwner; question: Question | { kind: 'model' } | { kind: 'memory' } };
export type ScriptsState = { notes: ScriptNote[]; questions: ScriptQuestion[] };

export type Halted = { kind: 'halted' };
// turn: as it goes on. Its said is null once the user's message was saved here; a failure after that is kept
// (runtime/turn TurnFailure).
export type Started = { turn: TurnContext } | Halted | ((Blocked | { kind: 'gone' } | { kind: 'unsent'; failure: ApiFailure }) & { kept?: true });

// The triggers of a chat's packs, in the packs' order (design §6.5), which is the order a run walks them in. A block
// trigger keeps its name as written, since a press finds it by that. One turned off, and a Lua one with no code yet,
// are left out: it would start an engine and count the chat as scripted for nothing.
export const triggersOf = (packs: ReturnType<typeof packsOf>): ScriptUnit[] => packs.flatMap(({ id, pack, module }) =>
  pack.triggers.filter((trigger) => !trigger.off && (trigger.kind !== 'lua' || trigger.code.trim())).map((trigger) => ({
    ...trigger, ...(trigger.kind === 'lua' && { name: trigger.name || 'Lua' }), owner: { kind: module ? 'module' as const : 'character' as const, id },
  })),
);
// index counts from the first message after the greeting, as a tool reads it.
const atOf = (scope: ChatScope, message: string): Hazelle.At | null => {
  const index = scope.messages.findIndex((each) => each.message === message);
  return index === -1 ? null : { index: index - (scope.greeting === null ? 0 : 1), id: message, version: scope.messages[index]!.id };
};

export const scriptsOf = (packs: ReturnType<typeof packsOf>) => triggersOf(packs).filter((trigger): trigger is Extract<ScriptUnit, { kind: 'lua' }> => trigger.kind === 'lua');

type Units = { lua: ScriptUnit[]; event: Event } | { tool: ToolUnit; event: ToolEvent };

const ownerOf = (units: Units): PackOwner | null => 'tool' in units ? { kind: 'module', id: units.tool.module } : null;

type Anchor = { version: string; stays?: true };

// A tool's last prompt answer in this session: its slot text, and its memory with the id it stands through.
type Answered = { tool: string; memory: { text: string; through: string | null } | null };

// The bot's scripts in the life of a chat (design §6.8). The only place that turns what a run did into entries.
export class Scripts {
  private state: ScriptsState = { notes: [], questions: [] };
  private readonly changes = new ChangeSignal();
  private readonly answers = new Map<number, (answer: string | null) => void>();
  private readonly queues = new Map<string, Promise<unknown>>();
  // What each chat was already told of its bot's errors, so a script failing on every message says so once.
  private readonly told = new Map<string, Set<string>>();
  private readonly closing = new AbortController();
  private ids = 0;
  private readonly consents = new Map<string, Promise<boolean>>();
  private readonly lanes = new Map<string, Promise<void>>();
  private readonly notices = new ToolRate(TOOL_NOTICES_PER_MINUTE);
  private readonly unsubscribe: () => void;
  private readonly lastPrompt = new Map<string, Map<string, Answered>>();

  constructor(
    private readonly session: { store: ObjectStore; read: ReadModels; credentials: Credentials; costs: Costs; display: Pick<ScriptDisplay, 'stale'> },
    private readonly bindings: { lua: () => Promise<LuaRunner>; tools: Binding<ToolUnit, ToolEvent> },
  ) {
    this.unsubscribe = session.store.subscribe(() => {
      for (const [chat, last] of this.lastPrompt) {
        const stored = live(session.store.get('chat', chat));
        if (!stored || session.store.scopeState(chat) === 'unloaded') { this.lastPrompt.delete(chat); continue; }
        const active = new Set(toolsOf(session.store, stored.value).map(({ module, tool }) => `${module}:${tool.file.id}`));
        for (const key of last.keys()) if (!active.has(key)) last.delete(key);
        if (!last.size) this.lastPrompt.delete(chat);
      }
    });
  }

  readonly subscribe = this.changes.subscribe;

  readonly snapshot = () => this.state;

  seen(note: number) {
    this.set({ ...this.state, notes: this.state.notes.filter(({ id }) => id !== note) });
  }

  // null: dismissed, which answers nothing.
  answer(question: number, answer: string | null) {
    this.answers.get(question)?.(answer);
  }

  close() {
    this.closing.abort();
    this.unsubscribe();
    this.lastPrompt.clear();
    for (const { id } of this.state.questions) this.answer(id, null);
  }

  // The bot's scripts on the way to a reply: onInput and editInput for a message being sent, which is then saved here so
  // that what onStart does to the chat lands after it; then onStart. Each may end the turn. again gathers the turn
  // anew once the chat has changed under it: answer, once the user's message is saved and no longer sent.
  async starting(
    chat: string,
    first: TurnContext,
    again: (answer: boolean) => Promise<TurnContext | Blocked | { kind: 'unsent'; failure: ApiFailure } | null>,
    signal: AbortSignal,
  ): Promise<Started> {
    const scripts = triggersOf(packsOf(this.session.store, first.chat));
    if (scripts.length === 0) return { turn: first };
    const halted: Halted = { kind: 'halted' };
    // 멈추기 ends the turn without waiting for a run that may itself be waiting, for a model or for the user. The
    // runs go on to where the user's message is saved, since they may already have written to the chat for it, and
    // no further; without triggers a turn stopped this early hands the text back instead.
    const stopped = new Promise<Halted>((resolve) => signal.addEventListener('abort', () => resolve(halted), { once: true }));
    const started = this.queued(chat, async (): Promise<Started> => {
      let turn = first;
      const regather = async (answer: boolean) => {
        const next = await again(answer);
        const failed = next === null ? ({ kind: 'gone' } as const) : 'kind' in next ? next : null;
        if (next && !('kind' in next)) turn = next;
        return failed && answer ? { ...failed, kept: true as const } : failed;
      };
      const { said } = first;
      if (said) {
        const history = (): ChatScope => ({ ...turn.scope, messages: turn.scope.messages.slice(0, -1) });
        const input = await this.dispatch(chat, { lua: scripts, event: { kind: 'input' } }, history(), null);
        let { stop, writes: before } = input.outcome;
        let text = said.text;
        // A stop ends the turn where it is called: what would have run after it does not, and the message is saved
        // as it stands, with what was written until then.
        if (!stop) {
          if (input.changed) {
            const failed = await regather(false);
            if (failed) return failed;
          }
          const edited = await this.dispatch(chat, { lua: scripts, event: { kind: 'edit', stage: 'editInput', value: text, meta: { index: -1 } } }, { ...history(), pending: before }, null);
          before = [...before, ...edited.outcome.writes];
          if (typeof edited.outcome.value === 'string') text = edited.outcome.value;
          stop = edited.outcome.stop;
        }
        const sent = await appendUserMessage(this.session.store, chat, { ...said, text, ...(before.length > 0 && { before }) });
        if (!sent.ok) return { kind: 'unsent', failure: sent };
        if (stop) return halted;
        const failed = await regather(true);
        if (failed) return failed;
      }
      if (signal.aborted) return halted;
      const start = await this.dispatch(chat, { lua: scripts, event: { kind: 'start' } }, turn.scope, null);
      if (start.outcome.stop) {
        const last = turn.scope.messages.at(-1);
        const saved = last && (await appendScripted(this.session.store, chat, { edits: [], removed: [], added: [], vars: { version: last.id, set: start.outcome.writes } }));
        if (saved && !saved.ok) this.note(chat, { kind: 'unsaved', failure: saved });
        return halted;
      }
      if (start.changed) {
        const failed = await regather(said !== null);
        if (failed) return failed;
      }
      const before = start.outcome.writes;
      return { turn: { ...turn, said: null, scope: { ...turn.scope, pending: before }, reply: { ...turn.reply, ...(before.length > 0 && { before }) } } };
    });
    // A message that could not be saved after the turn was stopped has nobody left to hear of it but the chat.
    void started.then((result) => signal.aborted && 'kind' in result && result.kind === 'unsent' && this.note(chat, { kind: 'unsaved', failure: result.failure }));
    return Promise.race([started, stopped]);
  }

  // A listener's answer that is no list of messages leaves the request as it was built.
  async requesting(chat: string, turn: TurnContext, messages: ChatMessage[]): Promise<{ messages: ChatMessage[]; writes: Writes }> {
    const scripts = scriptsOf(packsOf(this.session.store, turn.chat));
    if (scripts.length === 0) return { messages, writes: [] };
    return this.queued(chat, async () => {
      const { outcome } = await this.dispatch(chat, { lua: scripts, event: { kind: 'edit', stage: 'editRequest', value: messages, meta: {} } }, turn.scope, null);
      if (!outcome.handled) return { messages, writes: outcome.writes };
      const edited = Array.isArray(outcome.value) ? outcome.value.flatMap((message: unknown): ChatMessage[] => {
        if (!isRecord(message) || typeof message.content !== 'string' || (message.role !== 'system' && message.role !== 'user' && message.role !== 'assistant')) return [];
        return [{ role: message.role, content: message.content, ...(message.cache === true && { cache: true }) }];
      }) : messages;
      return { messages: edited, writes: outcome.writes };
    });
  }

  async ending(chat: string, reply: Written): Promise<Written> {
    const stored = this.session.store.get('chat', chat);
    const scripts = stored ? scriptsOf(packsOf(this.session.store, stored.value)) : [];
    if (!stored || scripts.length === 0 || reply.receipt.state === 'failed') return reply;
    return this.queued(chat, async () => {
      const messages = this.session.read.chat(chat).snapshot()?.messages ?? [];
      const at = reply.message === null ? -1 : messages.findIndex((message) => message.id === reply.message);
      const scope = { ...scopeOf(this.session, chat, stored.value, at === -1 ? messages : messages.slice(0, at)), pending: reply.before ?? [] };
      const { outcome } = await this.dispatch(chat, { lua: scripts, event: { kind: 'edit', stage: 'editOutput', value: reply.text, meta: { index: -1 } } }, scope, null);
      const before = [...(reply.before ?? []), ...outcome.writes];
      return { ...reply, text: typeof outcome.value === 'string' ? outcome.value : reply.text, ...(before.length > 0 && { before }) };
    });
  }

  // onOutput, once the reply is saved. What it writes is the reply version's.
  async ended(chat: string, reply: Written): Promise<void> {
    if (reply.receipt.state === 'failed') return;
    await this.now(chat, { kind: 'output' }, (): Anchor => ({ version: reply.id }));
    this.replyTools(chat, reply);
  }

  // What a send now would hold from the chat's tools, by their last answers in this session: the forecast's.
  cachedPrompt(chat: string, turn: Pick<TurnContext, 'scope' | 'memory'>): Pick<PromptInput, 'tools' | 'memory'> {
    const stored = live(this.session.store.get('chat', chat));
    if (!stored) return { tools: [], memory: turn.memory };
    const last = (unit: ToolUnit) => this.lastPrompt.get(chat)?.get(`${unit.module}:${unit.tool.file.id}`);
    const tools = toolsOf(this.session.store, stored.value).flatMap((unit) => {
      const text = last(unit)?.tool;
      return text?.trim() ? [{ module: unit.module, name: unit.tool.manifest.displayName, text }] : [];
    });
    const owner = memoryOwner(this.session.store, stored.value);
    const memory = owner?.kind === 'tool' && last(owner.unit)?.memory;
    return { tools, memory: memory ? this.memoryOf(chat, owner.unit, turn.scope, memory) : turn.memory };
  }

  // Each tool's prompt event, in pack order, under a deadline: its slot text after the history, and for the one holding
  // the memory slot, its memory in the slot's own place (design §6.10).
  async prompting(chat: string, first: TurnContext, again: () => ReturnType<Parameters<Scripts['starting']>[2]>, signal: AbortSignal): Promise<Started & { tools: PromptInput['tools'] }> {
    const units = toolsOf(this.session.store, first.chat);
    if (units.length === 0) return { turn: first, tools: [] };
    const owner = memoryOwner(this.session.store, first.chat);
    const holder = owner?.kind === 'tool' ? owner.unit : null;
    return this.queued(chat, async () => {
      const tools: PromptInput['tools'] = [];
      const writes: Writes = [];
      let turn = first;
      let remembered: Answered['memory'] = null;
      for (const unit of units) {
        if (signal.aborted || this.closing.signal.aborted) break;
        const from = { kind: 'module', id: unit.module } as const;
        const holds = unit.module === holder?.module;
        if (!holds && holder && unit.tool.manifest.uses.includes('memory') && this.session.store.get('module', unit.module)?.value.takesMemory) this.tell(chat, 'memory-held', { kind: 'memory-held', by: holder.tool.manifest.displayName }, from);
        const key = `${unit.module}:${unit.tool.file.id}`;
        const last = this.lastPrompt.get(chat) ?? new Map<string, Answered>();
        this.lastPrompt.set(chat, last);
        const deadline = new AbortController();
        const stop = AbortSignal.any([signal, this.closing.signal, deadline.signal]);
        const timer = setTimeout(() => deadline.abort(new ToolLate()), 5000);
        try {
          const scope = { ...turn.scope, pending: [...(first.scope.pending ?? []), ...writes] };
          const { outcome, changed } = await this.dispatch(chat, { tool: unit, event: { kind: 'prompt', turn: { memory: holds } } }, scope, null, stop, () => clearTimeout(timer));
          writes.push(...outcome.writes);
          if (stop.aborted) {
            // The memory it last gave still stands, as memory changes only at a boundary; recall is of the turn.
            const kept = last.get(key)?.memory ?? null;
            if (holds) remembered = kept;
            if (kept) last.set(key, { tool: '', memory: kept });
            else last.delete(key);
            continue;
          }
          if (changed) {
            const next = await again();
            if (!next) return { kind: 'gone' as const, tools };
            if ('kind' in next) return { ...next, tools };
            turn = next;
          }
          const answer = outcome.value as Hazelle.PromptAnswer | undefined;
          const text = (typeof answer === 'object' && answer !== null ? answer.tool : answer) ?? '';
          const memory = holds && typeof answer === 'object' && answer?.memory ? answer.memory : null;
          if (holds) remembered = memory;
          last.set(key, { tool: text, memory });
          if (text.trim()) tools.push({ module: unit.module, name: unit.tool.manifest.displayName, text });
        } finally { clearTimeout(timer); }
      }
      const memory = holder && remembered ? this.memoryOf(chat, holder, turn.scope, remembered, true) : turn.memory;
      return { tools, turn: { ...turn, memory, scope: { ...turn.scope, pending: [...(first.scope.pending ?? []), ...writes] }, reply: { ...turn.reply, before: [...(first.reply.before ?? []), ...writes] } } };
    });
  }

  // The last message a request always sends as it is (design §6.2), and one the chat does not hold, stand for nothing:
  // the text goes, and no message leaves for it.
  private memoryOf(chat: string, unit: ToolUnit, scope: ChatScope, memory: NonNullable<Answered['memory']>, tell = false): MemoryFill {
    const at = memory.through === null ? -1 : scope.messages.findIndex((message) => message.message === memory.through);
    const through = at === scope.messages.length - 1 ? -1 : at;
    if (tell && memory.through !== null && through === -1) this.tell(chat, 'memory-through', { kind: 'failed', message: 'memory.through names no message before the last' }, { kind: 'module', id: unit.module });
    return { kind: 'tool', name: unit.tool.manifest.displayName, text: memory.text, through };
  }

  // The memory claims of the chat's tools that the user has not answered, each asked once per module (design §6.10).
  claims(chat: string) {
    const { store } = this.session;
    const stored = live(store.get('chat', chat));
    if (!stored || this.closing.signal.aborted) return;
    for (const { module, tool } of toolsOf(store, stored.value)) {
      const key = `memory:${module}`;
      if (!tool.manifest.uses.includes('memory') || store.get('module', module)?.value.takesMemory !== undefined || this.consents.has(key)) continue;
      const deciding = this.ask(chat, { kind: 'memory' }, { kind: 'module', id: module }).then(async (answer) => {
        if (answer === null) return false;
        const saved = await setTakesMemory(store, module, answer === 'yes');
        return saved.ok && answer === 'yes';
      }).finally(() => this.consents.delete(key));
      this.consents.set(key, deciding);
    }
  }

  // A //@menu item: its writes stay with the last message, whichever version it shows.
  menu(chat: string, module: string, item: string): Promise<void> {
    const unit = this.unit(chat, module);
    if (!unit?.tool.manifest.menu.some((each) => each.id === item)) return Promise.resolve();
    return this.lane(chat, unit, async () => {
      const scope = this.scope(chat);
      const last = scope.messages.at(-1)?.id;
      await this.dispatch(chat, { tool: unit, event: { kind: 'menu', item } }, scope, last ? { version: last, stays: true } : null, this.closing.signal);
    });
  }

  // A //@action item pressed on message: its writes stay with that message, whichever version it shows.
  action(chat: string, module: string, item: string, message: string): Promise<void> {
    const unit = this.unit(chat, module);
    if (!unit?.tool.manifest.actions?.some((each) => each.id === item)) return Promise.resolve();
    return this.lane(chat, unit, async () => {
      const scope = this.scope(chat);
      const at = atOf(scope, message);
      if (at) await this.dispatch(chat, { tool: unit, event: { kind: 'action', item, message: at } }, scope, { version: at.version, stays: true }, this.closing.signal);
    });
  }

  // Where message stands in the chat now; null once it is gone. For runtime/message-acts, which reads a deleted message
  // before its deletion.
  at(chat: string, message: string): Hazelle.At | null {
    return live(this.session.store.get('chat', chat)) && atOf(this.scope(chat), message);
  }

  // The user's own change to a message, once saved (runtime/message-acts). What the tools write answering it is the
  // user's act, not a version's: it stays with the last message, so 다시 생성 does not undo it.
  changed(chat: string, change: Hazelle.Change) {
    this.toTools(chat, { kind: 'change', change });
  }

  // chat: the new branch, once saved, with the ids its copies took.
  branched(chat: string, from: Hazelle.Branched) {
    this.toTools(chat, { kind: 'branch', from });
  }

  private toTools(chat: string, event: Extract<ToolEvent, { kind: 'change' | 'branch' }>) {
    const stored = live(this.session.store.get('chat', chat));
    if (!stored || this.closing.signal.aborted) return;
    for (const unit of toolsOf(this.session.store, stored.value)) {
      void this.lane(chat, unit, async () => {
        const scope = this.scope(chat);
        const last = scope.messages.at(-1)?.id;
        await this.dispatch(chat, { tool: unit, event }, scope, last ? { version: last, stays: true } : null, this.closing.signal);
      });
    }
  }

  private unit(chat: string, module: string): ToolUnit | null {
    const stored = live(this.session.store.get('chat', chat));
    return (stored && toolsOf(this.session.store, stored.value).find((unit) => unit.module === module)) ?? null;
  }

  private scope(chat: string): ChatScope {
    return scopeOf(this.session, chat, this.session.store.get('chat', chat)!.value, this.session.store.foldedChat(chat).messages);
  }

  pageContext(chat: string, module: string, signal?: AbortSignal): { scope: ChatScope; host: Host } | null {
    const stored = live(this.session.store.get('chat', chat));
    if (this.closing.signal.aborted || !stored || !toolsOf(this.session.store, stored.value).some((unit) => unit.module === module)) return null;
    const scope = scopeOf(this.session, chat, stored.value, this.session.store.foldedChat(chat).messages);
    return { scope, host: this.host(chat, scope, signal) };
  }

  pageWrite(chat: string, module: string, outcome: ScriptOutcome): Promise<void> {
    return this.queued(chat, async () => {
      const context = this.pageContext(chat, module);
      if (!context) return;
      const last = context.scope.messages.at(-1)?.id;
      await this.event(chat, context.scope, outcome, last ? { version: last, stays: true } : null, { kind: 'module', id: module });
    });
  }

  private replyTools(chat: string, reply: Written) {
    const stored = live(this.session.store.get('chat', chat));
    if (!stored || this.closing.signal.aborted) return;
    const units = toolsOf(this.session.store, stored.value);
    if (!units.length) return;
    const scope = this.scope(chat);
    const at = atOf(scope, reply.message ?? reply.id);
    // The saved reply's snapshot and anchor travel with this job, even if another version is shown before it runs.
    if (at) for (const unit of units) void this.lane(chat, unit, () => this.dispatch(chat, { tool: unit, event: { kind: 'reply', reply: { ...at, version: reply.id } } }, scope, { version: reply.id }, this.closing.signal));
  }

  // One chain per chat and tool, off the send queue: a tool hears reply, change, branch, menu and action in the order
  // they came, and a send never waits for them. Each job runs with the chat held, only while the same tool is on in it,
  // and dismisses the chat's open question first, as a send does.
  private lane(chat: string, unit: ToolUnit, job: () => Promise<unknown>): Promise<void> {
    const { store } = this.session;
    const key = `${chat}:${unit.module}`;
    const lease = store.retainChat(chat);
    const next = (this.lanes.get(key) ?? Promise.resolve()).then(async () => {
      if (await lease.ready || this.closing.signal.aborted) return;
      const stored = live(store.get('chat', chat));
      if (!stored || !toolsOf(store, stored.value).some((current) => current.module === unit.module && current.tool.file.id === unit.tool.file.id)) return;
      for (const { id, chat: asked } of this.state.questions) if (asked === chat) this.answer(id, null);
      await job();
    }).catch((error: unknown) => this.report(chat, error, { kind: 'module', id: unit.module })).finally(() => {
      lease.release();
      if (this.lanes.get(key) === next) this.lanes.delete(key);
    });
    this.lanes.set(key, next);
    return next;
  }

  // A press on a bot's button, whose writes stay with the last message whichever version it shows. false: no script
  // answered it.
  async press(chat: string, button: { trigger: string } | { data: string }): Promise<boolean> {
    const event: Event = 'trigger' in button ? { kind: 'call', name: button.trigger } : { kind: 'button', data: button.data };
    return (await this.now(chat, event, (last) => (last === null ? null : { version: last, stays: true }))) ?? false;
  }

  // null: the chat has no triggers.
  private now(chat: string, event: Event, anchor: (last: string | null) => Anchor | null): Promise<boolean | null> {
    const stored = this.session.store.get('chat', chat);
    const scripts = stored ? triggersOf(packsOf(this.session.store, stored.value)) : [];
    if (!stored || scripts.length === 0) return Promise.resolve(null);
    return this.queued(chat, async () => {
      const scope = scopeOf(this.session, chat, stored.value, this.session.read.chat(chat).snapshot()?.messages ?? []);
      const { outcome } = await this.dispatch(chat, { lua: scripts, event }, scope, anchor(scope.messages.at(-1)?.id ?? null));
      return outcome.handled;
    });
  }

  private async dispatch(chat: string, units: Units, scope: ChatScope, anchor: Anchor | null, signal?: AbortSignal, finished?: () => void) {
    const outcome = await this.run(chat, units, scope, signal).finally(finished);
    return this.event(chat, scope, outcome, anchor, ownerOf(units), units.event.kind === 'reply' ? units.event.reply.version : undefined);
  }

  // anchor: where its writes stand; null leaves them to the caller.
  private async event(chat: string, scope: ChatScope, outcome: ScriptOutcome, anchor: Anchor | null, from: PackOwner | null, reply?: string): Promise<{ outcome: Outcome; changed: boolean }> {
    const greeting = scope.greeting === null ? 0 : 1;
    const current = this.session.read.chat(chat).snapshot()?.messages ?? [];
    const messages = new Map(current.map((message) => [shown(message).id, message]));
    const latest = current.at(-1);
    const stale = reply !== undefined && (!latest || shown(latest).id !== reply);
    // A reply handler may always keep state/storage and edit its own shown reply. Adds and other edits
    // land only while that reply is still the latest shown version; a delayed job cannot rewrite a newer story.
    if (stale && (outcome.added.length || outcome.edits.some(({ index }) => scope.messages[index + greeting]?.id !== reply))) this.tell(chat, 'stale-reply', { kind: 'stale-reply' }, from);
    const at = (index: number) => messages.get(scope.messages[index + greeting]?.id ?? '');
    const edits = outcome.edits.flatMap(({ index, text, wrote }) => {
      const message = at(index);
      return message && (!stale || shown(message).id === reply) ? [{ message, wrote, text }] : [];
    });
    const removed = outcome.removed.flatMap((index) => at(index)?.id ?? []);
    const added = (stale ? [] : outcome.added).map(({ role, text }) => ({ role: role === 'user' ? ('user' as const) : ('assistant' as const), text }));
    const saved = await appendScripted(this.session.store, chat, { edits, removed, added, vars: anchor && { ...anchor, set: outcome.writes } });
    if (!saved.ok) this.note(chat, { kind: 'unsaved', failure: saved }, from);
    if (outcome.tool && from?.kind === 'module' && (outcome.tool.data.length || outcome.tool.badges.length)) {
      // A badge stands on the version shown when it lands. A delayed reply job's badges, as its edits, mark only its reply.
      const badges = outcome.tool.badges.flatMap(({ index, text }) => {
        const message = at(index);
        return message && (!stale || shown(message).id === reply) ? [{ message: message.id, version: shown(message).id, text }] : [];
      });
      const kept = await saveToolChat(this.session.store, from.id, chat, outcome.tool.data, badges);
      if (!kept.ok) this.note(chat, { kind: 'unsaved', failure: kept }, from);
    }
    if (outcome.reload) this.session.display.stale(chat);
    return { outcome, changed: edits.length + removed.length + added.length > 0 };
  }

  // A run that cannot be made (a worker that would not start, a script that held it) leaves the chat as it was.
  private async run(chat: string, units: Units, scope: ChatScope, signal?: AbortSignal): Promise<ScriptOutcome> {
    const { event } = units;
    const nothing = { ...noOutcome(), value: event.kind === 'edit' ? event.value : undefined };
    if (this.closing.signal.aborted || signal?.aborted) return nothing;
    const from = ownerOf(units);
    try {
      const host = this.host(chat, scope, signal, event.kind === 'prompt');
      const running = 'lua' in units
        ? this.bindings.lua().then((runner) => runner.run(chat, units.lua, scope, event, host))
        : this.bindings.tools.run(chat, units.tool, scope, units.event, host, signal);
      let stop = () => {};
      const stopped = new Promise<never>((_, reject) => {
        stop = () => reject(signal?.reason instanceof ToolLate ? signal.reason : new ToolStopped());
        signal?.addEventListener('abort', stop, { once: true });
        if (signal?.aborted) stop();
      });
      const outcome = await Promise.race([running, stopped]).finally(() => signal?.removeEventListener('abort', stop));
      this.report(chat, outcome, from);
      return outcome;
    } catch (error) {
      this.report(chat, error, from);
      return nothing;
    }
  }

  report(chat: string, result: Pick<Outcome, 'errors' | 'missing'> | unknown, from: PackOwner | null = null) {
    if (result instanceof ToolStopped) return;
    if (result instanceof ToolLate) return this.tell(chat, 'late', { kind: 'late' }, from);
    if (result instanceof ToolStuck) return result.disabled ? this.tell(chat, 'disabled', { kind: 'stuck', disabled: true }, from) : this.note(chat, { kind: 'stuck' }, from);
    if (result instanceof LuaStuck || result instanceof EvaluationStuck) return this.note(chat, { kind: 'stuck' }, from);
    if (result instanceof Runaway) return this.tell(chat, 'runaway', { kind: 'runaway' }, from);
    if (result instanceof Error) return this.tell(chat, `failed:${result.message}`, { kind: 'failed', message: result.message }, from);
    const { errors, missing } = result as Pick<Outcome, 'errors' | 'missing'>;
    for (const error of errors) {
      if ('runaway' in error) this.tell(chat, 'runaway', { kind: 'runaway' }, error.from);
      else this.tell(chat, `failed:${error.message}`, { kind: 'failed', message: `${error.script}: ${error.message}` }, error.from);
    }
    if (missing.length > 0) this.tell(chat, `missing:${missing.join()}`, { kind: 'missing', names: missing }, from);
  }

  // deadline: the run answers the prompt event, whose deadline would dismiss a card before anyone read it.
  private host(chat: string, scope: ChatScope, signal?: AbortSignal, deadline = false): Host {
    const either = (callSignal?: AbortSignal) => (callSignal ? AbortSignal.any([...(signal ? [signal] : []), callSignal]) : signal);
    return {
      say: (tone, text, from) => { if (!signal?.aborted) this.note(chat, { kind: 'said', tone, text }, from); },
      ask: (question, from, callSignal) => this.ask(chat, question, from, either(callSignal)),
      model: (role, messages, from, callSignal) => this.model(chat, role, messages, from, deadline, either(callSignal)),
      embed: (texts, as, from, callSignal) => this.embed(chat, texts, as, from, deadline, either(callSignal)),
      tokens: async (text) => {
        const counted = await this.session.store.evaluation.count([text]);
        if ('kind' in counted) throw new Error('tokenizer');
        return counted[0]!;
      },
      lore: async (reserve) => {
        const context = scope.model?.maxContext ?? null;
        const lore = await this.session.store.evaluation.lore({ asker: 'lore', chat }, scope, crypto.randomUUID(), reserve === null || context === null ? Infinity : context - reserve);
        if (!('kind' in lore)) return lore;
        if (lore.kind === 'tokenizer') throw new Error('tokenizer');
        // The script reads none, and the person is told why.
        this.tell(chat, 'runaway', { kind: 'runaway' });
        return [];
      },
    };
  }

  private ask(chat: string, question: ScriptQuestion['question'], from: PackOwner, signal?: AbortSignal): Promise<string | null> {
    if (this.closing.signal.aborted || signal?.aborted) return Promise.resolve(null);
    return new Promise((resolve) => {
      const id = ++this.ids;
      const abort = () => this.answer(id, null);
      signal?.addEventListener('abort', abort, { once: true });
      this.answers.set(id, (answer) => {
        signal?.removeEventListener('abort', abort);
        this.answers.delete(id);
        this.set({ ...this.state, questions: this.state.questions.filter((each) => each.id !== id) });
        resolve(answer);
      });
      this.set({ ...this.state, questions: [...this.state.questions, { id, chat, question, from }] });
    });
  }

  // Whether spender may call models, embeddings included (design §6.8, §6.10): asked once per spender and kept on it.
  // Under a deadline an unanswered one is no, without a card; the next run with time to wait asks.
  private async allowed(chat: string, from: PackOwner, deadline: boolean, signal?: AbortSignal): Promise<boolean> {
    const { store } = this.session;
    const spender = live(store.get(from.kind, from.id));
    if (!spender) return false;
    if (spender.value.botModels !== undefined) return spender.value.botModels;
    if (deadline) return false;
    const key = `${from.kind}:${from.id}`;
    let deciding = this.consents.get(key);
    if (!deciding) {
      deciding = this.ask(chat, { kind: 'model' }, from, signal).then(async (answer) => {
        if (answer === null) return false;
        const saved = await setModels(store, from, answer === 'yes');
        return saved.ok && answer === 'yes';
      }).finally(() => this.consents.delete(key));
      this.consents.set(key, deciding);
    }
    return deciding;
  }

  // A script's own model call (design §6.8, §6.10): only for a spender the user allowed, to the chat's model of the
  // role, with a receipt kept on the last message shown so usage and cost count it. Risu's answer shape stays at the
  // Lua binding. The reason also lets the tool binding answer without parsing text.
  private async model(chat: string, role: Role, messages: ModelMessage[], from: PackOwner, deadline: boolean, signal?: AbortSignal): Promise<ModelResult> {
    const { store, credentials } = this.session;
    const refused = (reason: ModelRefusal, why: string): ModelResult => ({ success: false, reason, result: `Error: ${why}` });
    if (signal?.aborted || this.closing.signal.aborted) return refused('failed', 'stopped');
    const stored = live(store.get('chat', chat));
    if (!stored || !live(store.get(from.kind, from.id))) return refused('failed', 'the chat or spender is gone');
    if (!(await this.allowed(chat, from, deadline, signal))) return refused('not-allowed', 'the user has not allowed this script to call models');
    if (signal?.aborted || !live(store.get(from.kind, from.id))) return refused('failed', 'stopped');

    const route = chatModel(store, stored.value, role);
    const profile = 'kind' in route ? null : modelProfile(store, route.model);
    if ('kind' in route || profile?.kind !== 'profile') {
      this.tell(chat, `no-model:${role}`, { kind: 'no-model', role }, from);
      return refused('no-model', 'no model is set');
    }
    let text = '';
    const call = await pageCall(chat);
    // No marker keeps this call, so no pick-up ever ends it: however it went, it is ended here.
    const answer = await generate({
      credentials,
      connection: route.connection.value,
      model: route.model,
      settings: profile.profile.value.settings,
      messages,
      call,
      signal: signal ? AbortSignal.any([this.closing.signal, signal]) : this.closing.signal,
      onText: (phase, chunk) => void (phase === 'text' && (text += chunk)),
    }).finally(() => endCall(store, call.id));
    if (answer.error?.kind === 'app' && answer.error.code === 'too-many-bot-calls') {
      this.tell(chat, 'flood', { kind: 'flood' }, from);
      return refused('flood', 'too many model calls in a minute');
    }
    await this.keep(chat, receiptOf(callOf(route), answer));
    return answer.state === 'failed' ? refused('failed', answer.error?.kind ?? 'failed') : { success: true, result: text };
  }

  // With the account's 임베딩 모델, under the spender's one answer for model calls.
  private async embed(chat: string, texts: string[], as: EmbedPurpose | null, from: PackOwner, deadline: boolean, signal?: AbortSignal): Promise<EmbedResult> {
    const { store, credentials } = this.session;
    if (signal?.aborted || this.closing.signal.aborted || !live(store.get('chat', chat)) || !live(store.get(from.kind, from.id))) return { ok: false, reason: 'failed' };
    if (!(await this.allowed(chat, from, deadline, signal))) return { ok: false, reason: 'not-allowed' };
    if (signal?.aborted || !live(store.get(from.kind, from.id))) return { ok: false, reason: 'failed' };
    const route = embedModel(store);
    if ('kind' in route) {
      this.tell(chat, 'no-model:embed', { kind: 'no-model', role: 'embed' }, from);
      return { ok: false, reason: 'no-model' };
    }
    const count = async (each: string[]) => {
      const counted = await store.evaluation.count(each);
      if ('kind' in counted) throw new Error('tokenizer');
      return counted;
    };
    const { answer, receipt } = await embedTexts({ credentials, count }, route, texts, as, chat, signal ? AbortSignal.any([this.closing.signal, signal]) : this.closing.signal);
    if (receipt) await this.keep(chat, receipt);
    if (!answer.ok && answer.reason === 'flood') this.tell(chat, 'flood', { kind: 'flood' }, from);
    return answer;
  }

  // On the last message shown, so usage and cost count the call.
  private async keep(chat: string, receipt: Receipt) {
    const last = this.session.read.chat(chat).snapshot()?.messages.at(-1);
    if (!last) return;
    const saved = await appendCall(this.session.store, chat, shown(last).id, receipt);
    if (saved.ok) this.session.costs.settle(chat, receipt);
  }

  // One run at a time per chat, each reading the chat as the one before left it: a write returns before its chat's
  // projection is made again, so each waits for it, and a projection that fails is shown on the chat's scope
  // (ObjectStore.evaluated). A question still open when the next comes is dismissed, so a card the user passed over
  // never holds up a send.
  private queued<T>(chat: string, task: () => Promise<T>): Promise<T> {
    for (const { id, chat: asked } of this.state.questions) if (asked === chat) this.answer(id, null);
    const next = (this.queues.get(chat) ?? Promise.resolve()).then(() => this.session.store.projections.evaluate(chat).catch(evaluationFailure)).then(task);
    this.queues.set(chat, next.catch(() => {}));
    return next;
  }

  private tell(chat: string, key: string, note: Note, from: PackOwner | null = null) {
    key = `${from?.kind}:${from?.id}:${key}`;
    const told = this.told.get(chat) ?? new Set();
    this.told.set(chat, told);
    if (told.has(key)) return;
    told.add(key);
    this.note(chat, note, from);
  }

  private note(chat: string, note: Note, from: PackOwner | null = null) {
    if ((note.kind === 'said' || note.kind === 'failed') && from?.kind === 'module' && this.session.store.get('tool', toolId(from.id)) && !this.notices.take(`${chat}:${from.id}`)) return;
    this.set({ ...this.state, notes: [...this.state.notes, { id: ++this.ids, chat, from, ...note }] });
  }

  private set(state: ScriptsState) {
    this.state = state;
    this.changes.notify();
  }
}
