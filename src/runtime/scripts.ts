import { Runaway } from '../engine/cbs/evaluate';
import { TOGGLE_GLOBAL } from '../engine/cbs/tags';
import type { Pack, Trigger } from '../engine/import/types';
import type { Role } from '../connectors/assignment';
import type { ChatMessage } from '../connectors/types';
import { isRecord } from '../connectors/values';
import type { Event, Outcome, Script } from '../engine/lua/run';
import type { Host, ModelMessage, Question, Snapshot } from '../engine/lua/state';
import { authorNote, renderChat, type ChatScope } from '../engine/render';
import { shown, type Chat, type Message, type Writes } from '../model/chat';
import type { ApiFailure } from './api';
import { chatModel } from './assignment';
import { setBotModels } from './characters';
import { appendCall, appendScripted, appendUserMessage, type Written } from './chat-log';
import type { Costs } from './cost';
import type { Credentials } from './credential';
import { evaluationFailure } from './evaluation';
import { generate } from './generate';
import { luaSnapshot, type LuaStanding } from './lua/snapshot';
import { LuaStuck, type Runner } from './lua/client';
import { modelProfile } from './profiles';
import type { ReadModels } from './read-model';
import type { ScriptDisplay } from './script-display';
import type { ObjectStore } from './store';
import { botCall, callOf, endCall } from './streams';
import { receiptOf } from './talk';
import { packsOf, scopeOf, type Blocked, type TurnContext } from './turn';

// What the bot's scripts have for the chat screen. said: the bot's own words (alertNormal, alertError, showAlert). The
// others are the app's about the bot: a script's error, the functions it called and the block effects it holds that
// this app does not have, a script that never ended.
// no-model: the bot called a model of a role the chat has none for. no-character: a module called one in a chat with
// no character, where there is nobody to allow it for. flood: it called models faster than the server lets a chat's bot
// (server/streams).
// unsaved: what a run did to the chat could not be saved. runaway: the bot's commands were stopped for making too much
// text.
type Note =
  | { kind: 'said'; tone: 'normal' | 'error'; text: string }
  | { kind: 'failed'; message: string }
  | { kind: 'missing'; names: string[] }
  | { kind: 'stuck' }
  | { kind: 'no-model'; role: Role }
  | { kind: 'no-character' }
  | { kind: 'flood' }
  | { kind: 'unsaved'; failure: ApiFailure }
  | { kind: 'runaway' };
export type ScriptNote = { id: number; chat: string } & Note;
// model: the bot's Lua wants to call a model, which the character has not been allowed or refused yet. Its answer
// 'yes' allows it and 'no' refuses it, both kept on the character; a dismissal leaves it to be asked again.
export type ScriptQuestion = { id: number; chat: string; question: Question | { kind: 'model' } };
export type ScriptsState = { notes: ScriptNote[]; questions: ScriptQuestion[] };

export type Halted = { kind: 'halted' };
// turn: as it goes on. Its said is null once the user's message was saved here; a failure after that is kept
// (runtime/turn TurnFailure).
export type Started = { turn: TurnContext } | Halted | ((Blocked | { kind: 'gone' } | { kind: 'unsent'; failure: ApiFailure }) & { kept?: true });

// The triggers of a chat's packs, in the packs' order (design §6.5), which is the order a run walks them in. A block
// trigger keeps its name as written, since a press finds it by that.
export const triggersOf = (packs: readonly Pack[]): Trigger[] => packs.flatMap(({ triggers }) => triggers).map((trigger) => (trigger.kind === 'lua' ? { ...trigger, name: trigger.name || 'Lua' } : trigger));
// The Lua among them, which alone listen for edits and call models.
export const scriptsOf = (packs: readonly Pack[]): Script[] => triggersOf(packs).filter((trigger) => trigger.kind === 'lua');

type Read = { snapshot: Snapshot; wrote: Writes[]; greeting: number };
type Anchor = { version: string; stays?: true };

export function luaStanding(scope: ChatScope): LuaStanding {
  return {
    globals: [...scope.toggles].map(([key, value]) => [`${TOGGLE_GLOBAL}${key}`, value ?? '']),
    character: { name: scope.card?.name ?? '', description: scope.card?.description ?? '', firstMessage: scope.card?.greetings[0] ?? '' },
    persona: { name: scope.persona?.name ?? '', description: scope.persona?.description ?? '' },
    note: scope.prompt ? authorNote(scope.note, scope.prompt) : (scope.note ?? ''),
  };
}

