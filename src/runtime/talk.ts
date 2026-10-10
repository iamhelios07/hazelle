import { ChangeSignal } from '../change-signal';
import type { ModelSettings } from '../connectors/settings';
import type { InlineThoughts } from '../connectors/stream';
import type { Phase } from '../connectors/types';
import type { Assembled } from '../engine/pipeline';
import type { Message, Receipt, ReceiptError, Writes } from '../model/chat';
import type { Stored } from '../model/kinds';
import type { Stream } from '../model/stream';
import type { ApiFailure } from './api';
import type { Route, RouteFailure } from './assignment';
import { appendReply, appendUserMessage, savedElsewhere, type Said, type Written } from './chat-log';
import type { Costs } from './cost';
import type { Credentials } from './credential';
import { generate, resume, type Reply } from './generate';
import { stopStream } from './relay';
import type { ObjectStore } from './store';
import type { ChatLease } from './chat-scope';
import { callOf, endCall, newCall } from './streams';

// A continuation's text and reasoning start as those it continues. before:
// what the bot's Lua wrote before the reply was made (model/chat Entry).
export type Turn = {
  chat: string;
  said: Said | null;
  reply: { id: string; message: string | null; replaces: string | null; continues: { text: string; receipt: Receipt; seed: string; reasoning?: string } | null; before?: Writes };
  text: string;
  reasoning: string;
  // whole: asked for in one piece (ModelSettings streaming), so it is shown when it lands, not paced as bursts are.
  whole?: true;
};

// unstored: the user's message shown before the store has it. Nothing may be saved against it yet: fold skips, for
// good, an entry that names a message saved after it.
export type Shown = Message & { live: string | null; whole?: true; unstored?: true };

// The prompt, which the reply's id seeds. settings: the model's 설정 묶음 as stored, which the request fits to the model.
// said: the user's message as it is saved, which a message sent translated saves translated; null when prepare saved it
// itself.
export type Ask = { route: Route; settings: ModelSettings; prompt: Assembled; said: Said | null; before?: Writes };

// It lives in page memory only, until the session closes: the raw request is never stored.
export type Sent = Pick<Reply, 'request' | 'cache'> & { prompt: Assembled };

// unsent: the user's message was not saved, so its reply was stopped. unsaved: the reply was written
// but not saved; saveAgain(reply) tries it again. reply null: a restore ended the turn, and nothing is kept to save.
export type TalkFailure = RouteFailure | { kind: 'unsent'; failure: ApiFailure } | { kind: 'unsaved'; reply: string | null; failure: ApiFailure };

const saidMessages = new WeakMap<Said, Shown>();
const rested = new WeakMap<Message, Shown>();
const resting = (message: Message): Shown => {
  if ('live' in message) return message as Shown;
  let held = rested.get(message);
  if (!held) { held = { ...message, live: null }; rested.set(message, held); }
  return held;
};

export function withTurn(messages: Message[], turn: Turn | null, chat: string): Shown[] {
  const out = messages.map((message) => resting(message));
  if (turn?.chat !== chat) return out;
  const { said, reply } = turn;
  const now = Date.now();
  if (said && !out.some((message) => message.id === said.id)) {
    let message = saidMessages.get(said);
    if (!message) {
      message = { id: said.id, role: 'user', at: now, versions: [{ id: said.id, seed: said.id, text: said.text, receipt: null, edited: false, at: now, ...(said.translation && { translation: said.translation }), ...(said.before && { before: said.before }) }], selected: 0, live: null, unstored: true };
      saidMessages.set(said, message);
    }
    out.push(message);
  }
  const version = { id: reply.id, seed: reply.continues?.seed ?? reply.id, text: turn.text, receipt: null, edited: false, at: now, ...(reply.before && { before: reply.before }), ...(turn.reasoning && { reasoning: turn.reasoning }) };
  const live = { live: reply.id, ...(turn.whole && { whole: true as const }) };
  if (reply.message === null) {
    if (!out.some((message) => message.id === reply.id)) out.push({ id: reply.id, role: 'assistant', at: now, versions: [version], selected: 0, ...live });
    return out;
  }
  const index = out.findIndex((message) => message.id === reply.message);
  const message = out[index];
  if (!message || message.versions.some((existing) => existing.id === reply.id)) return out;
  const slot = reply.replaces === null ? -1 : message.versions.findIndex((existing) => existing.id === reply.replaces);
  const versions = slot === -1 ? [...message.versions, version] : message.versions.with(slot, version);
  out[index] = { ...message, versions, selected: slot === -1 ? versions.length - 1 : slot, ...live };
  return out;
}

