import type { ModelSettings } from '../connectors/settings';
import type { Phase } from '../connectors/types';
import type { Assembled } from '../engine/pipeline';
import type { Message, Receipt, ReceiptError, Writes } from '../model/chat';
import type { Stored } from '../model/kinds';
import type { Stream } from '../model/stream';
import type { ApiFailure } from './api';
import type { Route, RouteFailure } from './assignment';
import { appendReply, appendUserMessage, type Said, type Written } from './chat-log';
import type { Costs } from './cost';
import type { Credentials } from './credential';
import { generate, resume, type Reply } from './generate';
import { stopStream } from './relay';
import type { ObjectStore } from './store';
import { callOf, endCall, newCall } from './streams';

// The reply being written. said is the user's message sent with it, shown until the store has it; reply
// says where the answer goes: a new message, or a new version of one (in place of a failed one on 다시 시도, or
// of the cut one it continues on 이어 쓰기). A continuation's text and reasoning start as those it continues. before:
// what the bot's Lua wrote before the reply was made (model/chat Entry).
export type Turn = {
  chat: string;
  said: Said | null;
  reply: { id: string; message: string | null; replaces: string | null; continues: { text: string; receipt: Receipt; seed: string; reasoning?: string } | null; before?: Writes };
  text: string;
  reasoning: string;
};

// A message on screen: live marks the version being written.
export type Shown = Message & { live: string | null };

// What one reply is sent with, ready once its prompt is built: the model and the prompt, which the reply's id
// seeds. settings: the model's 설정 묶음 as stored, which the request fits to the model. said: the user's message
// as it is saved, which a message sent translated saves translated; null when prepare saved it itself. before: the
// reply's (Turn).
export type Ask = { route: Route; settings: ModelSettings; prompt: Assembled; said: Said | null; before?: Writes };

// What one reply sent, for 정보's 요청 원문 and lorebook part. It lives in page memory only, until the session
// closes: the raw request is never stored.
export type Sent = Pick<Reply, 'request' | 'cache'> & { prompt: Assembled };

// unsent: the user's message was not saved, so its reply was stopped. unsaved: the reply was written
// but not saved; saveAgain(reply) tries it again.
export type TalkFailure = RouteFailure | { kind: 'unsent'; failure: ApiFailure } | { kind: 'unsaved'; reply: string; failure: ApiFailure };

const saidMessages = new WeakMap<Said, Shown>();
const rested = new WeakMap<Message, Shown>();
const resting = (message: Message): Shown => {
  if ('live' in message) return message as Shown;
  let held = rested.get(message);
  if (!held) { held = { ...message, live: null }; rested.set(message, held); }
  return held;
};

// The chat's messages with the turn laid over them, until its entries are saved.
export function withTurn(messages: Message[], turn: Turn | null, chat: string): Shown[] {
  const out = messages.map((message) => resting(message));
  if (turn?.chat !== chat) return out;
  const { said, reply } = turn;
  const now = Date.now();
  if (said && !out.some((message) => message.id === said.id)) {
    let message = saidMessages.get(said);
    if (!message) {
      message = { id: said.id, role: 'user', at: now, versions: [{ id: said.id, seed: said.id, text: said.text, receipt: null, edited: false, at: now, ...(said.translation && { translation: said.translation }), ...(said.before && { before: said.before }) }], selected: 0, live: null };
      saidMessages.set(said, message);
    }
    out.push(message);
  }
  const version = { id: reply.id, seed: reply.continues?.seed ?? reply.id, text: turn.text, receipt: null, edited: false, at: now, ...(reply.before && { before: reply.before }), ...(turn.reasoning && { reasoning: turn.reasoning }) };
  if (reply.message === null) {
    if (!out.some((message) => message.id === reply.id)) out.push({ id: reply.id, role: 'assistant', at: now, versions: [version], selected: 0, live: reply.id });
    return out;
  }
  const index = out.findIndex((message) => message.id === reply.message);
  const message = out[index];
  if (!message || message.versions.some((existing) => existing.id === reply.id)) return out;
  const slot = reply.replaces === null ? -1 : message.versions.findIndex((existing) => existing.id === reply.replaces);
  const versions = slot === -1 ? [...message.versions, version] : message.versions.with(slot, version);
  out[index] = { ...message, versions, selected: slot === -1 ? versions.length - 1 : slot, live: reply.id };
  return out;
}

// One reply is written at a time, app-wide, and it outlives the screen that asked for it: leaving a
// chat does not stop its reply. The server makes the call (runtime/streams), so close() only stops reading it, for a
// locked vault; the next load picks it up.
export class Talk {
  private turn: Turn | null = null;
  private abort: AbortController | null = null;
  // The call the turn reads, once it started.
  private calling: string | null = null;
  private closed = false;
  private readonly unsaved = new Map<string, { chat: string; reply: Written; call: string }>();
  private readonly listeners = new Set<() => void>();
  // By the id of the version each reply wrote.
  private readonly sentBy = new Map<string, { chat: string; sent: Sent }>();
  private readonly leave: () => void;

  constructor(
    private readonly store: ObjectStore,
    private readonly credentials: Credentials,
    private readonly costs: Costs,
    // ended: a reply as its stream ended, which the bot's Lua may rewrite before it is saved. saved: once it is.
    private readonly ended: (chat: string, reply: Written) => Promise<Written>,
    private readonly saved: (chat: string, reply: Written) => void,
    // The calls this page reads (runtime/streams), shared with Translator and Streams.
    private readonly reading: Set<string>,
  ) {
    this.leave = store.subscribe((changes) => {
      const released = new Set(changes.filter((change) => change.kind === 'scope' && store.scopeState(change.id) === 'unloaded').map((change) => change.id));
      for (const [id, held] of this.sentBy) if (released.has(held.chat)) this.sentBy.delete(id);
    });
  }

  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly snapshot = () => this.turn;