// The bot's scripts, Lua and block triggers, in the life of a chat (design §6.8): on the way to a reply, when it ends,
// and on a button. The only place that turns what a run did into entries.
export class Scripts {
  private state: ScriptsState = { notes: [], questions: [] };
  private readonly listeners = new Set<() => void>();
  private readonly answers = new Map<number, (answer: string | null) => void>();
  private readonly queues = new Map<string, Promise<unknown>>();
  // What each chat was already told of its bot's errors, so a script failing on every message says so once.
  private readonly told = new Map<string, Set<string>>();
  private readonly closing = new AbortController();
  private ids = 0;

  constructor(
    private readonly session: { store: ObjectStore; read: ReadModels; credentials: Credentials; costs: Costs; display: Pick<ScriptDisplay, 'stale'> },
    private readonly open: () => Promise<Runner>,
  ) {}

  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

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
    const scripts = triggersOf(first.scope.packs);
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
        const input = await this.event(chat, scripts, history(), { kind: 'input' }, null);
        let { stop, writes: before } = input.outcome;
        let text = said.text;
        // A stop ends the turn where it is called: what would have run after it does not, and the message is saved
        // as it stands, with what was written until then.
        if (!stop) {
          if (input.changed) {
            const failed = await regather(false);
            if (failed) return failed;
          }
          const edited = await this.event(chat, scripts, { ...history(), pending: before }, { kind: 'edit', stage: 'editInput', value: text, meta: { index: -1 } }, null);
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
      const start = await this.event(chat, scripts, turn.scope, { kind: 'start' }, null);
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

  // The request's messages after the bot's editRequest listeners, with what they wrote. A listener's answer that is
  // no list of messages leaves the request as it was built.
  async requesting(chat: string, turn: TurnContext, messages: ChatMessage[]): Promise<{ messages: ChatMessage[]; writes: Writes }> {
    const scripts = scriptsOf(turn.scope.packs);
    if (scripts.length === 0) return { messages, writes: [] };
    return this.queued(chat, async () => {
      const { outcome } = await this.event(chat, scripts, turn.scope, { kind: 'edit', stage: 'editRequest', value: messages, meta: {} }, null);
      if (!outcome.handled) return { messages, writes: outcome.writes };
      const edited = Array.isArray(outcome.value) ? outcome.value.flatMap((message: unknown): ChatMessage[] => {
        if (!isRecord(message) || typeof message.content !== 'string' || (message.role !== 'system' && message.role !== 'user' && message.role !== 'assistant')) return [];
        return [{ role: message.role, content: message.content, ...(message.cache === true && { cache: true }) }];
      }) : messages;
      return { messages: edited, writes: outcome.writes };
    });
  }

  // A reply as its stream ended, after the bot's editOutput listeners, with what they wrote.
  async ending(chat: string, reply: Written): Promise<Written> {
    const stored = this.session.store.get('chat', chat);
    const scripts = stored ? scriptsOf(this.packs(stored.value)) : [];
    if (!stored || scripts.length === 0 || reply.receipt.state === 'failed') return reply;
    return this.queued(chat, async () => {
      const messages = this.session.read.chat(chat).snapshot()?.messages ?? [];
      const at = reply.message === null ? -1 : messages.findIndex((message) => message.id === reply.message);
      const scope = { ...scopeOf(this.session, chat, stored.value, at === -1 ? messages : messages.slice(0, at)), pending: reply.before ?? [] };
      const { outcome } = await this.event(chat, scripts, scope, { kind: 'edit', stage: 'editOutput', value: reply.text, meta: { index: -1 } }, null);
      const before = [...(reply.before ?? []), ...outcome.writes];
      return { ...reply, text: typeof outcome.value === 'string' ? outcome.value : reply.text, ...(before.length > 0 && { before }) };
    });
  }

  // onOutput, once the reply is saved. What it writes is the reply version's.
  async ended(chat: string, reply: Written): Promise<void> {
    if (reply.receipt.state !== 'failed') await this.now(chat, { kind: 'output' }, (): Anchor => ({ version: reply.id }));
  }

  // A press on a bot's button, whose writes stay with the last message whichever version it shows. false: no script
  // answered it.
  async press(chat: string, button: { trigger: string } | { data: string }): Promise<boolean> {
    const event: Event = 'trigger' in button ? { kind: 'call', name: button.trigger } : { kind: 'button', data: button.data };
    return (await this.now(chat, event, (last) => (last === null ? null : { version: last, stays: true }))) ?? false;
  }

  // An event over the chat as it stands. anchor: where its writes stand, given the last version shown.
  // null: the chat has no triggers.
  private now(chat: string, event: Event, anchor: (last: string | null) => Anchor | null): Promise<boolean | null> {
    const stored = this.session.store.get('chat', chat);
    const scripts = stored ? triggersOf(this.packs(stored.value)) : [];
    if (!stored || scripts.length === 0) return Promise.resolve(null);
    return this.queued(chat, async () => {
      const scope = scopeOf(this.session, chat, stored.value, this.session.read.chat(chat).snapshot()?.messages ?? []);
      const { outcome } = await this.event(chat, scripts, scope, event, anchor(scope.messages.at(-1)?.id ?? null));
      return outcome.handled;
    });
  }

  private packs(chat: Chat): Pack[] {
    return packsOf(this.session.store, chat).map(({ pack }) => pack);
  }

  // One run over scope, and what it did to the chat saved. anchor: where its writes stand; null leaves them to the
  // caller. changed: it wrote to the chat's messages.
  private async event(chat: string, scripts: Trigger[], scope: ChatScope, event: Event, anchor: Anchor | null): Promise<{ outcome: Outcome; changed: boolean }> {
    const read = this.reading(scope);
    const outcome = await this.run(chat, scripts, scope, read.snapshot, event);
    const messages = new Map((this.session.read.chat(chat).snapshot()?.messages ?? []).map((message) => [shown(message).id, message]));
    const at = (index: number): { message: Message; wrote: Writes } | null => {
      const message = messages.get(scope.messages[index + read.greeting]?.id ?? '');
      return message ? { message, wrote: read.wrote[index + read.greeting]! } : null;
    };
    const edits = outcome.edits.flatMap(({ index, text }) => {
      const found = at(index);
      return found ? [{ ...found, text }] : [];
    });
    const removed = outcome.removed.flatMap((index) => at(index)?.message.id ?? []);
    const added = outcome.added.map(({ role, text }) => ({ role: role === 'user' ? ('user' as const) : ('assistant' as const), text }));
    const saved = await appendScripted(this.session.store, chat, { edits, removed, added, vars: anchor && { ...anchor, set: outcome.writes } });
    if (!saved.ok) this.note(chat, { kind: 'unsaved', failure: saved });
    if (outcome.reload) this.session.display.stale(chat);
    return { outcome, changed: edits.length + removed.length + added.length > 0 };
  }

  private reading(scope: ChatScope): Read {
    const { staged, wrote, variables } = renderChat('prompt', scope);
    return { wrote, greeting: scope.greeting === null ? 0 : 1, snapshot: luaSnapshot(scope, luaStanding(scope), staged, [...variables]) };
  }

  // A run that cannot be made (a worker that would not start, a script that held it) leaves the chat as it was.
  private async run(chat: string, scripts: Trigger[], scope: ChatScope, snapshot: Snapshot, event: Event): Promise<Outcome> {
    const nothing: Outcome = { value: event.kind === 'edit' ? event.value : undefined, stop: false, handled: false, writes: [], edits: [], removed: [], added: [], reload: false, errors: [], missing: [] };
    if (this.closing.signal.aborted) return nothing;
    try {
      const runner = await this.open();
      const outcome = await runner.run(chat, scripts, snapshot, event, this.host(chat, scope));
      this.report(chat, outcome);
      return outcome;
    } catch (error) {
      this.report(chat, error);
      return nothing;
    }
  }

  // What a run or a display pass has to say of the bot's scripts: their errors and the functions this app lacks, or
  // the error the run itself ended on. Or commands that ran away: a display's, or those a script evaluated.
  report(chat: string, result: Pick<Outcome, 'errors' | 'missing'> | unknown) {
    if (result instanceof LuaStuck) return this.note(chat, { kind: 'stuck' });
    if (result instanceof Runaway) return this.tell(chat, 'runaway', { kind: 'runaway' });
    if (result instanceof Error) return this.tell(chat, `failed:${result.message}`, { kind: 'failed', message: result.message });
    const { errors, missing } = result as Pick<Outcome, 'errors' | 'missing'>;
    for (const error of errors) {
      if ('runaway' in error) this.tell(chat, 'runaway', { kind: 'runaway' });
      else this.tell(chat, `failed:${error.message}`, { kind: 'failed', message: `${error.script}: ${error.message}` });
    }
    if (missing.length > 0) this.tell(chat, `missing:${missing.join()}`, { kind: 'missing', names: missing });
  }

  private host(chat: string, scope: ChatScope): Host {
    return {
      say: (tone, text) => this.note(chat, { kind: 'said', tone, text }),
      ask: (question) => this.ask(chat, question),
      model: (role, messages) => this.model(chat, role, messages),
      tokens: async (text) => {
        const counted = await this.session.store.evaluation.count([text]);
        if ('kind' in counted) throw new Error('tokenizer');
        return counted[0]!;
      },
      lore: async (reserve) => {
        const context = scope.model?.maxContext ?? null;
        const lore = await this.session.store.evaluation.lore(scope, crypto.randomUUID(), reserve === null || context === null ? Infinity : context - reserve);
        if (!('kind' in lore)) return lore;
        if (lore.kind === 'tokenizer') throw new Error('tokenizer');
        // The script reads none, and the person is told why.
        this.tell(chat, 'runaway', { kind: 'runaway' });
        return [];
      },
    };
  }

  private ask(chat: string, question: ScriptQuestion['question']): Promise<string | null> {
    return new Promise((resolve) => {
      const id = ++this.ids;
      this.answers.set(id, (answer) => {
        this.answers.delete(id);
        this.set({ ...this.state, questions: this.state.questions.filter((each) => each.id !== id) });
        resolve(answer);
      });
      this.set({ ...this.state, questions: [...this.state.questions, { id, chat, question }] });
    });
  }

  // The bot's own model call (design §6.8): only for a character the user allowed, to the chat's model of the role,
  // with a receipt kept on the last message shown so usage and cost count it. The answer is Risu's shape, which the
  // script reads: success, and the text or why not.
  private async model(chat: string, role: Role, messages: ModelMessage[]): Promise<{ success: boolean; result: string }> {
    const { store, credentials, costs } = this.session;
    const refused = (why: string) => ({ success: false, result: `Error: ${why}` });
    const stored = store.get('chat', chat);
    if (stored && stored.value.character === null) {
      this.tell(chat, 'no-character', { kind: 'no-character' });
      return refused('a chat with no character cannot call models');
    }
    const character = stored?.value.character ? store.get('character', stored.value.character) : null;
    if (!stored || !character) return refused('the chat is gone');
    let allowed = character.value.botModels;
    if (allowed === undefined) {
      const answer = await this.ask(chat, { kind: 'model' });
      if (answer !== null) await setBotModels(store, character.id, answer === 'yes');
      allowed = answer === 'yes';
    }
    if (!allowed) return refused('the user has not allowed this bot to call models');

    const route = chatModel(store, stored.value, role);
    const profile = 'kind' in route ? null : modelProfile(store, route.model);
    if ('kind' in route || profile?.kind !== 'profile') {
      this.tell(chat, `no-model:${role}`, { kind: 'no-model', role });
      return refused('no model is set');
    }
    let text = '';
    const call = await botCall(chat);
    // No marker keeps this call, so no pick-up ever ends it: however it went, it is ended here.
    const answer = await generate({
      credentials,
      connection: route.connection.value,
      model: route.model,
      settings: profile.profile.value.settings,
      messages,
      call,
      signal: this.closing.signal,
      onText: (phase, chunk) => void (phase === 'text' && (text += chunk)),
    }).finally(() => endCall(store, call.id));
    if (answer.error?.kind === 'app' && answer.error.code === 'too-many-bot-calls') {
      this.tell(chat, 'flood', { kind: 'flood' });
      return refused('too many model calls in a minute');
    }
    const receipt = receiptOf(callOf(route), answer);
    const last = this.session.read.chat(chat).snapshot()?.messages.at(-1);
    if (last) {
      const saved = await appendCall(store, chat, shown(last).id, receipt);
      if (saved.ok) costs.settle(chat, receipt);
    }
    return answer.state === 'failed' ? refused(answer.error?.kind ?? 'failed') : { success: true, result: text };
  }

  // One run at a time per chat, each reading the chat as the one before left it: a write returns before its chat's
  // projection is made again, so each waits for it, and a projection that fails is shown on the chat's scope
  // (ObjectStore.evaluated). A question still open when the next comes is dismissed, so a card the user passed over
  // never holds up a send.
  private queued<T>(chat: string, task: () => Promise<T>): Promise<T> {
    for (const { id, chat: asked } of this.state.questions) if (asked === chat) this.answer(id, null);
    const next = (this.queues.get(chat) ?? Promise.resolve()).then(() => this.session.store.evaluated(chat).catch(evaluationFailure)).then(task);
    this.queues.set(chat, next.catch(() => {}));
    return next;
  }

  private tell(chat: string, key: string, note: Note) {
    const told = this.told.get(chat) ?? new Set();
    this.told.set(chat, told);
    if (told.has(key)) return;
    told.add(key);
    this.note(chat, note);
  }

  private note(chat: string, note: Note) {
    this.set({ ...this.state, notes: [...this.state.notes, { id: ++this.ids, chat, ...note }] });
  }

  private set(state: ScriptsState) {
    this.state = state;
    for (const listener of this.listeners) listener();
  }
}