type Held = { turn: Turn; abort: AbortController; calling: string | null };

// A reply blocks only its own chat: chats, in one tab or several, reply at once (user, 2026-10-04). A reply outlives
// the screen that asked for it: leaving a chat does not stop it. The server makes the call (runtime/streams), so
// close() only stops reading it, for a locked vault; the next load picks it up.
export class Talk {
  // By chat. calling: the call the turn reads, once it started.
  private readonly turns = new Map<string, Held>();
  // Replaced only when a turn starts or ends, never per chunk, so the sidebars that read it do not render per token.
  private writingChats: ReadonlySet<string> = new Set();
  private closed = false;
  private readonly unsaved = new Map<string, { chat: string; reply: Written; call: string }>();
  private readonly changes = new ChangeSignal();
  // By call id.
  private readonly sentBy = new Map<string, { chat: string; sent: Sent }>();
  private readonly leave: () => void;

  constructor(
    private readonly store: ObjectStore,
    private readonly credentials: Credentials,
    private readonly costs: Costs,
    // ended: a reply as its stream ended, which the bot's Lua may rewrite before it is saved. saved: once it is.
    private readonly ended: (chat: string, reply: Written) => Promise<Written>,
    private readonly saved: (chat: string, reply: Written) => void,
    // The calls this page reads (runtime/streams).
    private readonly reading: Set<string>,
  ) {
    this.leave = store.subscribe((changes) => {
      const released = new Set(changes.filter((change) => change.kind === 'scope' && store.scopeState(change.id) === 'unloaded').map((change) => change.id));
      for (const [id, held] of this.sentBy) if (released.has(held.chat)) this.sentBy.delete(id);
    });
  }

  readonly subscribe = this.changes.subscribe;

  readonly snapshot = (chat: string): Turn | null => this.turns.get(chat)?.turn ?? null;

  readonly writing = (): ReadonlySet<string> => this.writingChats;

  // By the call's id, which its receipt keeps through an edit, a branch and a continuation (model/chat Receipt). null:
  // its chat was released, or this page did not make the call.
  sent(call: string): Sent | null {
    return this.sentBy.get(call)?.sent ?? null;
  }

  // 멈추기: the call ends on the server too, and the text so far is saved as cut. Reading stops first, so the server's
  // end is never read as the stream's own.
  stop(chat: string) {
    const held = this.turns.get(chat);
    if (!held) return;
    held.abort.abort();
    if (held.calling) stopStream(held.calling);
  }

  close() {
    this.closed = true;
    for (const held of this.turns.values()) held.abort.abort();
    this.unsaved.clear();
    this.sentBy.clear();
    this.leave();
  }

  async saveAgain(reply: string): Promise<TalkFailure | null> {
    const unsaved = this.unsaved.get(reply);
    if (!unsaved) return null;
    const lease = this.store.retainChat(unsaved.chat);
    try {
      const failure = await lease.ready;
      return failure ? { kind: 'unsaved', reply, failure } : await this.save(unsaved.chat, unsaved.reply, unsaved.call);
    } finally { lease.release(); }
  }

