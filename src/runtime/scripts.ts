import { ChangeSignal } from '../change-signal';
import type { HookLog, HookTrace, SyntaxProblem } from '../engine/lua/run';
import type { Tokens } from './token-calibration';
import { ScriptInteractions } from './script-interactions';
import { ScriptSchedule } from './script-schedule';
import { noOutcome, ToolLate, ToolStopped, until, type Binding, type LuaRunner } from './script-binding';
import { live, type PackOwner } from '../model/library';
import type { ToolUnit } from '../model/tool';
import type { Assembled, MemoryFill, PromptInput } from '../engine/pipeline';
import { saveToolChat, toolsOf } from './tools/store';
import type { Tools } from './tools/facade';
import type { Role } from '../connectors/assignment';
import type { ChatMessage, EmbedPurpose, HttpRequest, InputPicture } from '../connectors/types';
import { isRecord } from '../connectors/values';
import type { EmbedResult, Event, FetchResult, Host, ModelMessage, ModelRefusal, ModelResult, Outcome, Question, ScriptUnit, ToolEvent, ToolReach } from '../engine/script-api';
import type { ChatScope } from '../engine/render';
import { shown, type Writes } from '../model/chat';
import { allWritten, type ApiFailure } from './api';
import { chatModel, embedModel } from './assignment';
import { countTexts, embedTexts } from './embed';
import { memoryFill, memoryOwner } from './memory-read';
import { appendScripted, appendUserMessage, keepCall, type Written } from './chat-log';
import { upsertChatLore } from './lore';
import { retriesOf } from './connections';
import type { Costs } from './cost';
import type { Credentials } from './credential';
import { gather, generate, receiptOf } from './generate';
import type { ScriptOutcome } from './lua/event';
import { modelProfile } from './profiles';
import type { ReadModels } from './read-model';
import type { ScriptDisplay } from './script-display';
import type { RequestLog } from './request-log';
import type { ObjectStore } from './store';
import { callOf, endCall, pageCall } from './streams';
import { relayRaw } from './relay';
import { answerInstructionOf, packsOf, scopeOf } from './chat-context';
import { setBackground } from './characters';
import type { Blocked, Sending, TurnContext } from './turn-context';
import type { HistoryMessage } from '../engine/history';
import type { Chat } from '../model/chat';
import type { EventName } from '../tool-api/protocol';
import type { EvaluatedPrompt } from './evaluation-core';
import { providerFit } from './token-calibration';

export type ScriptLog = { entries: readonly HookLog[]; omitted: number };
// Page memory only; evict by both entry count and serialized characters, since a script controls its text.
export const SCRIPT_LOG_LIMITS = { entries: 100, characters: 256 * 1024 } as const;
const EMPTY_LOG: ScriptLog = { entries: [], omitted: 0 };

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

export type StartStage = 'onInput' | 'editInput' | 'onStart';
type StartSteps<F> = {
  // The turn's scope as it now stands, the message being sent last.
  scope(): ChatScope;
  run(event: Event, scope: ChatScope): Promise<{ outcome: Outcome; changed: boolean }>;
  // The tools' sending, after the Lua's editInput.
  input(text: string, scope: ChatScope): Promise<{ value: string; writes: Writes }>;
  // The chat changed under the turn; answer: once the message being sent is saved.
  changed(answer: boolean): Promise<F | null>;
  send(text: string, before: Writes): Promise<F | null>;
  aborted(): boolean;
};
// stage: null when the turn was stopped from outside before onStart. writes: onStart's, which stand after the last
// message; what onInput and editInput wrote went with the message sent.
type StartEnd = { kind: 'stopped'; stage: StartStage | null; writes: Writes } | { kind: 'started'; writes: Writes };

// The bot's scripts before a request, in their order (design §6.8): onInput and editInput for a message being sent,
// which is then saved, so that what onStart does to the chat lands after it; then onStart. A stop ends them where it
// is called: what would have run after it does not, and the message is saved as it stands, with what was written
// until then. The one order for a send (Scripts.starting) and its rehearsal (Scripts.rehearse).
async function startStages<F>(said: string | null, steps: StartSteps<F>): Promise<F | StartEnd> {
  if (said !== null) {
    const history = (): ChatScope => ({ ...steps.scope(), messages: steps.scope().messages.slice(0, -1) });
    const input = await steps.run({ kind: 'input' }, history());
    let { stop, writes: before } = input.outcome;
    let stage: StartStage = 'onInput';
    let text = said;
    if (!stop) {
      if (input.changed) {
        const failed = await steps.changed(false);
        if (failed) return failed;
      }
      const edited = await steps.run({ kind: 'edit', stage: 'editInput', value: text, meta: { index: -1 } }, { ...history(), pending: before });
      before = [...before, ...edited.outcome.writes];
      if (typeof edited.outcome.value === 'string') text = edited.outcome.value;
      stop = edited.outcome.stop;
      stage = 'editInput';
      if (!stop) {
        const tooled = await steps.input(text, { ...history(), pending: before });
        text = tooled.value;
        before = [...before, ...tooled.writes];
      }
    }
    const failed = await steps.send(text, before);
    if (failed) return failed;
    if (stop) return { kind: 'stopped', stage, writes: [] };
    const moved = await steps.changed(true);
    if (moved) return moved;
  }
  if (steps.aborted()) return { kind: 'stopped', stage: null, writes: [] };
  const start = await steps.run({ kind: 'start' }, steps.scope());
  if (start.outcome.stop) return { kind: 'stopped', stage: 'onStart', writes: start.outcome.writes };
  if (start.changed) {
    const failed = await steps.changed(said !== null);
    if (failed) return failed;
  }
  return { kind: 'started', writes: start.outcome.writes };
}

