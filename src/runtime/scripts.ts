import { TOGGLE_GLOBAL } from '../engine/cbs/tags';
import type { Card } from '../engine/import/types';
import type { Event, Host, Outcome, Question, Script, Snapshot } from '../engine/lua/run';
import { authorNote, renderChat, type ChatScope } from '../engine/render';
import { shown, type Chat, type Message, type Writes } from '../model/chat';
import type { ApiFailure } from './api';
import { appendScripted, appendUserMessage, type Written } from './chat-log';
import { LuaStuck, type Runner } from './lua/client';
import { chatPrompt } from './prompts';
import type { ReadModels } from './read-model';
import type { ObjectStore } from './store';
import { tokenizer } from './tokenizer';
import { scopeOf, togglesOf, type Blocked, type TurnContext } from './turn';

// What the bot's Lua has for the chat screen. said: the bot's own words (alertNormal, alertError). The others are the
// app's about the bot: a script's error, functions it called that this app does not have, a script that never ended.
type Note = { kind: 'said'; tone: 'normal' | 'error'; text: string } | { kind: 'failed'; message: string } | { kind: 'missing'; names: string[] } | { kind: 'stuck' };
export type ScriptNote = { id: number; chat: string } & Note;
// model: the bot's Lua wants to call a model, which the character has not been allowed or refused yet. Its answer
// 'yes' allows it and 'no' refuses it, both kept on the character; a dismissal leaves it to be asked again.
export type ScriptQuestion = { id: number; chat: string; question: Question | { kind: 'model' } };
export type ScriptsState = { notes: ScriptNote[]; questions: ScriptQuestion[] };

export type Halted = { kind: 'halted' };
// turn: as it goes on. Its said is null once the user's message was saved here.
export type Started = { turn: TurnContext } | Halted | Blocked | { kind: 'gone' } | { kind: 'unsent'; failure: ApiFailure };

// The Lua triggers of a chat's packs, in order: its character's own, until modules join them (design §6.5).
export const scriptsOf = (card: Card | null): Script[] => (card?.triggers ?? []).flatMap((trigger) => (trigger.kind === 'lua' ? [{ name: trigger.name || 'Lua', code: trigger.code }] : []));

type Read = { snapshot: Snapshot; wrote: Writes[]; greeting: number };

// The bot's Lua in the life of a chat (design §6.8): on the way to a reply, when it ends, and on a button. The only
// place that turns what a run did into entries.
export class Scripts {
  private state: ScriptsState = { notes: [], questions: [] };
  private readonly listeners = new Set<() => void>();
  private readonly answers = new Map<number, (answer: string | null) => void>();
  private readonly queues = new Map<string, Promise<unknown>>();
  // What each chat was already told of its bot's errors, so a script failing on every message says so once.
  private readonly told = new Map<string, Set<string>>();
  private runner: Promise<Runner> | null = null;
  private ids = 0;
  private closed = false;

  constructor(
    private readonly session: { store: ObjectStore; read: ReadModels },
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
    this.closed = true;
    for (const { id } of this.state.questions) this.answer(id, null);
  }