  // A reply not saved keeps its call's marker, so a reload saves it too.
  private async save(chat: string, reply: Written, call: string): Promise<TalkFailure | null> {
    const appended = await appendReply(this.store, chat, reply);
    const elsewhere = !appended.ok && savedElsewhere(this.store, chat, reply.id, appended);
    if (!appended.ok && !elsewhere) {
      // Saved again, it would land on the chat the restore rewound, which the reply was never written against.
      if (appended.error === 'timeline-changed') {
        endCall(this.store, call);
        return { kind: 'unsaved', reply: null, failure: appended };
      }
      this.unsaved.set(reply.id, { chat, reply, call });
      return { kind: 'unsaved', reply: reply.id, failure: appended };
    }
    this.unsaved.delete(reply.id);
    endCall(this.store, call);
    if (elsewhere) return null;
    this.costs.settle(chat, reply.receipt);
    this.saved(chat, reply);
    return null;
  }

  private seat(chat: string, said: Turn['said'], reply: Turn['reply']): Held {
    const turn = { chat, said, reply, text: reply.continues?.text ?? '', reasoning: reply.continues?.reasoning ?? '' };
    const held: Held = { turn, abort: new AbortController(), calling: null };
    this.turns.set(chat, held);
    this.writingChats = new Set(this.turns.keys());
    this.changes.notify();
    return held;
  }

  // In a finally, so on a throw too: a turn left seated turns every later send of its chat away.
  private unseat(held: Held) {
    held.abort.abort();
    if (held.calling) this.reading.delete(held.calling);
    this.turns.delete(held.turn.chat);
    this.writingChats = new Set(this.turns.keys());
    this.changes.notify();
  }

  private change(held: Held, turn: Turn) {
    held.turn = turn;
    this.changes.notify();
  }

  // The turn is shown before prepare, which may save a new chat, translate the user's message and builds the prompt,
  // so the user's message appears the moment it is sent; stop() stops prepare too. A failure prepare returns ends the
  // turn unsent.
  async run<F extends { kind: string }>({ chat, said, reply: asked }: Omit<Turn, 'text' | 'reasoning'>, prepare: (signal: AbortSignal) => Promise<Ask | F>): Promise<TalkFailure | F | null> {
    if (this.turns.has(chat)) return null;
    const lease = this.store.retainChat(chat);
    const held = this.seat(chat, said, asked);
    try {
      // A turn is one workflow: begun on one timeline, none of its writes lands on the next (store pinned).
      const ran = await this.store.pinned(() => this.turnOn(held, said, asked, lease, prepare));
      return ran !== null && 'ok' in ran ? { kind: 'unsent', failure: ran } : ran;
    } finally {
      this.unseat(held);
      lease.release();
    }
  }

  private async turnOn<F extends { kind: string }>(held: Held, said: Turn['said'], asked: Turn['reply'], lease: ChatLease, prepare: (signal: AbortSignal) => Promise<Ask | F>): Promise<TalkFailure | F | null> {
    const { chat } = held.turn;
    const { abort } = held;
    const failure = await lease.ready;
    if (failure) return { kind: 'unsent', failure };
    const ready = await prepare(abort.signal);
    if ('kind' in ready) return ready;
    const { route, settings, prompt } = ready;
    const reply = ready.before ? { ...asked, before: ready.before } : asked;
    // A message sent translated or changed by the bot shows as it is saved from the moment it is made so.
    this.change(held, { ...held.turn, reply, said: ready.said ?? said, ...(settings.streaming === false && { whole: true as const }) });
    const sending = ready.said && appendUserMessage(this.store, chat, ready.said);
    const call = await newCall(this.store, route, { id: crypto.randomUUID(), chat, result: reply.id, for: { kind: 'reply', message: reply.message, replaces: reply.replaces, continues: reply.continues, ...(reply.before && { before: reply.before }) } });
    this.reading.add(call.id);
    held.calling = call.id;
    const replying = generate({ credentials: this.credentials, connection: route.connection.value, model: route.model, settings, messages: prompt.messages, call, signal: abort.signal, onText: this.writer(held), inline: this.inline(held) });
    const sent = await sending;
    if (sent && !sent.ok) {
      abort.abort();
      endCall(this.store, call.id);
      await replying;
      return { kind: 'unsent', failure: sent };
    }
    const answer = await replying;
    if (this.closed) return null;
    // Kept before the save, whose store change is what shows the reply's 정보.
    this.sentBy.set(call.id, { chat, sent: { request: answer.request, cache: answer.cache, prompt } });
    return await this.save(chat, await this.ended(chat, this.written(held, reply, callOf(route), answer, Date.now())), call.id);
  }