// A request message with origin, the id of the chat message it renders (Assembled parts).
type Sent = { message: ChatMessage; origin?: string };
const sentOf = ({ messages, parts }: Pick<Assembled, 'messages' | 'parts'>): Sent[] => messages.map((message, at) => {
  const { origin } = parts[at]!;
  return origin === undefined ? { message } : { message, origin };
});

// editRequest reads each message's origin as Risu's memo.
const requestEvent = (sent: Sent[]): Event => ({ kind: 'edit', stage: 'editRequest', value: sent.map(({ message, origin }) => origin === undefined ? message : { ...message, memo: origin }), meta: {} });

// An answered message names its origin under key (the Lua's memo, a tool's message); keeping one it was given keeps
// that message's pictures, which neither reads as text. One that is no message is left out.
function sentBack(sent: Sent[], answered: unknown[], key: 'memo' | 'message'): Sent[] {
  const origins = new Map<string, InputPicture[] | undefined>(sent.flatMap(({ message, origin }) => origin === undefined ? [] : [[origin, message.pictures]]));
  return answered.flatMap((message): Sent[] => {
    if (!isRecord(message) || typeof message.content !== 'string' || (message.role !== 'system' && message.role !== 'user' && message.role !== 'assistant')) return [];
    const origin = typeof message[key] === 'string' && origins.has(message[key]) ? message[key] : undefined;
    const kept = origin === undefined ? undefined : origins.get(origin);
    return [{ message: { role: message.role, content: message.content, ...(message.cache === true && { cache: true }), ...(kept && { pictures: kept }) }, ...(origin !== undefined && { origin }) }];
  });
}

// A listener's answer that is no list of messages leaves the request as it was built.
const requestAnswer = (outcome: Outcome, sent: Sent[]): Sent[] => !outcome.handled || !Array.isArray(outcome.value) ? sent : sentBack(sent, outcome.value, 'memo');

const toolRequest = (sent: Sent[]): Hazelle.RequestMessage[] => sent.map(({ message: { role, content, cache }, origin }) => ({ role, content, ...(origin !== undefined && { message: origin }), ...(cache && { cache }) }));

// What saving a run's changes to the chat (Scripts.event) and gathering it again make of scope: an edited message is
// a staged version keeping what its text wrote, an added one is new and staged, and a lorebook write takes the place
// of the chat's own entries of its name. Writes are the caller's, which knows where each stage's stand.
export function applied(chat: string, scope: ChatScope, { edits, removed, added, lore }: ScriptOutcome): ChatScope {
  if (!edits.length && !removed.length && !added.length && !lore.length) return scope;
  const greeting = scope.greeting === null ? 0 : 1;
  const edited = new Map(edits.map((edit) => [edit.index + greeting, edit]));
  const gone = new Set(removed.map((index) => index + greeting));
  const ahead = (at: number | null) => added.filter(({ before }) => (before === null ? null : before + greeting) === at).map(({ role, text }): HistoryMessage => {
    const id = crypto.randomUUID();
    return { id, message: id, seed: id, role: role === 'user' ? 'user' : 'assistant', text, time: Date.now(), staged: true };
  });
  const messages = [
    ...scope.messages.flatMap((message, at) => {
      const edit = edited.get(at);
      const before = [...(message.before ?? []), ...(edit?.wrote ?? [])];
      const kept = edit ? { ...message, id: crypto.randomUUID(), text: edit.text, staged: true as const, ...(before.length > 0 && { before }) } : message;
      return [...ahead(at), ...(gone.has(at) ? [] : [kept])];
    }),
    ...ahead(null),
  ];
  const written = new Map(lore.map((entry) => [entry.name, entry]));
  const placed = new Set<string>();
  const held = scope.lore.flatMap((entry) => {
    const value = entry.parent === chat ? written.get(entry.value.name) : undefined;
    if (!value) return [entry];
    if (placed.has(value.name)) return [];
    placed.add(value.name);
    return [{ ...entry, value }];
  });
  const fresh = lore.filter(({ name }) => !placed.has(name)).map((value) => ({ id: crypto.randomUUID(), parent: chat, value }));
  const last = held.findLastIndex(({ parent }) => parent === chat) + 1 || held.length;
  return { ...scope, messages, lore: [...held.slice(0, last), ...fresh, ...held.slice(last)] };
}

// What a run that saves nothing heard (Scripts.rehearse, Scripts.trial). asked: each question, dismissed there and
// asked when it runs for real; calls: what is refused there and made for real. loreRanAway: a script read the
// lorebook, whose CBS ran away, and read none of it.
export type Heard = { said: { tone: 'normal' | 'error'; text: string }[]; asked: Question[]; calls: { model: number; embed: number; background: number }; loreRanAway: boolean };

