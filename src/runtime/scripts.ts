import { ScriptInteractions } from './script-interactions';
import { ScriptSchedule } from './script-schedule';
import { noOutcome, ToolLate, ToolStopped, type Binding, type LuaRunner } from './script-binding';
import { live, type PackOwner } from '../model/library';
import type { ToolUnit } from '../model/tool';
import type { MemoryFill, PromptInput } from '../engine/pipeline';
import { saveToolChat, toolsOf } from './tools/store';
import type { Role } from '../connectors/assignment';
import type { ChatMessage, EmbedPurpose } from '../connectors/types';
import { isRecord } from '../connectors/values';
import type { EmbedResult, Event, Host, ModelMessage, ModelRefusal, ModelResult, Outcome, ScriptUnit, ToolEvent } from '../engine/script-api';
import type { ChatScope } from '../engine/render';
import { shown, type Writes } from '../model/chat';
import type { ApiFailure } from './api';
import { chatModel, embedModel } from './assignment';
import { countTexts, embedTexts } from './embed';
import { memoryOwner } from './memory-read';
import { appendScripted, appendUserMessage, keepCall, type Written } from './chat-log';
import type { Costs } from './cost';
import type { Credentials } from './credential';
import { gather, generate } from './generate';
import type { ScriptOutcome } from './lua/event';
import { modelProfile } from './profiles';
import type { ReadModels } from './read-model';
import type { ScriptDisplay } from './script-display';
import type { ObjectStore } from './store';
import { callOf, endCall, pageCall } from './streams';
import { receiptOf } from './talk';
import { packsOf, scopeOf } from './chat-context';
import type { Blocked, TurnContext } from './turn-context';

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

const onLast = (scope: ChatScope): Anchor | null => {
  const last = scope.messages.at(-1)?.id;
  return last ? { version: last, stays: true } : null;
};

// A tool's last prompt answer in this session: its slot text, and its memory with the id it stands through.
type Answered = { tool: string; memory: { text: string; through: string | null } | null };

// The bot's scripts in the life of a chat (design §6.8). The only place that turns what a run did into entries.
export class Scripts {
  private readonly interactions: ScriptInteractions;
  private readonly schedule: ScriptSchedule;
  private readonly closing = new AbortController();
  private readonly unsubscribe: () => void;
  private readonly lastPrompt = new Map<string, Map<string, Answered>>();