  // A reply the server was writing when this page came, which Streams hands over; it waits while its chat has a turn.
  // One not saved is not reported: its marker stays, and the next pick-up saves it again. One a restore ended goes with
  // the timeline it was begun on (save).
  async resume(stream: Stored<'stream'>) {
    const purpose = stream.value.for;
    const chat = stream.parent!;
    if (this.closed || purpose.kind !== 'reply' || this.turns.has(chat)) return;
    const lease = this.store.retainChat(chat);
    const reply = { id: stream.value.result, message: purpose.message, replaces: purpose.replaces, continues: purpose.continues, ...(purpose.before && { before: purpose.before }) };
    const held = this.seat(chat, null, reply);
    this.reading.add(stream.id);
    held.calling = stream.id;
    try {
      await this.store.pinned(async () => {
        if (await lease.ready) return;
        const answer = await resume(this.store, stream, held.abort.signal, this.writer(held), this.inline(held));
        // Not Date.now(): the call may have ended long before this page read it, and the cache timer counts back from at.
        const at = stream.value.at + answer.totalMs;
        if (!this.closed) await this.save(chat, await this.ended(chat, this.written(held, reply, stream.value.call, answer, at)), stream.id);
      });
    } finally {
      this.unseat(held);
      lease.release();
    }
  }

  private writer(held: Held) {
    return (phase: Phase, chunk: string) => this.change(held, { ...held.turn, [phase]: held.turn[phase] + chunk });
  }

  // A chat without a character has no 추론을 본문에 표시, and strips.
  private inline(held: Held): InlineThoughts {
    const character = this.store.get('chat', held.turn.chat)?.value.character;
    const keep = character ? this.store.get('character', character)?.value.keepThoughts === true : false;
    return { keep, takeBack: (chars) => this.change(held, { ...held.turn, reasoning: held.turn.reasoning.slice(0, held.turn.reasoning.length - chars) }) };
  }

  private written({ turn }: Held, reply: Turn['reply'], call: Stream['call'], answer: Reply, at: number): Written {
    const receipt: Receipt = { ...receiptOf(call, answer), ...(reply.continues && { continues: reply.continues.receipt }) };
    return { id: reply.id, message: reply.message, replaces: reply.replaces, at, text: turn.text, receipt, seed: reply.continues?.seed, ...(reply.before && { before: reply.before }), ...(turn.reasoning && { reasoning: turn.reasoning }) };
  }
}

export function receiptOf(call: Stream['call'], answer: Reply): Receipt {
  return {
    id: answer.call,
    ...call,
    ...(answer.account !== null && { account: answer.account }),
    state: answer.state,
    cut: answer.cut,
    error: answer.error && receiptError(answer.error),
    finishReason: answer.finishReason,
    usage: answer.usage,
    cost: answer.cost,
    replyId: answer.replyId,
    firstTextMs: answer.firstTextMs,
    totalMs: answer.totalMs,
    cache: answer.cache?.cache ?? null,
  };
}

// A task's call (a memory record's, a 삽화 scene's) is never settled later, so its receipt keeps no pending cost.
export const unsettled = (receipt: Receipt): Receipt => (receipt.cost === 'pending' ? { ...receipt, cost: null } : receipt);

// Field by field, never the error itself: whatever a network error gains must not reach saved chats.
export function receiptError(error: NonNullable<Reply['error']>): ReceiptError {
  switch (error.kind) {
    case 'refused':
    case 'relay':
    case 'app':
      return { kind: error.kind, code: error.code };
    case 'provider':
      return 'status' in error ? { kind: 'provider', status: error.status, detail: error.detail } : { kind: 'provider', detail: error.detail };
    case 'bad-event':
    case 'network':
      return { kind: error.kind, detail: error.detail };
    case 'offline':
    case 'no-token':
      return { kind: error.kind };
    case 'pool':
      return { kind: 'pool', group: error.group };
  }
}