// The pre-send scripts run ahead on a copy (Scripts.rehearse). stopped: the stage that ended the turn, which then sends
// nothing. scope: the chat as onStart leaves it, its writes and then editRequest's pending. input: the message as
// editInput left it, null when unchanged. prompt: the request built after onStart, null when it is the forecast's.
// request: what editRequest answered, null when it left the request as given. changed: the request sent would differ
// from the forecast's.
export type Rehearsal = Heard & {
  trace: HookTrace;
  stopped: StartStage | null;
  scope: ChatScope;
  input: string | null;
  prompt: EvaluatedPrompt | null;
  request: ChatMessage[] | null;
  changed: boolean;
};

// One trigger run alone for one event (Scripts.trial), as 시험해 보기 shows it.
export type Trial = Heard & { outcome: ScriptOutcome };

export const NOT_REHEARSED = 'Error: not called while rehearsing';
const unheard = (): Heard => ({ said: [], asked: [], calls: { model: 0, embed: 0, background: 0 }, loreRanAway: false });

// A tool's answer in a stage a turn or a display waits on (prompt, the edit stages); one that misses it is cut off and
// the turn goes on.
const TOOL_DEADLINE_MS = 5000;

// A step of the tools' chain (Scripts.chained). scope: the chat as the step sees it, after the writes of the tools
// before it. answer: what a tool answered makes of the value, an Error when it cannot. quiet: nothing it does is saved.
type Chained<T> = { event(value: T): ToolEvent; scope(writes: Writes): ChatScope; answer(answered: unknown, value: T): T | Error; quiet?: true };

// The bot's scripts in the life of a chat (design §6.8). The only place that turns what a run did into entries.
export class Scripts {
  private readonly interactions: ScriptInteractions;
  private readonly schedule: ScriptSchedule;
  private readonly closing = new AbortController();
  private readonly unsubscribe: () => void;
  private readonly logs = new Map<string, { snapshot: ScriptLog; sizes: number[]; characters: number }>();
  private readonly logChanges = new Map<string, { changes: ChangeSignal; users: number }>();
  private readonly lastPrompt = new Map<string, Map<string, Answered>>();
  // Presses queued behind an earlier run and not begun, by chat and button.
  private readonly waiting = new Map<string, Promise<boolean>>();

  constructor(
    private readonly session: { store: ObjectStore; read: ReadModels; credentials: Credentials; log: RequestLog; costs: Costs; tokens: Tokens; display: Pick<ScriptDisplay, 'stale'> },
    private readonly bindings: { lua: () => Promise<LuaRunner>; tools: Binding<ToolUnit, ToolEvent, ToolReach> & Pick<Tools, 'items' | 'actions' | 'hears'> },
  ) {
    this.interactions = new ScriptInteractions(session.store, this.closing.signal);
    this.schedule = new ScriptSchedule(session.store, this.interactions, this.closing.signal);
    this.unsubscribe = session.store.subscribe(() => {
      for (const chat of this.logs.keys()) {
        if (!live(session.store.get('chat', chat)) || session.store.scopeState(chat) === 'unloaded') {
          this.logs.delete(chat);
          this.logChanges.get(chat)?.changes.notify();
        }
      }
      for (const [chat, last] of this.lastPrompt) {
        const stored = live(session.store.get('chat', chat));
        if (!stored || session.store.scopeState(chat) === 'unloaded') { this.lastPrompt.delete(chat); continue; }
        const active = new Set(toolsOf(session.store, stored.value).map(({ module, tool }) => `${module}:${tool.file.id}`));
        for (const key of last.keys()) if (!active.has(key)) last.delete(key);
        if (!last.size) this.lastPrompt.delete(chat);
      }
    });
  }

  readonly log = (chat: string): ScriptLog => this.logs.get(chat)?.snapshot ?? EMPTY_LOG;

  readonly subscribeLog = (chat: string, listener: () => void) => {
    const held = this.logChanges.get(chat) ?? { changes: new ChangeSignal(), users: 0 };
    this.logChanges.set(chat, held);
    held.users++;
    const stop = held.changes.subscribe(listener);
    return () => {
      stop();
      if (--held.users === 0) this.logChanges.delete(chat);
    };
  };

  private keepLog(chat: string, entries: readonly HookLog[], dropped = 0) {
    if (!entries.length || this.closing.signal.aborted || this.session.store.scopeState(chat) === 'unloaded') return;
    const held = this.logs.get(chat) ?? { snapshot: EMPTY_LOG, sizes: [], characters: 0 };
    const next = [...held.snapshot.entries];
    let omitted = held.snapshot.omitted + dropped;
    for (const raw of entries) {
      let truncated = raw.truncated;
      const clip = (text: string) => { if (text.length > 1024) truncated = true; return text.slice(0, 1024); };
      const tail = <T>(items: T[]) => { if (items.length > 16) truncated = true; return items.slice(-16); };
      const entry: HookLog = { ...raw, stage: clip(raw.stage), script: clip(raw.script), logs: tail(raw.logs).map(clip), writes: tail(raw.writes).map(([name, value]) => [clip(name), clip(value)]), errors: tail(raw.errors).map((error) => 'message' in error ? { ...error, script: clip(error.script), message: clip(error.message) } : error), missing: tail(raw.missing).map(clip), truncated };
      const size = JSON.stringify(entry).length;
      next.push(entry);
      held.sizes.push(size);
      held.characters += size;
      while (next.length > SCRIPT_LOG_LIMITS.entries || held.characters > SCRIPT_LOG_LIMITS.characters) {
        next.shift();
        held.characters -= held.sizes.shift()!;
        omitted++;
      }
    }
    held.snapshot = { entries: next, omitted };
    this.logs.set(chat, held);
    this.logChanges.get(chat)?.changes.notify();
  }