  // null: its chat was released, it was not written by this page, or it was written as another version (an edit).
  sent(version: string): Sent | null {
    return this.sentBy.get(version)?.sent ?? null;
  }

  // 멈추기: the call ends on the server too, and the text so far is saved as cut. Reading stops first, so the server's
  // end is never read as the stream's own.
  stop() {
    this.abort?.abort();
    if (this.calling) stopStream(this.calling);
  }

  close() {
    this.closed = true;
    this.abort?.abort();
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

  // A conflict over an entry already there is the same reply saved by another device that read the call. A reply
  // not saved keeps its call's marker, so a reload saves it too.
  private async save(chat: string, reply: Written, call: string): Promise<TalkFailure | null> {
    const appended = await appendReply(this.store, chat, reply);
    const elsewhere = !appended.ok && appended.error === 'conflict' && this.store.children('entry', chat).some((entry) => entry.id === reply.id);
    if (!appended.ok && !elsewhere) {
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

  private set(turn: Turn | null) {
    this.turn = turn;
    for (const listener of this.listeners) listener();
  }

  // The turn is shown before prepare, which may save a new chat, translate the user's message and builds the prompt,
  // so the user's message appears the moment it is sent; stop() stops prepare too. A failure prepare returns ends the
  // turn unsent.
  async run<F extends { kind: string }>({ chat, said, reply: asked }: Omit<Turn, 'text' | 'reasoning'>, prepare: (signal: AbortSignal) => Promise<Ask | F>): Promise<TalkFailure | F | null> {
    if (this.turn) return null;
    const lease = this.store.retainChat(chat);
    this.set({ chat, said, reply: asked, text: asked.continues?.text ?? '', reasoning: asked.continues?.reasoning ?? '' });
    const abort = new AbortController();
    this.abort = abort;
    try {
      const failure = await lease.ready;
      if (failure) return { kind: 'unsent', failure };
      const ready = await prepare(abort.signal);
      if ('kind' in ready) return ready;
      const { route, settings, prompt } = ready;
      const reply = ready.before ? { ...asked, before: ready.before } : asked;
      // A message sent translated or changed by the bot shows as it is saved from the moment it is made so.
      this.set({ ...this.turn!, reply, said: ready.said ?? said });
      const sending = ready.said && appendUserMessage(this.store, chat, ready.said);
      const call = await newCall(this.store, route, { id: crypto.randomUUID(), chat, result: reply.id, for: { kind: 'reply', message: reply.message, replaces: reply.replaces, continues: reply.continues, ...(reply.before && { before: reply.before }) } });
      this.reading.add(call.id);
      this.calling = call.id;
      const replying = generate({ credentials: this.credentials, connection: route.connection.value, model: route.model, settings, messages: prompt.messages, call, signal: abort.signal, onText: this.write });
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
      this.sentBy.set(reply.id, { chat, sent: { request: answer.request, cache: answer.cache, prompt } });
      return await this.save(chat, await this.ended(chat, this.written(reply, callOf(route), answer)), call.id);
    } finally {
      // On a throw too: a turn left set turns every later send away, and a reply still streaming would write into the next.
      abort.abort();
      if (this.calling) this.reading.delete(this.calling);
      this.calling = null;
      this.abort = null;
      this.set(null);
      lease.release();
    }
  }

  // A reply the server was writing when this page came, which Streams hands over; it waits while another is written.
  // One not saved is not reported: its marker stays, and the next pick-up saves it again.
  async resume(stream: Stored<'stream'>) {
    const purpose = stream.value.for;
    if (this.turn || this.closed || purpose.kind !== 'reply') return;
    const chat = stream.parent!;
    const lease = this.store.retainChat(chat);
    const reply = { id: stream.value.result, message: purpose.message, replaces: purpose.replaces, continues: purpose.continues, ...(purpose.before && { before: purpose.before }) };
    this.set({ chat, said: null, reply, text: reply.continues?.text ?? '', reasoning: reply.continues?.reasoning ?? '' });
    const abort = new AbortController();
    this.abort = abort;
    this.reading.add(stream.id);
    this.calling = stream.id;
    try {
      if (await lease.ready) return;
      const answer = await resume(this.store, stream, abort.signal, this.write);
      if (!this.closed) await this.save(chat, await this.ended(chat, this.written(reply, stream.value.call, answer)), stream.id);
    } finally {
      abort.abort();
      this.reading.delete(stream.id);
      this.calling = null;
      this.abort = null;
      this.set(null);
      lease.release();
    }
  }

  private readonly write = (phase: Phase, chunk: string) => this.set({ ...this.turn!, [phase]: this.turn![phase] + chunk });

  private written(reply: Turn['reply'], call: Stream['call'], answer: Reply): Written {
    const receipt: Receipt = { ...receiptOf(call, answer), ...(reply.continues && { continues: reply.continues.receipt }) };
    return { id: reply.id, message: reply.message, replaces: reply.replaces, at: Date.now(), text: this.turn!.text, receipt, seed: reply.continues?.seed, ...(reply.before && { before: reply.before }), ...(this.turn!.reasoning && { reasoning: this.turn!.reasoning }) };
  }
}

// What a call leaves in a saved chat: a reply's receipt, or a translation's.
export function receiptOf(call: Stream['call'], answer: Reply): Receipt {
  return {
    id: answer.call,
    ...call,
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

// Field by field, never the error itself: whatever a network error gains must not reach saved chats.
function receiptError(error: NonNullable<Reply['error']>): ReceiptError {
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
  }
}