  // The bot's Lua on the way to a reply: onInput and editInput for a message being sent, which is then saved here so
  // that what onStart does to the chat lands after it; then onStart, which may end the turn. again gathers the turn
  // anew once the chat has changed under it: answer, once the user's message is saved and no longer sent.
  async starting(
    chat: string,
    first: TurnContext,
    again: (answer: boolean) => TurnContext | Blocked | null,
    signal: AbortSignal,
  ): Promise<Started> {
    const scripts = scriptsOf(first.scope.card);
    if (scripts.length === 0) return { turn: first };
    const halted: Halted = { kind: 'halted' };
    // 멈추기 gives up the wait; a run already made still saves what it did.
    const stopped = new Promise<Halted>((resolve) => signal.addEventListener('abort', () => resolve(halted), { once: true }));
    const started = this.queued(chat, async (): Promise<Started> => {
      if (signal.aborted) return halted;
      let turn = first;
      const regather = (answer: boolean) => {
        const next = again(answer);
        if (next === null) return { kind: 'gone' } as const;
        if (!('kind' in next)) turn = next;
        return 'kind' in next ? next : null;
      };
      const { said } = first;
      if (said) {
        let history: ChatScope = { ...turn.scope, messages: turn.scope.messages.slice(0, -1) };
        const input = await this.event(chat, first.chat, scripts, history, { kind: 'input' }, null);
        if (input.changed) {
          const failed = regather(false);
          if (failed) return failed;
          history = { ...turn.scope, messages: turn.scope.messages.slice(0, -1) };
        }
        const edited = await this.event(chat, first.chat, scripts, { ...history, pending: input.outcome.writes }, { kind: 'edit', stage: 'editInput', value: said.text, meta: { index: -1 } }, null);
        const before = [...input.outcome.writes, ...edited.outcome.writes];
        const text = typeof edited.outcome.value === 'string' ? edited.outcome.value : said.text;
        const sent = await appendUserMessage(this.session.store, chat, { ...said, text, ...(before.length > 0 && { before }) });
        if (!sent.ok) return { kind: 'unsent', failure: sent };
        const failed = regather(true);
        if (failed) return failed;
      }
      const start = await this.event(chat, first.chat, scripts, turn.scope, { kind: 'start' }, null);
      if (start.outcome.stop) {
        const last = turn.scope.messages.at(-1);
        if (last) await appendScripted(this.session.store, chat, { edits: [], removed: [], added: [], vars: { version: last.id, set: start.outcome.writes } });
        return halted;
      }
      if (start.changed) {
        const failed = regather(said !== null);
        if (failed) return failed;
      }
      const before = start.outcome.writes;
      return { turn: { ...turn, said: null, scope: { ...turn.scope, pending: before }, reply: { ...turn.reply, ...(before.length > 0 && { before }) } } };
    });
    return Promise.race([started, stopped]);
  }

  // A reply as its stream ended, after the bot's editOutput listeners, with what they wrote.
  async ending(chat: string, reply: Written): Promise<Written> {
    const stored = this.session.store.get('chat', chat);
    const scripts = stored ? scriptsOf(this.card(stored.value)) : [];
    if (!stored || scripts.length === 0 || reply.receipt.state === 'failed') return reply;
    return this.queued(chat, async () => {
      const messages = this.session.read.chat(chat).snapshot()?.messages ?? [];
      const at = reply.message === null ? -1 : messages.findIndex((message) => message.id === reply.message);
      const scope = { ...scopeOf(this.session, chat, stored.value, at === -1 ? messages : messages.slice(0, at)), pending: reply.before ?? [] };
      const { outcome } = await this.event(chat, stored.value, scripts, scope, { kind: 'edit', stage: 'editOutput', value: reply.text, meta: { index: -1 } }, null);
      const before = [...(reply.before ?? []), ...outcome.writes];
      return { ...reply, text: typeof outcome.value === 'string' ? outcome.value : reply.text, ...(before.length > 0 && { before }) };
    });
  }

  // onOutput, once the reply is saved.
  async ended(chat: string, reply: Written): Promise<void> {
    if (reply.receipt.state !== 'failed') await this.now(chat, { kind: 'output' }, reply.id);
  }

  // A press on a bot's button. false: no script answered it.
  async press(chat: string, button: { trigger: string } | { data: string }): Promise<boolean> {
    return (await this.now(chat, 'trigger' in button ? { kind: 'call', name: button.trigger } : { kind: 'button', data: button.data }, null)) ?? false;
  }

  // An event over the chat as it stands, whose writes stand after anchor, or after the last message shown.
  // null: the chat has no Lua.
  private now(chat: string, event: Event, anchor: string | null): Promise<boolean | null> {
    const stored = this.session.store.get('chat', chat);
    const scripts = stored ? scriptsOf(this.card(stored.value)) : [];
    if (!stored || scripts.length === 0) return Promise.resolve(null);
    return this.queued(chat, async () => {
      const scope = scopeOf(this.session, chat, stored.value, this.session.read.chat(chat).snapshot()?.messages ?? []);
      const { outcome } = await this.event(chat, stored.value, scripts, scope, event, anchor ?? scope.messages.at(-1)?.id ?? null);
      return outcome.handled;
    });
  }