  readonly subscribe = (listener: () => void) => this.interactions.subscribe(listener);

  readonly snapshot = () => this.interactions.snapshot();

  seen(note: number) { this.interactions.seen(note); }

  answer(question: number, answer: string | null) { this.interactions.answer(question, answer); }

  report(chat: string, result: Pick<Outcome, 'errors' | 'missing'> | unknown, from: PackOwner | null = null) {
    // Event outcomes forward the Lua trace through runEvent's spread; display batches report it directly.
    if (isRecord(result) && 'trace' in result) {
      const trace = result.trace as HookTrace;
      this.keepLog(chat, trace.entries, trace.omitted);
    }
    this.interactions.report(chat, result, from);
  }

  claims(chat: string) { this.interactions.claims(chat); }

  close() {
    this.closing.abort();
    this.unsubscribe();
    this.lastPrompt.clear();
    this.logs.clear();
    for (const { changes } of this.logChanges.values()) { changes.notify(); changes.clear(); }
    this.logChanges.clear();
    this.interactions.close();
  }

  // The bot's scripts on the way to a reply (startStages), each saved as it lands. again gathers the turn anew once the
  // chat has changed under it: answer, once the user's message is saved and no longer sent.
  async starting(
    chat: string,
    first: TurnContext,
    again: (answer: boolean) => Promise<TurnContext | Blocked | { kind: 'unsent'; failure: ApiFailure } | null>,
    signal: AbortSignal,
  ): Promise<Started> {
    const scripts = triggersOf(packsOf(this.session.store, first.chat));
    const units = first.said ? this.listening(first.chat, 'sending') : [];
    if (scripts.length === 0 && units.length === 0) return { turn: first };
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
      const end = await startStages(said?.text ?? null, {
        scope: () => turn.scope,
        run: async (event, scope) => scripts.length ? this.dispatch(chat, { lua: scripts, event }, scope, null) : { outcome: { ...noOutcome(), value: event.kind === 'edit' ? event.value : undefined }, changed: false },
        input: (text, scope) => this.chained(chat, units, text, {
          event: (text) => ({ kind: 'sending', text }),
          scope: (writes) => ({ ...scope, pending: [...(scope.pending ?? []), ...writes] }),
          answer: (answered) => answered as string,
        }),
        changed: regather,
        send: async (text, before) => {
          const sent = await appendUserMessage(this.session.store, chat, { ...said!, text, ...(before.length > 0 && { before }) });
          return sent.ok ? null : ({ kind: 'unsent', failure: sent } as const);
        },
        aborted: () => signal.aborted,
      });
      if (end.kind === 'stopped') {
        const last = turn.scope.messages.at(-1);
        const saved = end.stage === 'onStart' && last && (await appendScripted(this.session.store, chat, { edits: [], removed: [], added: [], vars: { version: last.id, set: end.writes } }));
        if (saved && !saved.ok) this.interactions.note(chat, { kind: 'unsaved', failure: saved });
        return halted;
      }
      if (end.kind !== 'started') return end;
      const before = end.writes;
      return { turn: { ...turn, said: null, scope: { ...turn.scope, pending: before }, reply: { ...turn.reply, ...(before.length > 0 && { before }) } } };
    });
    // A message that could not be saved after the turn was stopped has nobody left to hear of it but the chat.
    void started.then((result) => signal.aborted && 'kind' in result && result.kind === 'unsent' && this.interactions.note(chat, { kind: 'unsaved', failure: result.failure }));
    return Promise.race([started, stopped]);
  }

  // editRequest: the bot's Lua, then each tool's requesting. Only the chat's own requests pass here; a script's or a
  // tool's model call, memory and translation do not.
  async requesting(chat: string, turn: TurnContext, prompt: Pick<Assembled, 'messages' | 'parts'>): Promise<{ messages: ChatMessage[]; writes: Writes }> {
    const scripts = scriptsOf(packsOf(this.session.store, turn.chat));
    const units = this.listening(turn.chat, 'requesting');
    if (scripts.length === 0 && units.length === 0) return { messages: prompt.messages, writes: [] };
    return this.schedule.queued(chat, async () => {
      let sent = sentOf(prompt);
      let writes: Writes = [];
      if (scripts.length) {
        const { outcome } = await this.dispatch(chat, { lua: scripts, event: requestEvent(sent) }, turn.scope, null);
        sent = requestAnswer(outcome, sent);
        writes = outcome.writes;
      }
      const tooled = await this.chained(chat, units, sent, {
        event: (sent) => ({ kind: 'requesting', messages: toolRequest(sent) }),
        scope: (more) => ({ ...turn.scope, pending: [...(turn.scope.pending ?? []), ...writes, ...more] }),
        answer: (answered, sent) => sentBack(sent, answered as unknown[], 'message'),
      });
      return { messages: tooled.value.map(({ message }) => message), writes: [...writes, ...tooled.writes] };
    });
  }

  // The pre-send stages of sending, on Lua engines of their own and off the chat's queue, so a real send never waits
  // behind one; nothing is saved or kept in the page log. Each stage hands the next the chat as the send's would. A
  // question is dismissed and no model is called, so a script that branches on either may go another way when sent.
  // A Lua draft's first syntax error, from the same VM that runs it; unchecked when the worker is gone.
  check(code: string): Promise<SyntaxProblem | null | 'unchecked'> {
    return this.bindings.lua().then((runner) => runner.check(code)).catch(() => 'unchecked' as const);
  }

  // Tools are not rehearsed: their storage writes would be real, so what a tool's sending or requesting does shows only
  // when sent. null: the chat has no triggers.
  async rehearse(chat: string, { turn, prompt, calibration }: Sending, signal: AbortSignal): Promise<Rehearsal | null> {
    const scripts = triggersOf(packsOf(this.session.store, turn.chat));
    if (scripts.length === 0) return null;
    const trace: HookTrace = { entries: [], omitted: 0 };
    const heard = unheard();
    let scope = turn.scope;
    let touched = false;
    let input: string | null = null;
    const run = async (event: Event, at: ChatScope) => {
      const outcome = await until(this.bindings.lua().then((runner) => runner.run(chat, scripts, at, event, this.quiet(chat, at, heard, signal), 'preview', signal)), signal);
      trace.entries.push(...(outcome.trace?.entries ?? []));
      trace.omitted += outcome.trace?.omitted ?? 0;
      const next = applied(chat, at, outcome);
      if (next !== at) {
        touched = true;
        scope = { ...scope, messages: [...next.messages, ...scope.messages.slice(at.messages.length)], lore: next.lore };
      }
      return { outcome, changed: next !== at };
    };
    const end = await startStages<never>(turn.said?.text ?? null, {
      scope: () => scope,
      run,
      input: async (value) => ({ value, writes: [] }),
      changed: async () => null,
      send: async (text, before) => {
        const last = scope.messages.at(-1)!;
        if (text !== last.text) input = text;
        if (text !== last.text || before.length > 0) {
          touched = true;
          scope = { ...scope, messages: [...scope.messages.slice(0, -1), { ...last, text, ...(before.length > 0 && { before }) }] };
        }
        return null;
      },
      aborted: () => signal.aborted,
    });
    if (end.kind === 'stopped' && end.stage === null) throw new ToolStopped();
    if (end.writes.length > 0) {
      touched = true;
      scope = { ...scope, pending: end.writes };
    }
    const rehearsal = () => ({ ...heard, trace, scope, input, prompt: null, request: null, changed: false });
    if (end.kind === 'stopped') return { ...rehearsal(), stopped: end.stage };
    const built = touched ? await this.session.store.evaluation.prompt({ asker: 'view', chat }, { scope, seed: turn.reply.id, budget: turn.budget, fit: providerFit(turn.route, turn.settings, calibration.fit.allowance), ...this.cachedPrompt(chat, { scope, memory: memoryFill(this.session.store, chat, turn.chat, scope.messages) }), continuing: false, answerInstruction: answerInstructionOf(this.session.store) }, signal) : prompt;
    const after = 'kind' in built || JSON.stringify(built.messages) !== JSON.stringify(prompt.messages) ? built : null;
    if ('kind' in built) return { ...rehearsal(), stopped: null, prompt: after, changed: true };
    const edited = await run(requestEvent(sentOf(built)), scope);
    if (edited.outcome.writes.length > 0) scope = { ...scope, pending: [...end.writes, ...edited.outcome.writes] };
    const request = edited.outcome.trace?.entries.some((entry) => entry.changed) ? requestAnswer(edited.outcome, sentOf(built)).map(({ message }) => message) : null;
    return { ...rehearsal(), stopped: null, prompt: after, request, changed: after !== null || request !== null };
  }

  // chat: the one scope is read from, or 'sample'. Each run has an owner of its own, so it starts on fresh Lua globals.
  async trial(chat: string, scope: ChatScope, unit: ScriptUnit, event: Event, signal: AbortSignal): Promise<Trial> {
    const heard = unheard();
    const outcome = await until(this.bindings.lua().then((runner) => runner.run(`trial:${crypto.randomUUID()}`, [unit], scope, event, this.quiet(chat, scope, heard, signal), 'preview', signal)), signal);
    return { ...heard, outcome };
  }

  // A host for a run that saves nothing: each question dismissed, each model, embedding and background call refused.
  private quiet(chat: string, scope: ChatScope, heard: Heard, signal: AbortSignal): Host {
    return {
      ...this.reads(chat, scope, () => { heard.loreRanAway = true; }),
      say: (tone, text) => { if (!signal.aborted) heard.said.push({ tone, text }); },
      ask: async (question) => { if (!signal.aborted) heard.asked.push(question); return null; },
      model: async () => { heard.calls.model++; return { success: false, reason: 'failed', result: NOT_REHEARSED }; },
      embed: async () => { heard.calls.embed++; return { ok: false, reason: 'failed' }; },
      background: async () => { heard.calls.background++; return false; },
    };
  }

  // editOutput: the bot's Lua, then each tool's replying in pack order, each handing the next the text it left.
  async ending(chat: string, reply: Written): Promise<Written> {
    const stored = this.session.store.get('chat', chat);
    const scripts = stored ? scriptsOf(packsOf(this.session.store, stored.value)) : [];
    const units = stored ? this.listening(stored.value, 'replying') : [];
    if (!stored || (scripts.length === 0 && units.length === 0) || reply.receipt.state === 'failed') return reply;
    return this.schedule.queued(chat, async () => {
      const messages = this.session.read.chat(chat).snapshot()?.messages ?? [];
      const at = reply.message === null ? -1 : messages.findIndex((message) => message.id === reply.message);
      const scope = scopeOf(this.session, chat, stored.value, at === -1 ? messages : messages.slice(0, at));
      let text = reply.text;
      let before = reply.before ?? [];
      if (scripts.length) {
        // The reply stands right after the scope, a version made anew or continued at its message's place.
        const index = scope.messages.length - (scope.greeting === null ? 0 : 1);
        const { outcome } = await this.dispatch(chat, { lua: scripts, event: { kind: 'edit', stage: 'editOutput', value: text, meta: { index } } }, { ...scope, pending: before }, null);
        before = [...before, ...outcome.writes];
        if (typeof outcome.value === 'string') text = outcome.value;
      }
      const lua = before;
      const tooled = await this.chained(chat, units, text, {
        event: (text) => ({ kind: 'replying', text }),
        scope: (writes) => ({ ...scope, pending: [...lua, ...writes] }),
        answer: (answered) => answered as string,
      });
      text = tooled.value;
      before = [...before, ...tooled.writes];
      return { ...reply, text, ...(before.length > 0 && { before }) };
    });
  }

  // The chat's tools that may answer showing (ScriptDisplay).
  showers(chat: Chat): ToolUnit[] {
    return this.listening(chat, 'showing');
  }

  // editDisplay's tools, after the bot's Lua, over one stretch of a display pass; nothing they do is saved.
  async showing(chat: string, units: ToolUnit[], scope: ChatScope, items: { version: string; text: string }[]): Promise<string[]> {
    const greeting = scope.greeting === null ? 0 : 1;
    const places = new Map(scope.messages.map((message, at) => [message.id, at]));
    const shown = items.map(({ version, text }): Hazelle.Shown => {
      const at = places.get(version)!;
      return { at: at < greeting ? null : { index: at - greeting, id: scope.messages[at]!.message, version }, text };
    });
    const { value } = await this.chained(chat, units, items.map(({ text }) => text), {
      event: (texts) => ({ kind: 'showing', shown: shown.map((each, at) => ({ ...each, text: texts[at]! })) }),
      scope: () => scope,
      answer: (answered, texts) => (answered as string[]).length === texts.length ? answered as string[] : new Error(`showing answered ${(answered as string[]).length} texts for ${texts.length} messages`),
      quiet: true,
    });
    return value;
  }

  // Each tool in pack order, after the bot's Lua, under the deadline, handed what the one before it left; one that
  // misses the deadline is cut off and the value passes on as it came.
  private async chained<T>(chat: string, units: ToolUnit[], first: T, step: Chained<T>): Promise<{ value: T; writes: Writes }> {
    let value = first;
    let writes: Writes = [];
    for (const unit of units) {
      if (this.closing.signal.aborted) break;
      const deadline = new AbortController();
      const stop = AbortSignal.any([this.closing.signal, deadline.signal]);
      const timer = setTimeout(() => deadline.abort(new ToolLate()), TOOL_DEADLINE_MS);
      try {
        const run = { tool: unit, event: step.event(value) };
        const outcome = step.quiet ? await this.run(chat, run, step.scope(writes), stop).finally(() => clearTimeout(timer)) : (await this.dispatch(chat, run, step.scope(writes), null, stop, () => clearTimeout(timer))).outcome;
        if (stop.aborted) continue;
        writes = [...writes, ...outcome.writes];
        const next = outcome.value === undefined ? value : step.answer(outcome.value, value);
        if (next instanceof Error) this.report(chat, next, { kind: 'module', id: unit.module });
        else value = next;
      } finally { clearTimeout(timer); }
    }
    return { value, writes };
  }

  // A tool whose frame has not loaded yet may listen.
  private listening(chat: Chat, event: EventName): ToolUnit[] {
    return toolsOf(this.session.store, chat).filter(({ module }) => this.bindings.tools.hears(module, event) !== false);
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
        const timer = setTimeout(() => deadline.abort(new ToolLate()), TOOL_DEADLINE_MS);
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
    if (!unit || !this.bindings.tools.items(module).some((each) => each.id === item)) return Promise.resolve();
    return this.schedule.lane(chat, unit, async () => {
      const scope = this.scope(chat);
      await this.dispatch(chat, { tool: unit, event: { kind: 'menu', item } }, scope, onLast(scope), this.closing.signal);
    });
  }

  // A //@action item pressed on message: its writes stay with that message, whichever version it shows.
  action(chat: string, module: string, item: string, message: string): Promise<void> {
    const unit = this.unit(chat, module);
    if (!unit || !this.bindings.tools.actions(module).some((each) => each.id === item)) return Promise.resolve();
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

  pageContext(chat: string, module: string, signal?: AbortSignal): { scope: ChatScope; host: ToolReach } | null {
    if (this.closing.signal.aborted || !this.unit(chat, module)) return null;
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

  // A press on a bot's button, whose writes stay with the last message whichever version it shows. waits: an earlier
  // run holds the chat (an onOutput's model call can take a minute). The same button pressed again before its waiting
  // press begins joins it: a toggle pressed twice would otherwise land as no change. answered false: no script answered.
  press(chat: string, button: { trigger: string; id: string } | { data: string }): { waits: boolean; answered: Promise<boolean> } {
    const key = `${chat}\n${JSON.stringify(button)}`;
    const joined = this.waiting.get(key);
    if (joined) return { waits: true, answered: joined };
    const event: Event = 'trigger' in button ? { kind: 'call', name: button.trigger, id: button.id } : { kind: 'button', data: button.data };
    const waits = this.schedule.busy(chat);
    const begun = () => { if (this.waiting.get(key) === answered) this.waiting.delete(key); };
    const answered: Promise<boolean> = this.now(chat, event, onLast, begun).then((handled) => handled ?? false).finally(begun);
    if (waits) this.waiting.set(key, answered);
    return { waits, answered };
  }

  private now(chat: string, event: Event, anchor: (scope: ChatScope) => Anchor | null, begun?: () => void): Promise<boolean | null> {
    const stored = this.session.store.get('chat', chat);
    const scripts = stored ? triggersOf(packsOf(this.session.store, stored.value)) : [];
    if (!stored || scripts.length === 0) return Promise.resolve(null);
    return this.schedule.queued(chat, async () => {
      begun?.();
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
    const adding = (stale ? [] : outcome.added).map(({ role, text, before }) => ({ role: role === 'user' ? ('user' as const) : ('assistant' as const), text, before }));
    // Each run of adds ahead of one message (or after the last) continues the message before that place.
    const runs = new Map<number | null, typeof adding>();
    for (const item of adding) runs.set(item.before, [...(runs.get(item.before) ?? []), item]);
    const added = [...runs].flatMap(([before, items]) => {
      const ahead = before === null ? null : (at(before) ?? null);
      if (before !== null && !ahead) return [];
      const previous = ahead ? current[current.indexOf(ahead) - 1] : latest;
      return [{ follows: previous ? shown(previous).id : null, ahead, messages: items.map(({ role, text }) => ({ role, text })) }];
    });
    const saved = await appendScripted(this.session.store, chat, { edits, removed, added, vars: anchor && { ...anchor, set: outcome.writes } });
    if (!saved.ok) this.interactions.note(chat, { kind: 'unsaved', failure: saved }, from);
    // State, as variables are, so a stale reply's lands too.
    const lore = await allWritten(outcome.lore.map((entry) => upsertChatLore(this.session.store, chat, entry)));
    if (!lore.ok) this.interactions.note(chat, { kind: 'unsaved', failure: lore }, from);
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
    return { outcome, changed: edits.length + removed.length + adding.length + outcome.lore.length > 0 };
  }

  // A run that cannot be made (a worker that would not start, a script that held it) leaves the chat as it was.
  private async run(chat: string, units: Units, scope: ChatScope, signal?: AbortSignal): Promise<ScriptOutcome> {
    const began = performance.now();
    const at = Date.now();
    const { event } = units;
    const nothing = { ...noOutcome(), value: event.kind === 'edit' ? event.value : undefined };
    if (this.closing.signal.aborted || signal?.aborted) return nothing;
    const from = ownerOf(units);
    try {
      const host = this.host(chat, scope, signal, event.kind === 'prompt');
      const running = 'lua' in units
        ? this.bindings.lua().then((runner) => runner.run(chat, units.lua, scope, event, host, 'event'))
        : this.bindings.tools.run(chat, units.tool, scope, units.event, host, signal);
      const outcome = await until(running, signal);
      this.report(chat, outcome, from);
      // A showing runs once per stretch shown; kept here, it would push the turns' entries out of the log's bound.
      if ('tool' in units && (event.kind !== 'showing' || outcome.errors.length || outcome.missing.length)) this.keepLog(chat, [{ stage: event.kind, pack: from, script: units.tool.tool.manifest.displayName, at, duration: performance.now() - began, logs: [], writes: outcome.writes, errors: outcome.errors, missing: outcome.missing, stopped: outcome.stop, changed: outcome.value !== undefined, handled: outcome.handled, truncated: false }]);
      return outcome;
    } catch (error) {
      this.report(chat, error, from);
      this.keepLog(chat, [{ stage: event.kind === 'edit' ? event.stage : event.kind, pack: from, script: '', at, duration: performance.now() - began, logs: [], writes: [], errors: [{ from, script: '', message: String(error) }], missing: [], stopped: error instanceof ToolStopped, changed: false, handled: false, truncated: false }]);
      return nothing;
    }
  }

  // deadline: the run answers the prompt event, whose deadline would dismiss a card before anyone read it.
  private host(chat: string, scope: ChatScope, signal?: AbortSignal, deadline = false): ToolReach {
    const either = (callSignal?: AbortSignal) => (callSignal ? AbortSignal.any([...(signal ? [signal] : []), callSignal]) : signal);
    return {
      ...this.reads(chat, scope, () => this.interactions.tell(chat, 'runaway', { kind: 'runaway' })),
      say: (tone, text, from) => { if (!signal?.aborted) this.interactions.note(chat, { kind: 'said', tone, text }, from); },
      ask: (question, from, callSignal) => this.interactions.ask(chat, question, from, either(callSignal)),
      model: (role, messages, from, callSignal) => this.model(chat, role, messages, from, deadline, either(callSignal)),
      embed: (texts, as, from, callSignal) => this.embed(chat, texts, as, from, deadline, either(callSignal)),
      background: (html, from, callSignal) => this.background(chat, html, from, deadline, either(callSignal)),
      fetch: (request, module, callSignal) => this.fetch(chat, request, module, deadline, either(callSignal)),
    };
  }

  // What a script reads of the app, acting on nothing. ranAway: the lorebook's CBS ran away, and the script reads none.
  private reads(chat: string, scope: ChatScope, ranAway: () => void): Pick<Host, 'tokens' | 'lore'> {
    return {
      tokens: async (text) => (await countTexts(this.session.store)([text]))[0]!,
      lore: async (reserve) => {
        const context = scope.model?.maxContext ?? null;
        const lore = await this.session.store.evaluation.lore({ asker: 'lore', chat }, scope, crypto.randomUUID(), reserve === null || context === null ? Infinity : context - reserve);
        if (!('kind' in lore)) return lore;
        if (lore.kind === 'tokenizer') throw new Error('tokenizer');
        ranAway();
        return [];
      },
    };
  }

  // A script's own model call (design §6.8, §6.10): only for a spender the user allowed, to the chat's model of the
  // role, with a receipt kept on the last message shown so usage and cost count it. Risu's answer shape stays at the
  // Lua binding. The reason also lets the tool binding answer without parsing text.
  private async model(chat: string, role: Role, messages: ModelMessage[], from: PackOwner, deadline: boolean, signal?: AbortSignal): Promise<ModelResult> {
    const { store, credentials, log } = this.session;
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
    const call = await pageCall(this.session, route, 'script', chat);
    // No marker keeps this call, so no pick-up ever ends it: however it went, it is ended here.
    const answer = await generate({
      credentials,
      log,
      connection: route.connection.value,
      model: route.model,
      settings: profile.profile.value.settings,
      retries: retriesOf(store, route.connection.value, profile.profile.value.settings),
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

  // The chat's character's card, under that character's one answer (design §6.8).
  private async background(chat: string, html: string, from: PackOwner, deadline: boolean, signal?: AbortSignal): Promise<boolean> {
    const { store } = this.session;
    const character = live(store.get('chat', chat))?.value.character ?? null;
    if (character === null || signal?.aborted || !(await this.interactions.mayRewrite(chat, character, from, deadline, signal))) return false;
    if (signal?.aborted) return false;
    return (await setBackground(store, character, html)).ok;
  }

  // A tool's own call out (design §6.10), under its module's one answer, counted against the chat's bot calls as a model
  // call is.
  private async fetch(chat: string, request: HttpRequest, module: string, deadline: boolean, signal?: AbortSignal): Promise<FetchResult> {
    const from = { kind: 'module', id: module } as const;
    if (signal?.aborted || this.closing.signal.aborted || !live(this.session.store.get('chat', chat))) return { ok: false, reason: 'stopped' };
    if (!(await this.interactions.mayFetch(chat, module, deadline, signal))) return { ok: false, reason: 'not-allowed' };
    if (signal?.aborted) return { ok: false, reason: 'stopped' };
    const response = await relayRaw(request, signal ? AbortSignal.any([this.closing.signal, signal]) : this.closing.signal, chat);
    if (response instanceof Response) return { ok: true, response };
    if (response.kind === 'app' && response.code === 'too-many-bot-calls') {
      this.interactions.tell(chat, 'flood', { kind: 'flood' }, from);
      return { ok: false, reason: 'flood' };
    }
    if (response.kind === 'relay' || response.kind === 'app') return { ok: false, reason: 'refused', code: response.code };
    return { ok: false, reason: response.kind === 'stopped' ? 'stopped' : 'offline' };
  }

  // With the account's 임베딩 모델, under the spender's one answer for model calls.
  private async embed(chat: string, texts: string[], as: EmbedPurpose | null, from: PackOwner, deadline: boolean, signal?: AbortSignal): Promise<EmbedResult> {
    const { store, credentials, log } = this.session;
    if (signal?.aborted || this.closing.signal.aborted || !live(store.get('chat', chat)) || !live(store.get(from.kind, from.id))) return { ok: false, reason: 'failed' };
    if (!(await this.interactions.allowed(chat, from, deadline, signal))) return { ok: false, reason: 'not-allowed' };
    if (signal?.aborted || !live(store.get(from.kind, from.id))) return { ok: false, reason: 'failed' };
    const route = embedModel(store);
    if ('kind' in route) {
      this.interactions.tell(chat, 'no-model:embed', { kind: 'no-model', role: 'embed' }, from);
      return { ok: false, reason: 'no-model' };
    }
    const { answer, receipt } = await embedTexts({ credentials, log, count: countTexts(store) }, route, texts, as, chat, signal ? AbortSignal.any([this.closing.signal, signal]) : this.closing.signal);
    if (receipt) await keepCall(this.session, chat, receipt);
    if (!answer.ok && answer.reason === 'flood') this.interactions.tell(chat, 'flood', { kind: 'flood' }, from);
    return answer;
  }
}