  constructor(
    private readonly session: { store: ObjectStore; read: ReadModels; credentials: Credentials; costs: Costs; display: Pick<ScriptDisplay, 'stale'> },
    private readonly bindings: { lua: () => Promise<LuaRunner>; tools: Binding<ToolUnit, ToolEvent> },
  ) {
    this.interactions = new ScriptInteractions(session.store, this.closing.signal);
    this.schedule = new ScriptSchedule(session.store, this.interactions, this.closing.signal);
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

  readonly subscribe = (listener: () => void) => this.interactions.subscribe(listener);

  readonly snapshot = () => this.interactions.snapshot();

  seen(note: number) { this.interactions.seen(note); }

  answer(question: number, answer: string | null) { this.interactions.answer(question, answer); }

  report(chat: string, result: Pick<Outcome, 'errors' | 'missing'> | unknown, from: PackOwner | null = null) {
    this.interactions.report(chat, result, from);
  }

  claims(chat: string) { this.interactions.claims(chat); }

  close() {
    this.closing.abort();
    this.unsubscribe();
    this.lastPrompt.clear();
    this.interactions.close();
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
    const started = this.schedule.queued(chat, async (): Promise<Started> => {
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
        const saved = last && (await appendScripted(this.session.store, chat, { edits: [], removed: [], added: null, vars: { version: last.id, set: start.outcome.writes } }));
        if (saved && !saved.ok) this.interactions.note(chat, { kind: 'unsaved', failure: saved });
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
    void started.then((result) => signal.aborted && 'kind' in result && result.kind === 'unsent' && this.interactions.note(chat, { kind: 'unsaved', failure: result.failure }));
    return Promise.race([started, stopped]);
  }

  // A listener's answer that is no list of messages leaves the request as it was built.
  async requesting(chat: string, turn: TurnContext, messages: ChatMessage[]): Promise<{ messages: ChatMessage[]; writes: Writes }> {
    const scripts = scriptsOf(packsOf(this.session.store, turn.chat));
    if (scripts.length === 0) return { messages, writes: [] };
    return this.schedule.queued(chat, async () => {
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
    return this.schedule.queued(chat, async () => {
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
    return this.schedule.queued(chat, async () => {
      const tools: PromptInput['tools'] = [];
      const writes: Writes = [];
      let turn = first;
      let remembered: Answered['memory'] = null;
      for (const unit of units) {
        if (signal.aborted || this.closing.signal.aborted) break;
        const from = { kind: 'module', id: unit.module } as const;
        const holds = unit.module === holder?.module;
        if (!holds && holder && unit.tool.manifest.uses.includes('memory') && this.session.store.get('module', unit.module)?.value.takesMemory) this.interactions.tell(chat, 'memory-held', { kind: 'memory-held', by: holder.tool.manifest.displayName }, from);
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
    if (tell && memory.through !== null && through === -1) this.interactions.tell(chat, 'memory-through', { kind: 'failed', message: 'memory.through names no message before the last' }, { kind: 'module', id: unit.module });
    return { kind: 'tool', name: unit.tool.manifest.displayName, text: memory.text, through };
  }

  // A //@menu item: its writes stay with the last message, whichever version it shows.
  menu(chat: string, module: string, item: string): Promise<void> {
    const unit = this.unit(chat, module);
    if (!unit?.tool.manifest.menu.some((each) => each.id === item)) return Promise.resolve();
    return this.schedule.lane(chat, unit, async () => {
      const scope = this.scope(chat);
      await this.dispatch(chat, { tool: unit, event: { kind: 'menu', item } }, scope, onLast(scope), this.closing.signal);
    });
  }

  // A //@action item pressed on message: its writes stay with that message, whichever version it shows.
  action(chat: string, module: string, item: string, message: string): Promise<void> {
    const unit = this.unit(chat, module);
    if (!unit?.tool.manifest.actions?.some((each) => each.id === item)) return Promise.resolve();
    return this.schedule.lane(chat, unit, async () => {
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
      void this.schedule.lane(chat, unit, async () => {
        const scope = this.scope(chat);
        await this.dispatch(chat, { tool: unit, event }, scope, onLast(scope), this.closing.signal);
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
    const scope = this.scope(chat);
    return { scope, host: this.host(chat, scope, signal) };
  }

  pageWrite(chat: string, module: string, outcome: ScriptOutcome): Promise<void> {
    return this.schedule.queued(chat, async () => {
      const context = this.pageContext(chat, module);
      if (!context) return;
      await this.event(chat, context.scope, outcome, onLast(context.scope), { kind: 'module', id: module });
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
    if (at) for (const unit of units) void this.schedule.lane(chat, unit, () => this.dispatch(chat, { tool: unit, event: { kind: 'reply', reply: { ...at, version: reply.id } } }, scope, { version: reply.id }, this.closing.signal));
  }

  // A press on a bot's button, whose writes stay with the last message whichever version it shows. false: no script
  // answered it.
  async press(chat: string, button: { trigger: string; id: string } | { data: string }): Promise<boolean> {
    const event: Event = 'trigger' in button ? { kind: 'call', name: button.trigger, id: button.id } : { kind: 'button', data: button.data };
    return (await this.now(chat, event, onLast)) ?? false;
  }

  // null: the chat has no triggers.
  private now(chat: string, event: Event, anchor: (scope: ChatScope) => Anchor | null): Promise<boolean | null> {
    const stored = this.session.store.get('chat', chat);
    const scripts = stored ? triggersOf(packsOf(this.session.store, stored.value)) : [];
    if (!stored || scripts.length === 0) return Promise.resolve(null);
    return this.schedule.queued(chat, async () => {
      const scope = scopeOf(this.session, chat, stored.value, this.session.read.chat(chat).snapshot()?.messages ?? []);
      const { outcome } = await this.dispatch(chat, { lua: scripts, event }, scope, anchor(scope));
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
    if (stale && (outcome.added.length || outcome.edits.some(({ index }) => scope.messages[index + greeting]?.id !== reply))) this.interactions.tell(chat, 'stale-reply', { kind: 'stale-reply' }, from);
    const at = (index: number) => messages.get(scope.messages[index + greeting]?.id ?? '');
    const edits = outcome.edits.flatMap(({ index, text, wrote }) => {
      const message = at(index);
      return message && (!stale || shown(message).id === reply) ? [{ message, wrote, text }] : [];
    });
    const removed = outcome.removed.flatMap((index) => at(index)?.id ?? []);
    const adding = (stale ? [] : outcome.added).map(({ role, text }) => ({ role: role === 'user' ? ('user' as const) : ('assistant' as const), text }));
    const added = adding.length ? { follows: latest ? shown(latest).id : null, messages: adding } : null;
    const saved = await appendScripted(this.session.store, chat, { edits, removed, added, vars: anchor && { ...anchor, set: outcome.writes } });
    if (!saved.ok) this.interactions.note(chat, { kind: 'unsaved', failure: saved }, from);
    if (outcome.tool && from?.kind === 'module' && (outcome.tool.data.length || outcome.tool.badges.length)) {
      // A badge stands on the version shown when it lands. A delayed reply job's badges, as its edits, mark only its reply.
      const badges = outcome.tool.badges.flatMap(({ index, text }) => {
        const message = at(index);
        return message && (!stale || shown(message).id === reply) ? [{ message: message.id, version: shown(message).id, text }] : [];
      });
      const kept = await saveToolChat(this.session.store, from.id, chat, outcome.tool.data, badges);
      if (!kept.ok) this.interactions.note(chat, { kind: 'unsaved', failure: kept }, from);
    }
    if (outcome.reload) this.session.display.stale(chat);
    return { outcome, changed: edits.length + removed.length + adding.length > 0 };
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

  // deadline: the run answers the prompt event, whose deadline would dismiss a card before anyone read it.
  private host(chat: string, scope: ChatScope, signal?: AbortSignal, deadline = false): Host {
    const either = (callSignal?: AbortSignal) => (callSignal ? AbortSignal.any([...(signal ? [signal] : []), callSignal]) : signal);
    return {
      say: (tone, text, from) => { if (!signal?.aborted) this.interactions.note(chat, { kind: 'said', tone, text }, from); },
      ask: (question, from, callSignal) => this.interactions.ask(chat, question, from, either(callSignal)),
      model: (role, messages, from, callSignal) => this.model(chat, role, messages, from, deadline, either(callSignal)),
      embed: (texts, as, from, callSignal) => this.embed(chat, texts, as, from, deadline, either(callSignal)),
      tokens: async (text) => (await countTexts(this.session.store)([text]))[0]!,
      lore: async (reserve) => {
        const context = scope.model?.maxContext ?? null;
        const lore = await this.session.store.evaluation.lore({ asker: 'lore', chat }, scope, crypto.randomUUID(), reserve === null || context === null ? Infinity : context - reserve);
        if (!('kind' in lore)) return lore;
        if (lore.kind === 'tokenizer') throw new Error('tokenizer');
        // The script reads none, and the person is told why.
        this.interactions.tell(chat, 'runaway', { kind: 'runaway' });
        return [];
      },
    };
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
    if (!(await this.interactions.allowed(chat, from, deadline, signal))) return refused('not-allowed', 'the user has not allowed this script to call models');
    if (signal?.aborted || !live(store.get(from.kind, from.id))) return refused('failed', 'stopped');

    const route = chatModel(store, stored.value, role);
    const profile = 'kind' in route ? null : modelProfile(store, route.model);
    if ('kind' in route || profile?.kind !== 'profile') {
      this.interactions.tell(chat, `no-model:${role}`, { kind: 'no-model', role }, from);
      return refused('no-model', 'no model is set');
    }
    const text = gather();
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
      onText: text.add,
    }).finally(() => endCall(store, call.id));
    if (answer.error?.kind === 'app' && answer.error.code === 'too-many-bot-calls') {
      this.interactions.tell(chat, 'flood', { kind: 'flood' }, from);
      return refused('flood', 'too many model calls in a minute');
    }
    await keepCall(this.session, chat, receiptOf(callOf(route), answer));
    return answer.state === 'failed' ? refused('failed', answer.error?.kind ?? 'failed') : { success: true, result: text.value() };
  }

  // With the account's 임베딩 모델, under the spender's one answer for model calls.
  private async embed(chat: string, texts: string[], as: EmbedPurpose | null, from: PackOwner, deadline: boolean, signal?: AbortSignal): Promise<EmbedResult> {
    const { store, credentials } = this.session;
    if (signal?.aborted || this.closing.signal.aborted || !live(store.get('chat', chat)) || !live(store.get(from.kind, from.id))) return { ok: false, reason: 'failed' };
    if (!(await this.interactions.allowed(chat, from, deadline, signal))) return { ok: false, reason: 'not-allowed' };
    if (signal?.aborted || !live(store.get(from.kind, from.id))) return { ok: false, reason: 'failed' };
    const route = embedModel(store);
    if ('kind' in route) {
      this.interactions.tell(chat, 'no-model:embed', { kind: 'no-model', role: 'embed' }, from);
      return { ok: false, reason: 'no-model' };
    }
    const { answer, receipt } = await embedTexts({ credentials, count: countTexts(store) }, route, texts, as, chat, signal ? AbortSignal.any([this.closing.signal, signal]) : this.closing.signal);
    if (receipt) await keepCall(this.session, chat, receipt);
    if (!answer.ok && answer.reason === 'flood') this.interactions.tell(chat, 'flood', { kind: 'flood' }, from);
    return answer;
  }
}