  private card(chat: Chat): Card | null {
    return chat.character === null ? null : (this.session.store.get('character', chat.character)?.value.card ?? null);
  }

  // One run over scope, and what it did to the chat saved. anchor: the version its writes stand after; null leaves
  // them to the caller. changed: it wrote to the chat's messages.
  private async event(chat: string, value: Chat, scripts: Script[], scope: ChatScope, event: Event, anchor: string | null): Promise<{ outcome: Outcome; changed: boolean }> {
    const read = this.reading(value, scope);
    const outcome = await this.run(chat, scripts, read.snapshot, event);
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
    await appendScripted(this.session.store, chat, { edits, removed, added, vars: anchor === null ? null : { version: anchor, set: outcome.writes } });
    return { outcome, changed: edits.length + removed.length + added.length > 0 };
  }

  // The chat as Lua reads it: without its greeting, each message past its input or output stage.
  private reading(chat: Chat, scope: ChatScope): Read {
    const { staged, wrote, variables } = renderChat('prompt', scope);
    const greeting = scope.greeting === null ? 0 : 1;
    const toggles = togglesOf(this.session.store, chat, chatPrompt(this.session.store, chat));
    return {
      wrote,
      greeting,
      snapshot: {
        messages: scope.messages.slice(greeting).map(({ role, time }, index) => ({ role: role === 'user' ? 'user' : 'char', data: staged[index + greeting]!, time: time ?? 0 })),
        variables: [...variables],
        globals: toggles.declared.map(({ key }) => [`${TOGGLE_GLOBAL}${key}`, toggles.value(key) ?? '']),
        character: { name: scope.card?.name ?? '', description: scope.card?.description ?? '', firstMessage: scope.card?.greetings[0] ?? '' },
        persona: { name: scope.persona?.name ?? '', description: scope.persona?.description ?? '' },
        note: scope.prompt ? authorNote(scope.note, scope.prompt) : (scope.note ?? ''),
      },
    };
  }

  // A run that cannot be made (a worker that would not start, a script that held it) leaves the chat as it was.
  private async run(chat: string, scripts: Script[], snapshot: Snapshot, event: Event): Promise<Outcome> {
    const nothing: Outcome = { value: event.kind === 'edit' ? event.value : undefined, stop: false, handled: false, writes: [], edits: [], removed: [], added: [], reload: false, errors: [], missing: [] };
    if (this.closed) return nothing;
    try {
      const runner = await (this.runner ??= this.open());
      const outcome = await runner.run(chat, scripts, snapshot, event, this.host(chat));
      for (const { script, message } of outcome.errors) this.tell(chat, `failed:${message}`, { kind: 'failed', message: `${script}: ${message}` });
      if (outcome.missing.length > 0) this.tell(chat, `missing:${outcome.missing.join()}`, { kind: 'missing', names: outcome.missing });
      return outcome;
    } catch (error) {
      if (error instanceof LuaStuck) this.note(chat, { kind: 'stuck' });
      else this.tell(chat, `failed:${String(error)}`, { kind: 'failed', message: String(error) });
      return nothing;
    }
  }

  private host(chat: string): Host {
    return {
      say: (tone, text) => this.note(chat, { kind: 'said', tone, text }),
      ask: (question) =>
        new Promise((resolve) => {
          const id = ++this.ids;
          this.answers.set(id, (answer) => {
            this.answers.delete(id);
            this.set({ ...this.state, questions: this.state.questions.filter((each) => each.id !== id) });
            resolve(answer);
          });
          this.set({ ...this.state, questions: [...this.state.questions, { id, chat, question }] });
        }),
      model: () => Promise.resolve({ success: false, result: 'Error: model calls are not available' }),
      tokens: (text) => tokenizer().then((count) => count(text)),
    };
  }

  // One run at a time per chat, each reading the chat as the one before left it. A question still open when the next
  // comes is dismissed, so a card the user passed over never holds up a send.
  private queued<T>(chat: string, task: () => Promise<T>): Promise<T> {
    for (const { id, chat: asked } of this.state.questions) if (asked === chat) this.answer(id, null);
    const next = (this.queues.get(chat) ?? Promise.resolve()).then(task);
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
